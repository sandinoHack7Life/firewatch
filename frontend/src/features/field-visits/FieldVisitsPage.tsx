import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useOperationalContext } from '../../components/layout/OperationalContext';
import { api } from '../../services/api';
import type {
  FieldVisit,
  FieldVisitPayload,
  FieldVisitStatus,
  FireObservation,
  NationalPark,
  ObservedResult,
  ParkId,
} from '../../services/api';
import { loadFieldVisitDrafts, saveFieldVisitDrafts } from '../../services/fieldVisitDrafts';

const DEFAULT_PARK_ID: ParkId = 'gorongosa';
const PARK_IDS: ParkId[] = [
  'gorongosa', 'limpopo', 'banhine', 'zinave', 'bazaruto', 'maputo', 'magoe', 'quirimbas',
];
const PUBLIC_OBSERVATION_CACHE = 'firewatch.public-observations.v1';
const STATUS_OPTIONS: Array<{ value: FieldVisitStatus; label: string }> = [
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const RESULT_OPTIONS: Array<{ value: ObservedResult; label: string }> = [
  { value: 'active_fire_signs', label: 'Active fire signs' },
  { value: 'burn_scars', label: 'Burn scars' },
  { value: 'no_signs_observed', label: 'No signs observed' },
  { value: 'inconclusive', label: 'Inconclusive' },
  { value: 'unable_to_verify', label: 'Unable to verify' },
];

interface VisitForm {
  scheduledAt: string;
  actualVisitAt: string;
  status: FieldVisitStatus;
  observedResult: ObservedResult | '';
  fieldLatitude: string;
  fieldLongitude: string;
  notes: string;
}

const EMPTY_FORM: VisitForm = {
  scheduledAt: '',
  actualVisitAt: '',
  status: 'planned',
  observedResult: '',
  fieldLatitude: '',
  fieldLongitude: '',
  notes: '',
};

function isParkId(value: string | null): value is ParkId {
  return value !== null && PARK_IDS.includes(value as ParkId);
}

function localDateTimeToUtc(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}:00+02:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Enter a valid Mozambique local date and time.');
  return parsed.toISOString();
}

function utcToMaputoInput(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleString('sv-SE', { timeZone: 'Africa/Maputo' }).replace(' ', 'T').slice(0, 16);
}

function clientId(): string {
  if (typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function observationCacheKey(parkId: ParkId): string {
  return `${PUBLIC_OBSERVATION_CACHE}:${parkId}`;
}

function isFireObservation(value: unknown): value is FireObservation {
  if (typeof value !== 'object' || value === null) return false;
  const observation = value as Record<string, unknown>;
  return typeof observation.observation_id === 'string'
    && typeof observation.latitude === 'number'
    && typeof observation.longitude === 'number'
    && typeof observation.acquisition_date === 'string'
    && typeof observation.instrument === 'string'
    && typeof observation.feed === 'string';
}

function readCachedObservations(parkId: ParkId): FireObservation[] {
  const stored = window.localStorage.getItem(observationCacheKey(parkId));
  if (!stored) return [];
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every(isFireObservation)) {
    throw new Error('Cached public observations are invalid and were not loaded.');
  }
  return parsed;
}

function isConnectivityFailure(reason: unknown): boolean {
  return reason instanceof TypeError
    || (reason instanceof Error && /failed to fetch|networkerror|econnrefused|http 502/i.test(reason.message));
}

function mapDate(value: string | null, language: string): string {
  if (!value) return '';
  return new Date(value).toLocaleString(language === 'pt' ? 'pt-MZ' : 'en-GB', { timeZone: 'Africa/Maputo' });
}

function sourceKey(observation: FireObservation): string {
  return `${observation.feed}:${observation.observation_id}`;
}

function visitAsObservation(visit: FieldVisit): FireObservation {
  return {
    observation_id: visit.satellite_observation_id,
    latitude: visit.satellite_latitude,
    longitude: visit.satellite_longitude,
    acquisition_date: visit.satellite_detection_date ?? '',
    acquisition_time: visit.satellite_detection_time_utc,
    satellite: visit.satellite ?? 'Not reported',
    instrument: visit.instrument ?? 'Not reported',
    product: visit.satellite_feed,
    processing_type: '',
    source: visit.source ?? 'NASA FIRMS',
    feed: visit.satellite_feed,
  };
}

export function FieldVisitsPage() {
  const { t, i18n } = useTranslation();
  const { filters } = useOperationalContext();
  const [searchParams] = useSearchParams();
  const [parks, setParks] = useState<NationalPark[]>([]);
  const [parkId, setParkId] = useState<ParkId>(() => {
    const requested = searchParams.get('park_id');
    return isParkId(requested) ? requested : DEFAULT_PARK_ID;
  });
  const [observations, setObservations] = useState<FireObservation[]>([]);
  const [visits, setVisits] = useState<FieldVisit[]>([]);
  const [drafts, setDrafts] = useState<FieldVisitPayload[]>([]);
  const [accessKey, setAccessKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [selectedObservation, setSelectedObservation] = useState<FireObservation | null>(null);
  const [form, setForm] = useState<VisitForm>(EMPTY_FORM);
  const [formCreatedAt, setFormCreatedAt] = useState(() => new Date().toISOString());
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingDrafts, setSyncingDrafts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const selectedPark = parks.find((park) => park.id === parkId);
  const allSourceObservations = useMemo(() => {
    const current = new Map(observations.map((observation) => [sourceKey(observation), observation]));
    if (selectedObservation) current.set(sourceKey(selectedObservation), selectedObservation);
    return [...current.values()];
  }, [observations, selectedObservation]);

  useEffect(() => {
    let active = true;
    api.getParks()
      .then((response) => { if (active) setParks(response.items); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? t(reason.message) : t('National park boundaries could not be loaded.'));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api.getFireMap({
      ...filters,
      park_id: parkId,
      limit: 5000,
    }).then((response) => {
      if (!active) return;
      const sourceRecords = response.items.filter((item) => item.instrument === 'MODIS' || item.instrument === 'VIIRS');
      setObservations(sourceRecords);
      setError(null);
      try {
        window.localStorage.setItem(observationCacheKey(parkId), JSON.stringify(sourceRecords));
      } catch {
        setNotice(t('Public observation cache is unavailable on this device; offline drafts can still be saved.'));
      }
    }).catch((reason: unknown) => {
      if (!active) return;
      try {
        const cached = readCachedObservations(parkId);
        setObservations(cached);
        setError(t('Live satellite records are unavailable. Showing {{count}} cached public observations; field drafts remain encrypted locally.', { count: cached.length }));
      } catch (cacheReason) {
        setObservations([]);
        const detail = cacheReason instanceof Error ? t(cacheReason.message) : t('Cached observations could not be loaded.');
        setError(`${reason instanceof Error ? t(reason.message) : t('Observation request failed.')} ${detail}`);
      }
    });
    return () => { active = false; };
  }, [filters, parkId, t]);

  useEffect(() => {
    const requestedObservation = searchParams.get('observation_id');
    const requestedFeed = searchParams.get('feed');
    if (!requestedObservation || !requestedFeed) return;
    const match = observations.find((item) => (
      item.observation_id === requestedObservation && item.feed === requestedFeed
    ));
    if (match) setSelectedObservation(match);
  }, [observations, searchParams]);

  const refreshVisits = useCallback(async (key: string, selectedParkId: ParkId) => {
    const response = await api.getFieldVisits(key, selectedParkId);
    setVisits(response.items);
  }, [t]);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = keyInput.trim();
    if (candidate.length < 32) {
      setError(t('The shared field-data key must contain at least 32 characters.'));
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const localDrafts = await loadFieldVisitDrafts(candidate);
      try {
        const response = await api.getFieldVisits(candidate, parkId);
        setVisits(response.items);
        setOfflineMode(false);
        setNotice(t('Private field records unlocked. The shared key remains only in memory.'));
      } catch (reason) {
        if (!isConnectivityFailure(reason)) throw reason;
        setVisits([]);
        setOfflineMode(true);
        setNotice(t('Backend unavailable. Drafts are unlocked on this device; the shared key cannot be validated until reconnection.'));
      }
      setAccessKey(candidate);
      setKeyInput('');
      setDrafts(localDrafts);
      setUnlocked(true);
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Field records could not be unlocked.'));
    } finally {
      setLoading(false);
    }
  };

  const persistDrafts = async (nextDrafts: FieldVisitPayload[]) => {
    await saveFieldVisitDrafts(accessKey, nextDrafts);
    setDrafts(nextDrafts);
  };

  const syncPendingDrafts = useCallback(async () => {
    if (!accessKey || !navigator.onLine || syncingRef.current || drafts.length === 0) return;
    syncingRef.current = true;
    setSyncingDrafts(true);
    let remaining = [...drafts];
    try {
      for (const draft of drafts) {
        const created = await api.createFieldVisit(accessKey, draft);
        const saved = created.created
          ? created.item
          : (await api.updateFieldVisit(accessKey, draft)).item;
        setVisits((current) => [saved, ...current.filter((item) => item.client_id !== saved.client_id)]);
        remaining = remaining.filter((item) => item.client_id !== draft.client_id);
        await persistDrafts(remaining);
      }
      setNotice(t('All encrypted field visit drafts have synchronized.'));
      setError(null);
    } catch (reason) {
      if (remaining.length !== drafts.length) await persistDrafts(remaining);
      setError(reason instanceof Error ? t(reason.message) : t('One or more field visit drafts could not be synchronized.'));
    } finally {
      syncingRef.current = false;
      setSyncingDrafts(false);
    }
  }, [accessKey, drafts, t]);

  useEffect(() => {
    if (!unlocked) return undefined;
    const handleOnline = () => {
      setOfflineMode(false);
      void syncPendingDrafts();
    };
    window.addEventListener('online', handleOnline);
    if (navigator.onLine && drafts.length > 0) void syncPendingDrafts();
    return () => window.removeEventListener('online', handleOnline);
  }, [drafts.length, syncPendingDrafts, unlocked]);

  useEffect(() => {
    if (!unlocked || offlineMode) return;
    let active = true;
    api.getFieldVisits(accessKey, parkId)
      .then((response) => { if (active) setVisits(response.items); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? t(reason.message) : t('Field visit records could not be refreshed.'));
      });
    return () => { active = false; };
  }, [accessKey, offlineMode, parkId, t, unlocked]);

  const editVisit = (visit: FieldVisit) => {
    const observation = observations.find((item) => (
      item.observation_id === visit.satellite_observation_id
      && item.feed === visit.satellite_feed
    )) ?? visitAsObservation(visit);
    setSelectedObservation(observation);
    setEditingClientId(visit.client_id);
    setFormCreatedAt(visit.form_created_at_utc);
    setForm({
      scheduledAt: utcToMaputoInput(visit.scheduled_at_utc),
      actualVisitAt: utcToMaputoInput(visit.actual_visit_at_utc),
      status: visit.status,
      observedResult: visit.observed_result ?? '',
      fieldLatitude: visit.field_latitude === null ? '' : String(visit.field_latitude),
      fieldLongitude: visit.field_longitude === null ? '' : String(visit.field_longitude),
      notes: visit.notes,
    });
  };

  const editDraft = (draft: FieldVisitPayload) => {
    const observation = observations.find((item) => (
      item.observation_id === draft.satellite_observation_id && item.feed === draft.satellite_feed
    ));
    if (!observation) {
      setError(t('The observation for this draft is not in the live or cached park records. Reconnect and refresh before editing.'));
      return;
    }
    setSelectedObservation(observation);
    setEditingClientId(draft.client_id);
    setFormCreatedAt(draft.form_created_at_utc);
    setForm({
      scheduledAt: utcToMaputoInput(draft.scheduled_at_utc),
      actualVisitAt: utcToMaputoInput(draft.actual_visit_at_utc),
      status: draft.status,
      observedResult: draft.observed_result ?? '',
      fieldLatitude: draft.field_latitude === null ? '' : String(draft.field_latitude),
      fieldLongitude: draft.field_longitude === null ? '' : String(draft.field_longitude),
      notes: draft.notes,
    });
  };

  const clearForm = () => {
    setEditingClientId(null);
    setFormCreatedAt(new Date().toISOString());
    setSelectedObservation(null);
    setForm(EMPTY_FORM);
  };

  const saveVisit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedObservation || !selectedObservation.feed) {
      setError(t('Select a real MODIS or VIIRS detection before creating a verification record.'));
      return;
    }
    if ((form.fieldLatitude === '') !== (form.fieldLongitude === '')) {
      setError(t('Enter both field GPS coordinates or leave both blank.'));
      return;
    }
    const fieldLatitude = form.fieldLatitude === '' ? null : Number(form.fieldLatitude);
    const fieldLongitude = form.fieldLongitude === '' ? null : Number(form.fieldLongitude);
    if (
      (fieldLatitude !== null && (!Number.isFinite(fieldLatitude) || fieldLatitude < -90 || fieldLatitude > 90))
      || (fieldLongitude !== null && (!Number.isFinite(fieldLongitude) || fieldLongitude < -180 || fieldLongitude > 180))
    ) {
      setError(t('Field GPS coordinates must be valid decimal degrees.'));
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    let payload: FieldVisitPayload;
    try {
      payload = {
        client_id: editingClientId ?? clientId(),
        park_id: parkId,
        satellite_observation_id: selectedObservation.observation_id,
        satellite_feed: selectedObservation.feed,
        form_created_at_utc: formCreatedAt,
        scheduled_at_utc: localDateTimeToUtc(form.scheduledAt),
        actual_visit_at_utc: localDateTimeToUtc(form.actualVisitAt),
        status: form.status,
        observed_result: form.observedResult || null,
        field_latitude: fieldLatitude,
        field_longitude: fieldLongitude,
        notes: form.notes.trim(),
      };
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Visit timestamps are invalid.'));
      setSaving(false);
      return;
    }

    try {
      const isExistingVisit = visits.some((visit) => visit.client_id === payload.client_id);
      let saved: FieldVisit;
      if (isExistingVisit) {
        saved = (await api.updateFieldVisit(accessKey, payload)).item;
      } else {
        const created = await api.createFieldVisit(accessKey, payload);
        saved = created.created
          ? created.item
          : (await api.updateFieldVisit(accessKey, payload)).item;
      }
      setVisits((current) => [saved, ...current.filter((visit) => visit.client_id !== saved.client_id)]);
      const remaining = drafts.filter((draft) => draft.client_id !== payload.client_id);
      await persistDrafts(remaining);
      setNotice(t('Field verification record saved to the protected backend.'));
      clearForm();
    } catch (reason) {
      if (isConnectivityFailure(reason)) {
        const nextDrafts = [
          payload,
          ...drafts.filter((draft) => draft.client_id !== payload.client_id),
        ];
        try {
          await persistDrafts(nextDrafts);
          setNotice(t('Backend unavailable. The visit was encrypted and saved as a local draft for automatic synchronization.'));
          clearForm();
        } catch (storageReason) {
          setError(storageReason instanceof Error ? t(storageReason.message) : t('The offline visit draft could not be encrypted.'));
        }
      } else {
        setError(reason instanceof Error ? t(reason.message) : t('Field visit could not be saved.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const parkName = selectedPark?.name ?? parkId;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Private Conservation Operations')}</p>
          <h2>{t('Field Verification Visits')}</h2>
          <p className="page-description">
            {t('Record human verification separately from satellite detection. A thermal anomaly is not a confirmed wildfire.')}
          </p>
        </div>
        {unlocked && (
          <button className="secondary-btn" type="button" onClick={() => {
            setUnlocked(false);
            setOfflineMode(false);
            setAccessKey('');
            setVisits([]);
            setDrafts([]);
            clearForm();
          }}>{t('Lock private records')}</button>
        )}
      </header>

      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="inline-success" role="status">{notice}</p>}

      {!unlocked ? (
        <section className="section-card field-access-card">
          <div className="panel-header">
            <p className="eyebrow">{t('Shared team access key')}</p>
            <h3>{t('Unlock protected field records')}</h3>
          </div>
          <p className="scientific-note">
            {t('No login screen or account is used. Enter the configured team key; it is held in memory only and is never written to browser storage.')}
            {' '}{t('When offline, the key encrypts local drafts with AES-GCM.')}
          </p>
          <form className="field-access-form" onSubmit={(event) => void unlock(event)}>
            <label>
              {t('Field-data access key')}
              <input
                type="password"
                autoComplete="off"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                minLength={32}
                required
              />
            </label>
            <button className="primary-btn" type="submit" disabled={loading}>
              {loading ? t('Unlocking…') : t('Unlock field records')}
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="section-card field-toolbar">
            <label>
              {t('National park')}
              <select value={parkId} onChange={(event) => setParkId(event.target.value as ParkId)}>
                {parks.map((park) => <option key={park.id} value={park.id}>{park.name} · {park.province}</option>)}
              </select>
            </label>
            <span className={`dispatch-state ${offlineMode ? 'dispatch-not_configured' : 'state-enabled'}`}>
              {offlineMode ? t('Offline draft mode') : navigator.onLine ? t('Backend connected') : t('Device offline')}
            </span>
            {drafts.length > 0 && (
              <button className="secondary-btn" type="button" disabled={syncingDrafts || !navigator.onLine} onClick={() => void syncPendingDrafts()}>
                {syncingDrafts
                  ? t('Synchronizing drafts…')
                  : t(drafts.length === 1 ? 'Sync {{count}} pending draft' : 'Sync {{count}} pending drafts', { count: drafts.length })}
              </button>
            )}
          </section>

          {selectedPark && (
            <p className="boundary-attribution">
              {t(selectedPark.boundary_note)} {t('Park boundary label')} {selectedPark.boundary_source} ({selectedPark.boundary_license}).
              {' '}<a href={selectedPark.boundary_url} target="_blank" rel="noreferrer">{t('View source geometry')}</a>.
            </p>
          )}

          <section className="section-card field-visit-form-card">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{editingClientId ? t('Update verification record') : t('New verification record')}</p>
                <h3>{parkName}</h3>
              </div>
              <span className="metric-unit">{t('{{count}} FIRMS records available', { count: observations.length.toLocaleString() })}</span>
            </div>
            <form className="field-visit-form" onSubmit={(event) => void saveVisit(event)}>
              <label className="field-observation-select">
                {t('NASA satellite detection')}
                <select
                  required
                  value={selectedObservation ? sourceKey(selectedObservation) : ''}
                  onChange={(event) => {
                    const record = allSourceObservations.find((item) => sourceKey(item) === event.target.value);
                    setSelectedObservation(record ?? null);
                  }}
                >
                  <option value="">{t('Select a real MODIS or VIIRS detection')}</option>
                  {allSourceObservations.map((record) => (
                    <option key={sourceKey(record)} value={sourceKey(record)}>
                      {record.acquisition_date} {record.acquisition_time ?? ''} UTC · {record.instrument} · {record.observation_id}
                    </option>
                  ))}
                </select>
              </label>
              {selectedObservation && (
                <div className="field-source-metadata">
                  <span><strong>{t('Satellite coordinates:')}</strong> {selectedObservation.latitude.toFixed(5)}, {selectedObservation.longitude.toFixed(5)}</span>
                  <span><strong>{t('Detection:')}</strong> {selectedObservation.acquisition_date} {selectedObservation.acquisition_time ?? t('time not reported')} UTC</span>
                  <span><strong>{t('Platform / sensor:')}</strong> {selectedObservation.satellite} / {selectedObservation.instrument}</span>
                  <span><strong>{t('Feed:')}</strong> {selectedObservation.feed}</span>
                </div>
              )}

              <div className="form-grid-two">
                <label>{t('Status')}
                  <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as FieldVisitStatus }))}>
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
                  </select>
                </label>
                <label>{t('Observed result (independent of status)')}
                  <select value={form.observedResult} onChange={(event) => setForm((current) => ({ ...current, observedResult: event.target.value as ObservedResult | '' }))}>
                    <option value="">{t('Not recorded')}</option>
                    {RESULT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
                  </select>
                </label>
                <label>{t('Scheduled visit · Mozambique local time (CAT, UTC+02:00)')}
                  <input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value }))} />
                </label>
                <label>{t('Actual visit · Mozambique local time (CAT, UTC+02:00)')}
                  <input type="datetime-local" value={form.actualVisitAt} onChange={(event) => setForm((current) => ({ ...current, actualVisitAt: event.target.value }))} />
                </label>
                <label>{t('Field GPS latitude (decimal degrees)')}
                  <input type="number" min="-90" max="90" step="any" value={form.fieldLatitude} onChange={(event) => setForm((current) => ({ ...current, fieldLatitude: event.target.value }))} />
                </label>
                <label>{t('Field GPS longitude (decimal degrees)')}
                  <input type="number" min="-180" max="180" step="any" value={form.fieldLongitude} onChange={(event) => setForm((current) => ({ ...current, fieldLongitude: event.target.value }))} />
                </label>
              </div>
              <label>{t('Team notes (private; excluded from public reports)')}
                <textarea rows={4} maxLength={2000} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>
              <p className="chart-caption">
                {t('Form creation time:')} {formCreatedAt} UTC.
                {' '}{t('Satellite coordinates remain immutable and are stored separately from optional field GPS coordinates.')}
              </p>
              <div className="form-actions">
                <button className="primary-btn" type="submit" disabled={saving || !selectedObservation}>
                  {saving ? t('Saving…') : editingClientId ? t('Update field visit') : t('Create field visit')}
                </button>
                {editingClientId && <button className="secondary-btn" type="button" onClick={clearForm}>{t('Cancel edit')}</button>}
              </div>
            </form>
          </section>

          {drafts.length > 0 && (
            <section className="section-card">
              <div className="panel-header"><p className="eyebrow">{t('Encrypted local storage')}</p><h3>{t('Unsent drafts ({{count}})', { count: drafts.length })}</h3></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('Observation')}</th><th>{t('Status')}</th><th>{t('Form created (UTC)')}</th><th>{t('Actions')}</th></tr></thead>
                  <tbody>
                    {drafts.map((draft) => (
                      <tr key={draft.client_id}>
                        <td>{draft.satellite_observation_id} · {draft.satellite_feed}</td>
                        <td>{t(draft.status)}</td>
                        <td>{draft.form_created_at_utc}</td>
                        <td><button className="secondary-btn" type="button" onClick={() => editDraft(draft)}>{t('Edit draft')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="section-card">
            <div className="panel-header">
              <div><p className="eyebrow">{t('Shared team records')} · {parkName}</p><h3>{t('Field verification history')}</h3></div>
              <span className="metric-unit">{t('{{count}} records', { count: visits.length })}</span>
            </div>
            {visits.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('Detection')}</th><th>{t('Created UTC')}</th><th>{t('Scheduled local')}</th><th>{t('Actual local')}</th><th>{t('Status / result')}</th><th>{t('Satellite / field GPS')}</th><th>{t('Notes')}</th><th /></tr></thead>
                  <tbody>
                    {visits.map((visit) => (
                      <tr key={visit.client_id}>
                        <td>{visit.satellite_detection_date} {visit.satellite_detection_time_utc ?? ''} UTC<br />{visit.satellite_observation_id}</td>
                        <td>{visit.form_created_at_utc}</td>
                        <td>{mapDate(visit.scheduled_at_utc, i18n.resolvedLanguage ?? 'en') || t('Not recorded')}</td>
                        <td>{mapDate(visit.actual_visit_at_utc, i18n.resolvedLanguage ?? 'en') || t('Not recorded')}</td>
                        <td>{t(visit.status)}<br />{visit.observed_result ? t(visit.observed_result) : t('Result not recorded')}</td>
                        <td>
                          {t('Satellite:')} {visit.satellite_latitude.toFixed(4)}, {visit.satellite_longitude.toFixed(4)}
                          <br />{t('Field:')} {visit.field_latitude ?? '—'}, {visit.field_longitude ?? '—'}
                        </td>
                        <td>{visit.notes || '—'}</td>
                        <td><button className="secondary-btn" type="button" onClick={() => editVisit(visit)}>{t('Edit')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="chart-empty">{loading ? t('Loading protected records…') : t('No field visits are recorded for this park.')}</p>}
          </section>
        </>
      )}
    </div>
  );
}

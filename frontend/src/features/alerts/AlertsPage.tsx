import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import type { AlertHistoryEntry, NationalPark, Watchlist } from '../../services/api';
import { api } from '../../services/api';
import { useTranslation } from 'react-i18next';

type GeofenceType = Watchlist['geofence_type'];

const emptyForm = {
  name: '',
  enabled: true,
  geofence_type: 'preset' as GeofenceType,
  preset: 'mozambique' as Watchlist['preset'],
  park_id: 'gorongosa' as Watchlist['park_id'],
  latitude: -18.6,
  longitude: 35.5,
  radius_km: 50,
  bbox: [-124.5, 32.5, -114.1, 42],
  sensor_filter: 'VIIRS' as Watchlist['sensor_filter'],
  min_frp_mw: 10,
  min_confidence: 'nominal' as Watchlist['min_confidence'],
  notification_frequency: 'immediate' as Watchlist['notification_frequency'],
  recipients: [''],
  subject: 'Firewatch satellite fire alert',
  notes: '',
};

function localTimestamp(timestamp: string, language: string): string {
  return new Date(timestamp).toLocaleString(language === 'pt' ? 'pt-MZ' : 'en-GB');
}

export function AlertsPage() {
  const { t, i18n } = useTranslation();
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
  const [parks, setParks] = useState<NationalPark[]>([]);
  const [form, setForm] = useState(() => ({ ...emptyForm, subject: t('Firewatch satellite fire alert') }));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testRecipient, setTestRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [watchlistResponse, historyResponse, parkResponse] = await Promise.all([
        api.getWatchlists(),
        api.getAlertHistory(),
        api.getParks(),
      ]);
      setWatchlists(watchlistResponse.watchlists);
      setHistory(historyResponse.items);
      setParks(parkResponse.items);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Alert configuration could not be loaded.'));
    }
  }, [t]);

  useEffect(() => { void refresh(); }, [refresh]);

  const updateForm = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const editWatchlist = (item: Watchlist) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      enabled: item.enabled,
      geofence_type: item.geofence_type,
      preset: item.preset ?? 'mozambique',
      park_id: item.park_id ?? 'gorongosa',
      latitude: item.latitude ?? 0,
      longitude: item.longitude ?? 0,
      radius_km: item.radius_km ?? 50,
      bbox: item.bbox ?? [-124.5, 32.5, -114.1, 42],
      sensor_filter: item.sensor_filter,
      min_frp_mw: item.min_frp_mw,
      min_confidence: item.min_confidence,
      notification_frequency: item.notification_frequency,
      recipients: item.recipients,
      subject: item.subject,
      notes: item.notes,
    });
  };

  const clearForm = () => {
    setEditingId(null);
    setForm({ ...emptyForm, subject: t('Firewatch satellite fire alert') });
  };

  const saveWatchlist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const payload: Omit<Watchlist, 'id' | 'created_at' | 'updated_at'> = {
      ...form,
      recipients: form.recipients.map((value) => value.trim()).filter(Boolean),
      bbox: form.geofence_type === 'bbox' ? form.bbox : null,
      preset: form.geofence_type === 'preset' ? form.preset : null,
      park_id: form.geofence_type === 'park' ? form.park_id : null,
      latitude: form.geofence_type === 'radius' ? form.latitude : null,
      longitude: form.geofence_type === 'radius' ? form.longitude : null,
      radius_km: form.geofence_type === 'radius' ? form.radius_km : null,
    };
    try {
      if (editingId) await api.updateWatchlist(editingId, payload);
      else await api.createWatchlist(payload);
      setNotice(editingId ? t('Watchlist updated.') : t('Watchlist created.'));
      clearForm();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Watchlist could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  const removeWatchlist = async (id: string) => {
    if (!window.confirm(t('Delete this watchlist and its pending digest? Dispatch history will remain.'))) return;
    setBusy(true);
    try {
      await api.deleteWatchlist(id);
      if (editingId === id) clearForm();
      await refresh();
      setNotice(t('Watchlist deleted.'));
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Watchlist could not be deleted.'));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.sendTestEmail({
        recipient: testRecipient,
        subject: 'Firewatch SMTP configuration test',
        notes: 'This message verifies the configured server-side SMTP delivery settings.',
      });
      setNotice(t('Test alert accepted by the configured SMTP server.'));
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Test alert delivery failed.'));
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Operational Notifications')}</p>
          <h2>{t('Alerts & Watchlists')}</h2>
          <p className="page-description">{t('Email notifications evaluate newly synchronized NASA FIRMS MODIS/VIIRS observations. EONET events do not have FRP or satellite-confidence metrics and do not trigger thermal watchlists.')}</p>
        </div>
      </header>

      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="inline-success" role="status">{notice}</p>}

      <section className="alerts-layout">
        <form className="section-card alert-form" onSubmit={saveWatchlist}>
          <div className="panel-header">
            <p className="eyebrow">{editingId ? t('Edit configuration') : t('New configuration')}</p>
            <h3>{t('Watchlist geofence & trigger')}</h3>
          </div>
          <label>{t('Watchlist name')}<input required maxLength={100} value={form.name} onChange={(event) => updateForm('name', event.target.value)} /></label>
          <label>{t('Geofence type')}
            <select value={form.geofence_type} onChange={(event) => updateForm('geofence_type', event.target.value as GeofenceType)}>
              <option value="park">{t('Mozambique national park')}</option><option value="preset">{t('Named region preset')}</option><option value="radius">{t('Center + radius')}</option><option value="bbox">{t('Bounding box')}</option>
            </select>
          </label>
          {form.geofence_type === 'park' && (
            <label>{t('National park')}
              <select value={form.park_id ?? 'gorongosa'} onChange={(event) => updateForm('park_id', event.target.value as Watchlist['park_id'])}>
                {parks.map((park) => <option key={park.id} value={park.id}>{park.name} · {park.province}</option>)}
              </select>
            </label>
          )}
          {form.geofence_type === 'preset' && (
            <label>{t('Preset region')}
              <select value={form.preset ?? 'mozambique'} onChange={(event) => updateForm('preset', event.target.value as Watchlist['preset'])}>
                <option value="mozambique">{t('Mozambique')}</option><option value="amazon">{t('Amazon Basin')}</option><option value="california">{t('California')}</option>
              </select>
            </label>
          )}
          {form.geofence_type === 'radius' && (
            <div className="form-grid-three">
              <label>{t('Latitude')}<input required type="number" min="-90" max="90" step="any" value={form.latitude} onChange={(event) => updateForm('latitude', Number(event.target.value))} /></label>
              <label>{t('Longitude')}<input required type="number" min="-180" max="180" step="any" value={form.longitude} onChange={(event) => updateForm('longitude', Number(event.target.value))} /></label>
              <label>{t('Radius km')}<input required type="number" min="0.1" max="2000" step="any" value={form.radius_km} onChange={(event) => updateForm('radius_km', Number(event.target.value))} /></label>
            </div>
          )}
          {form.geofence_type === 'bbox' && (
            <div className="form-grid-four">
              {(['West', 'South', 'East', 'North'] as const).map((label, index) => (
                <label key={label}>{t(label)}<input type="number" step="any" value={form.bbox[index]} onChange={(event) => {
                  const bbox = [...form.bbox];
                  bbox[index] = Number(event.target.value);
                  updateForm('bbox', bbox);
                }} /></label>
              ))}
            </div>
          )}
          <div className="form-grid-two">
            <label>{t('Trigger sensor')}
              <select value={form.sensor_filter} onChange={(event) => updateForm('sensor_filter', event.target.value as Watchlist['sensor_filter'])}>
                <option value="MODIS">MODIS</option><option value="VIIRS">VIIRS</option><option value="HARMONIZED_HIGH_CONFIDENCE">{t('Harmonized high-confidence')}</option>
              </select>
            </label>
            <label>{t('Minimum FRP (MW)')}<input type="number" min="0" step="any" value={form.min_frp_mw} onChange={(event) => updateForm('min_frp_mw', Number(event.target.value))} /></label>
            <label>{t('Minimum confidence')}
              <select value={form.min_confidence} onChange={(event) => updateForm('min_confidence', event.target.value as Watchlist['min_confidence'])}>
                <option value="low">{t('Low')}</option><option value="nominal">{t('Nominal')}</option><option value="high">{t('High')}</option>
              </select>
            </label>
            <label>{t('Notification frequency')}
              <select value={form.notification_frequency} onChange={(event) => updateForm('notification_frequency', event.target.value as Watchlist['notification_frequency'])}>
                <option value="immediate">{t('Immediate real-time')}</option><option value="hourly">{t('Hourly digest')}</option><option value="daily">{t('Daily summary')}</option>
              </select>
            </label>
          </div>
          <label>{t('Recipient email(s), comma separated')}
            <input required type="text" value={form.recipients.join(', ')} onChange={(event) => updateForm('recipients', event.target.value.split(','))} />
          </label>
          <label>{t('Alert subject')}<input maxLength={180} value={form.subject} onChange={(event) => updateForm('subject', event.target.value)} /></label>
          <label>{t('Scientific notes')}<textarea rows={3} maxLength={2000} value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} /></label>
          <label className="sensor-toggle"><input type="checkbox" checked={form.enabled} onChange={(event) => updateForm('enabled', event.target.checked)} />{t('Watchlist enabled')}</label>
          <div className="form-actions">
            <button className="primary-btn" type="submit" disabled={busy}>{busy ? t('Saving…') : editingId ? t('Update watchlist') : t('Create watchlist')}</button>
            {editingId && <button className="secondary-btn" type="button" onClick={clearForm}>{t('Cancel edit')}</button>}
          </div>
          <p className="chart-caption">{t('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM_EMAIL are configured on the backend. Credentials are not sent to or exposed in the browser.')}</p>
        </form>

        <div className="alerts-side">
          <section className="section-card">
            <div className="panel-header"><p className="eyebrow">{t('Persisted configuration')}</p><h3>{t('Active watchlists')}</h3></div>
            {watchlists.length ? (
              <div className="watchlist-stack">
                {watchlists.map((item) => (
                  <article className="watchlist-card" key={item.id}>
                    <div className="watchlist-title"><strong>{item.name}</strong><span className={item.enabled ? 'state-enabled' : 'state-disabled'}>{item.enabled ? t('ENABLED') : t('PAUSED')}</span></div>
                    <p>{item.geofence_type === 'park'
                      ? parks.find((park) => park.id === item.park_id)?.name ?? item.park_id
                      : item.geofence_type === 'preset'
                        ? t(item.preset === 'amazon' ? 'Amazon Basin' : item.preset === 'california' ? 'California' : 'Mozambique')
                        : item.geofence_type === 'radius'
                        ? t('{{radius}} km radius', { radius: item.radius_km })
                        : `${t('BBox')} ${item.bbox?.join(', ')}`}</p>
                    <p>{t(item.sensor_filter)} · ≥ {item.min_frp_mw} MW · {t(item.min_confidence)} {t('confidence')} · {t(item.notification_frequency)}</p>
                    <p>{t('Recipients:')} {item.recipients.join(', ')}</p>
                    <div className="form-actions">
                      <button className="secondary-btn" type="button" onClick={() => editWatchlist(item)}>{t('Edit')}</button>
                      <button className="danger-btn" type="button" disabled={busy} onClick={() => void removeWatchlist(item.id)}>{t('Delete')}</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="chart-empty">{t('No watchlists configured.')}</p>}
          </section>

          <section className="section-card">
            <div className="panel-header"><p className="eyebrow">{t('Delivery configuration')}</p><h3>{t('Send test alert email')}</h3></div>
            <form className="test-email-form" onSubmit={sendTest}>
              <label>{t('Recipient')}<input required type="email" value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} /></label>
              <button className="primary-btn" type="submit" disabled={busy || !testRecipient}>{t('Send Test Alert Email')}</button>
            </form>
          </section>
        </div>
      </section>

      <section className="section-card">
        <div className="panel-header"><p className="eyebrow">{t('Auditable delivery log')}</p><h3>{t('Alert dispatch history')}</h3></div>
        {history.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Triggered UTC')}</th><th>{t('Watchlist')}</th><th>{t('Status')}</th><th>{t('Matched hotspots')}</th><th>{t('Recipients')}</th><th>{t('Delivery detail')}</th></tr></thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td>{localTimestamp(entry.triggered_at, i18n.resolvedLanguage ?? 'en')}</td>
                    <td>{watchlists.find((item) => item.id === entry.watchlist_id)?.name ?? entry.watchlist_id}</td>
                    <td><span className={`dispatch-state dispatch-${entry.status}`}>{t(entry.status)}</span></td>
                    <td>{entry.matched_observations.length ? entry.matched_observations.map((observation) => (
                      <div key={observation.observation_id}>
                        <a href={`https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${observation.longitude},${observation.latitude},8z`} target="_blank" rel="noreferrer">
                          {observation.observation_id}
                        </a> · {observation.frp ?? t('n/a')} MW · {observation.satellite}
                      </div>
                    )) : t('Test message')}</td>
                    <td>{entry.recipients.join(', ')}</td><td>{t(entry.message)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="chart-empty">{t('No alerts or delivery attempts have been recorded.')}</p>}
      </section>
    </div>
  );
}

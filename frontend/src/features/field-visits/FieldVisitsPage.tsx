import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useOperationalContext } from '../../components/layout/OperationalContext';
import { api } from '../../services/api';
import type {
  FieldVisit,
  FieldVisitPayload,
  FieldVisitStatus,
  FireObservation,
  ObservedResult,
  ParkId,
} from '../../services/api';
import { buildAndDownloadFieldVisitDocuments } from './fieldVisitDocuments';

type RecordType = 'detection' | 'manual';
type VisitForm = {
  reportReference: string;
  visitAt: string;
  status: FieldVisitStatus;
  observedResult: ObservedResult | '';
  coordinates: string;
  leadRanger: string;
  unitSector: string;
  notes: string;
  evidenceImageDataUrl: string | null;
  classification: FieldVisitPayload['classification'];
  formCreatedAt: string;
};

const STATUS_OPTIONS: Array<{ value: FieldVisitStatus; label: string }> = [
  { value: 'completed', label: 'Concluída' },
  { value: 'in_progress', label: 'Em curso' },
  { value: 'planned', label: 'Planeada' },
  { value: 'inconclusive', label: 'Inconclusiva' },
];

const RESULT_OPTIONS: Array<{ value: ObservedResult; label: string }> = [
  { value: 'active_fire_signs', label: 'Fogo ativo confirmado' },
  { value: 'burn_scars', label: 'Vestígios de queimada' },
  { value: 'controlled_burn', label: 'Queimada controlada autorizada' },
  { value: 'false_positive', label: 'Falso positivo / Sem sinais' },
  { value: 'access_impossible', label: 'Sem acesso ao local' },
];

const FIELD_REPORT_EMAIL = 'firewatch.mz.alertas@gmail.com';

function localDateTimeToUtc(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}:00+02:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Introduza uma data e hora válidas.');
  return parsed.toISOString();
}

function utcToMaputoInput(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleString('sv-SE', { timeZone: 'Africa/Maputo' }).replace(' ', 'T').slice(0, 16);
}

function createClientId(): string {
  if (typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createReportReference(parkId: ParkId): string {
  const suffix = Array.from(window.crypto.getRandomValues(new Uint8Array(4)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `FW-${parkId.slice(0, 3).toUpperCase()}-${new Date().getUTCFullYear()}-${suffix}`;
}

function emptyForm(parkId: ParkId): VisitForm {
  return {
    reportReference: createReportReference(parkId),
    visitAt: '',
    status: 'completed',
    observedResult: '',
    coordinates: '',
    leadRanger: '',
    unitSector: '',
    notes: '',
    evidenceImageDataUrl: null,
    classification: 'operational',
    formCreatedAt: new Date().toISOString(),
  };
}

function sourceKey(observation: FireObservation): string {
  return `${observation.feed ?? ''}:${observation.observation_id}`;
}

function visitAsObservation(visit: FieldVisit): FireObservation | null {
  if (!visit.satellite_observation_id || !visit.satellite_feed) return null;
  return {
    observation_id: visit.satellite_observation_id,
    latitude: visit.satellite_latitude ?? 0,
    longitude: visit.satellite_longitude ?? 0,
    acquisition_date: visit.satellite_detection_date ?? '',
    acquisition_time: visit.satellite_detection_time_utc,
    satellite: visit.satellite ?? 'Não indicado',
    instrument: visit.instrument ?? 'Não indicado',
    product: visit.satellite_feed,
    processing_type: '',
    source: visit.source ?? 'NASA FIRMS',
    feed: visit.satellite_feed,
  };
}

function displayDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('pt-MZ', { timeZone: 'Africa/Maputo' })
    : 'Não registada';
}

function parseCoordinates(value: string): { latitude: number | null; longitude: number | null } {
  const trimmed = value.trim();
  if (!trimmed) return { latitude: null, longitude: null };
  const parts = trimmed.split(',').map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error('Indique as coordenadas no formato latitude, longitude ou deixe vazio.');
  }
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    throw new Error('As coordenadas GPS devem ser graus decimais válidos.');
  }
  return { latitude, longitude };
}

export function FieldVisitsPage() {
  const { t } = useTranslation();
  const {
    filters,
    parks,
    selectedPark,
    selectedParkId,
    selectedParkLabel,
  } = useOperationalContext();
  const [observations, setObservations] = useState<FireObservation[]>([]);
  const [visits, setVisits] = useState<FieldVisit[]>([]);
  const [selectedObservation, setSelectedObservation] = useState<FireObservation | null>(null);
  const [recordType, setRecordType] = useState<RecordType>('manual');
  const [form, setForm] = useState<VisitForm>(() => emptyForm(selectedParkId));
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [additionalRecipient, setAdditionalRecipient] = useState('');
  const [sendEmailOnSave, setSendEmailOnSave] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingClientId, setSendingClientId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const observationOptions = useMemo(() => {
    if (!selectedObservation || observations.some((item) => sourceKey(item) === sourceKey(selectedObservation))) {
      return observations;
    }
    return [selectedObservation, ...observations];
  }, [observations, selectedObservation]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getFireMap({ ...filters, limit: 5000 }),
      api.getFieldVisits(selectedParkId),
    ]).then(([mapResponse, visitResponse]) => {
      if (!active) return;
      setObservations(mapResponse.items.filter((item) => item.instrument === 'MODIS' || item.instrument === 'VIIRS'));
      setVisits(visitResponse.items);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? t(reason.message) : t('Não foi possível carregar os registos de campo.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [filters, selectedParkId, t]);

  useEffect(() => {
    setSelectedObservation(null);
    setRecordType('manual');
    setEditingClientId(null);
    setForm(emptyForm(selectedParkId));
    setSendEmailOnSave(false);
  }, [selectedParkId]);

  const resetForm = () => {
    setSelectedObservation(null);
    setRecordType('manual');
    setEditingClientId(null);
    setForm(emptyForm(selectedParkId));
    setSendEmailOnSave(false);
  };

  const updateForm = <K extends keyof VisitForm>(key: K, value: VisitForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectObservation = (value: string) => {
    if (value === 'manual') {
      setRecordType('manual');
      setSelectedObservation(null);
      updateForm('coordinates', '');
      return;
    }
    const observation = observationOptions.find((item) => sourceKey(item) === value);
    if (observation) {
      setRecordType('detection');
      setSelectedObservation(observation);
      updateForm('coordinates', `${observation.latitude}, ${observation.longitude}`);
    }
  };

  const selectEvidence = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2_000_000) {
      setError(t('Escolha uma imagem PNG ou JPEG até 2 MB.'));
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateForm('evidenceImageDataUrl', typeof reader.result === 'string' ? reader.result : null);
      setError(null);
    };
    reader.onerror = () => setError(t('Não foi possível ler a imagem selecionada.'));
    reader.readAsDataURL(file);
  };

  const buildPayload = (clientId: string): FieldVisitPayload => {
    if (recordType === 'detection' && !selectedObservation) {
      throw new Error('Selecione uma deteção NASA FIRMS válida.');
    }
    if (!form.visitAt) throw new Error('Introduza uma data e hora válidas.');
    const { latitude, longitude } = parseCoordinates(form.coordinates);
    const visitAtUtc = localDateTimeToUtc(form.visitAt);
    const isPlanned = form.status === 'planned';
    return {
      client_id: clientId,
      report_reference: form.reportReference,
      park_id: selectedParkId,
      record_type: recordType,
      satellite_observation_id: recordType === 'detection' ? selectedObservation?.observation_id ?? null : null,
      satellite_feed: recordType === 'detection' ? selectedObservation?.feed ?? null : null,
      form_created_at_utc: form.formCreatedAt,
      scheduled_at_utc: isPlanned ? visitAtUtc : null,
      actual_visit_at_utc: isPlanned ? null : visitAtUtc,
      status: form.status,
      observed_result: form.observedResult || null,
      field_latitude: latitude,
      field_longitude: longitude,
      lead_ranger: form.leadRanger.trim(),
      unit_sector: form.unitSector.trim(),
      severity: null,
      estimated_area_ha: null,
      vegetation_type: null,
      weather_conditions: [],
      notes: form.notes.trim(),
      evidence_notes: '',
      evidence_image_data_url: form.evidenceImageDataUrl,
      classification: form.classification,
    };
  };

  const buildCurrentVisit = (clientId: string): FieldVisit => {
    const payload = buildPayload(clientId);
    return {
      ...payload,
      satellite_latitude: recordType === 'detection' ? selectedObservation?.latitude ?? null : null,
      satellite_longitude: recordType === 'detection' ? selectedObservation?.longitude ?? null : null,
      satellite_detection_date: recordType === 'detection' ? selectedObservation?.acquisition_date ?? null : null,
      satellite_detection_time_utc: recordType === 'detection' ? selectedObservation?.acquisition_time ?? null : null,
      satellite: recordType === 'detection' ? selectedObservation?.satellite ?? null : null,
      instrument: recordType === 'detection' ? selectedObservation?.instrument ?? null : null,
      source: recordType === 'detection' ? selectedObservation?.source ?? null : null,
    };
  };

  const downloadCurrentReport = async (format: 'pdf' | 'docx') => {
    if (!selectedPark) return;
    setError(null);
    try {
      const visit = buildCurrentVisit(editingClientId ?? createClientId());
      await buildAndDownloadFieldVisitDocuments(visit, selectedPark, true, format);
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Não foi possível gerar os documentos da ficha.'));
    }
  };

  const saveVisit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let payload: FieldVisitPayload;
    try {
      payload = buildPayload(editingClientId ?? createClientId());
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Não foi possível guardar a ficha de observação.'));
      return;
    }

    const shouldSendEmail = sendEmailOnSave;
    const recipient = additionalRecipient.trim() || null;
    let saved: FieldVisit;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      saved = editingClientId
        ? (await api.updateFieldVisit(payload)).item
        : (await api.createFieldVisit(payload)).item;
      setVisits((current) => [saved, ...current.filter((item) => item.client_id !== saved.client_id)]);
      setNotice(t('Ficha de observação guardada com sucesso.'));
      resetForm();
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Não foi possível guardar a ficha de observação.'));
      setSaving(false);
      return;
    }
    setSaving(false);
    if (shouldSendEmail) await dispatchReport(saved, recipient);
  };

  const editVisit = (visit: FieldVisit) => {
    const observation = visitAsObservation(visit);
    setRecordType(observation ? 'detection' : 'manual');
    setSelectedObservation(observation);
    setEditingClientId(visit.client_id);
    setForm({
      reportReference: visit.report_reference ?? createReportReference(selectedParkId),
      visitAt: utcToMaputoInput(visit.actual_visit_at_utc ?? visit.scheduled_at_utc),
      status: visit.status,
      observedResult: visit.observed_result ?? '',
      coordinates: visit.field_latitude == null || visit.field_longitude == null
        ? ''
        : `${visit.field_latitude}, ${visit.field_longitude}`,
      leadRanger: visit.lead_ranger ?? '',
      unitSector: visit.unit_sector ?? '',
      notes: visit.notes ?? '',
      evidenceImageDataUrl: visit.evidence_image_data_url ?? null,
      classification: visit.classification ?? 'operational',
      formCreatedAt: visit.form_created_at_utc,
    });
    setSendEmailOnSave(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const reportPark = (visit: FieldVisit) => parks.find((park) => park.id === visit.park_id) ?? selectedPark;

  const downloadReport = async (visit: FieldVisit, format: 'pdf' | 'docx') => {
    const park = reportPark(visit);
    if (!park) return;
    setError(null);
    try {
      await buildAndDownloadFieldVisitDocuments(visit, park, true, format);
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Não foi possível gerar os documentos da ficha.'));
    }
  };

  async function dispatchReport(visit: FieldVisit, recipient = additionalRecipient.trim() || null) {
    const park = reportPark(visit);
    if (!park) return;
    setSendingClientId(visit.client_id);
    setError(null);
    setNotice(null);
    try {
      const attachments = await buildAndDownloadFieldVisitDocuments(visit, park, false);
      const response = await api.dispatchFieldVisitReport(visit.client_id, {
        additional_recipient: recipient,
        notes: `${visit.report_reference ?? visit.client_id} · ${park.name} · ${t(visit.status)} · ${visit.observed_result ? t(visit.observed_result) : t('Resultado não registado')}`,
        attachments,
      });
      setNotice(t('Ficha enviada para {{email}}. Estado: {{status}}.', {
        email: response.item.recipients.join(', '),
        status: response.item.status,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Não foi possível enviar a ficha por email.'));
    } finally {
      setSendingClientId(null);
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Ficha de Observação de Campo')} · {selectedParkLabel}</p>
          <h2>{t('Ficha de Observação de Campo')}</h2>
          <p className="page-description">{t('Registe rapidamente a verificação de campo associada a uma deteção ou patrulha.')}</p>
        </div>
        <span className="live-source-tag">{t('{{count}} deteções disponíveis', { count: observations.length.toLocaleString() })}</span>
      </header>

      {selectedPark && (
        <p className="boundary-attribution">
          {selectedPark.boundary_quality === 'approximate' && (
            <strong>{t('Approximate FIRMS extent; not a legal boundary.')} </strong>
          )}
          {selectedPark.boundary_note} {selectedPark.boundary_source} ({selectedPark.boundary_license}).
          {' '}<a href={selectedPark.boundary_url} target="_blank" rel="noreferrer">{t('Consultar limite do parque')}</a>
        </p>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="inline-success" role="status">{notice}</p>}

      <section className="section-card field-visit-form-card">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{editingClientId ? t('Atualizar ficha') : t('Novo relatório de verificação')}</p>
            <h3>{selectedPark?.name ?? selectedParkLabel}</h3>
          </div>
          <span className="metric-unit">{form.reportReference}</span>
        </div>
        <form className="field-visit-form" onSubmit={(event) => void saveVisit(event)}>
          <div className="field-detection-header">
            <label>
              {t('Deteção NASA FIRMS ou tipo de registo')}
              <select
                className="field-observation-select"
                value={recordType === 'manual' ? 'manual' : selectedObservation ? sourceKey(selectedObservation) : ''}
                onChange={(event) => selectObservation(event.target.value)}
              >
                <option value="manual">{t('Patrulha / Registo Manual')}</option>
                <option value="" disabled>{t('Selecione uma deteção do parque e período atuais')}</option>
                {observationOptions.map((record) => (
                  <option key={sourceKey(record)} value={sourceKey(record)}>
                    {record.acquisition_date} {record.acquisition_time ?? ''} UTC · {record.instrument} · {record.observation_id}
                  </option>
                ))}
              </select>
            </label>
            {recordType === 'detection' && selectedObservation && (
              <div className="field-detection-summary" aria-label={t('Resumo da deteção selecionada')}>
                <span><strong>{t('ID')}</strong> {selectedObservation.observation_id}</span>
                <span><strong>{t('Sensor')}</strong> {selectedObservation.instrument}</span>
                <span><strong>{t('UTC')}</strong> {selectedObservation.acquisition_date} {selectedObservation.acquisition_time ?? '—'}</span>
                <span><strong>{t('Coordenadas')}</strong> {selectedObservation.latitude.toFixed(5)}, {selectedObservation.longitude.toFixed(5)}</span>
              </div>
            )}
          </div>

          <div className="field-form-grid">
            <label>{t('Resultado da verificação')}
              <select value={form.observedResult} onChange={(event) => updateForm('observedResult', event.target.value as ObservedResult | '')}>
                <option value="">{t('Selecione o resultado')}</option>
                {RESULT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
              </select>
            </label>
            <label>{t('Estado')}
              <select value={form.status} onChange={(event) => updateForm('status', event.target.value as FieldVisitStatus)}>
                {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
                {form.status === 'cancelled' && <option value="cancelled">{t('Cancelada / sem acesso')}</option>}
              </select>
            </label>
            <label>{t('Observador / Equipa')}
              <input maxLength={120} value={form.leadRanger} onChange={(event) => updateForm('leadRanger', event.target.value)} />
            </label>
            <label>{t('Setor / Zona do Parque')}
              <input maxLength={160} value={form.unitSector} onChange={(event) => updateForm('unitSector', event.target.value)} />
            </label>
            <label>{t('Data e hora da visita (CAT)')}
              <input required type="datetime-local" value={form.visitAt} onChange={(event) => updateForm('visitAt', event.target.value)} />
            </label>
            <label>{t('Coordenadas confirmadas (Lat, Lon)')}
              <input
                inputMode="decimal"
                placeholder="-18.9659, 34.1694"
                value={form.coordinates}
                onChange={(event) => updateForm('coordinates', event.target.value)}
              />
            </label>
            <label>{t('Resumo da observação')}
              <textarea rows={2} maxLength={2000} value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} />
            </label>
            <div className="field-evidence-input">
              <label>{t('Fotografia de evidência (opcional)')}
                <input type="file" accept="image/png,image/jpeg" onChange={selectEvidence} />
              </label>
              <label>{t('Natureza')}
                <select value={form.classification} onChange={(event) => updateForm('classification', event.target.value as FieldVisitPayload['classification'])}>
                  <option value="operational">{t('Operação real')}</option>
                  <option value="simulation">{t('Simulação')}</option>
                </select>
              </label>
            </div>
            {form.evidenceImageDataUrl && (
              <div className="field-evidence-preview">
                <img src={form.evidenceImageDataUrl} alt={t('Pré-visualização da evidência')} />
                <button className="secondary-btn" type="button" onClick={() => updateForm('evidenceImageDataUrl', null)}>{t('Remover imagem')}</button>
              </div>
            )}
          </div>

          <div className="field-form-footer">
            <div className="field-form-footer-actions">
              <button className="primary-btn" type="submit" disabled={saving || loading}>
                {saving ? t('A guardar…') : editingClientId ? t('Atualizar ficha') : t('Guardar Registo')}
              </button>
              <button className="secondary-btn" type="button" disabled={!selectedPark} onClick={() => void downloadCurrentReport('pdf')}>
                {t('Exportar PDF')}
              </button>
              <button className="secondary-btn" type="button" disabled={!selectedPark} onClick={() => void downloadCurrentReport('docx')}>
                {t('Exportar DOCX')}
              </button>
              {editingClientId && <button className="secondary-btn" type="button" onClick={resetForm}>{t('Cancelar edição')}</button>}
            </div>
            <label className="field-email-toggle">
              <input type="checkbox" checked={sendEmailOnSave} onChange={(event) => setSendEmailOnSave(event.target.checked)} />
              <span>{t('Enviar relatório por e-mail para')} <strong>{FIELD_REPORT_EMAIL}</strong></span>
            </label>
            <label className="field-cc-input">{t('CC adicional (opcional)')}
              <input type="email" value={additionalRecipient} onChange={(event) => setAdditionalRecipient(event.target.value)} placeholder={t('nome@exemplo.org')} />
            </label>
          </div>
        </form>
      </section>

      <section className="section-card">
        <div className="panel-header">
          <div><p className="eyebrow">{t('Registos recentes')} · {selectedParkLabel}</p><h3>{t('Verificações de campo')}</h3></div>
          <span className="metric-unit">{t('{{count}} relatórios', { count: visits.length })}</span>
        </div>
        {visits.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Referência')}</th><th>{t('Deteção / tipo')}</th><th>{t('Data/hora da visita')}</th>
                  <th>{t('Estado / resultado')}</th><th>{t('Equipa')}</th><th>{t('Ações')}</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((visit) => (
                  <tr key={visit.client_id}>
                    <td>{visit.report_reference ?? visit.client_id}<br />{parks.find((park) => park.id === visit.park_id)?.name ?? visit.park_id}</td>
                    <td>{visit.record_type === 'manual' || !visit.satellite_observation_id
                      ? t('Patrulha / Registo Manual')
                      : `${visit.instrument ?? ''} · ${visit.satellite_observation_id}`}</td>
                    <td>{displayDate(visit.actual_visit_at_utc ?? visit.scheduled_at_utc)}</td>
                    <td>{t(visit.status)}<br />{visit.observed_result ? t(visit.observed_result) : t('Não registado')}</td>
                    <td>{visit.lead_ranger || '—'}<br />{visit.unit_sector || '—'}</td>
                    <td>
                      <div className="field-report-actions">
                        <button className="secondary-btn" type="button" onClick={() => editVisit(visit)}>{t('Editar')}</button>
                        <button className="secondary-btn" type="button" onClick={() => void downloadReport(visit, 'pdf')}>{t('PDF')}</button>
                        <button className="secondary-btn" type="button" onClick={() => void downloadReport(visit, 'docx')}>{t('DOCX')}</button>
                        <button className="secondary-btn" type="button" disabled={sendingClientId !== null} onClick={() => void dispatchReport(visit)}>
                          {sendingClientId === visit.client_id ? t('A enviar…') : t('Reenviar email')}
                        </button>
                      </div>
                      <details className="field-report-details">
                        <summary>{t('Ver detalhes')}</summary>
                        <dl>
                          <dt>{t('Deteção UTC')}</dt><dd>{visit.satellite_detection_date ? `${visit.satellite_detection_date} ${visit.satellite_detection_time_utc ?? ''}` : t('Não aplicável')}</dd>
                          <dt>{t('Coordenadas do satélite')}</dt><dd>{visit.satellite_latitude ?? '—'}, {visit.satellite_longitude ?? '—'}</dd>
                          <dt>{t('Coordenadas do terreno')}</dt><dd>{visit.field_latitude ?? '—'}, {visit.field_longitude ?? '—'}</dd>
                          <dt>{t('Resumo')}</dt><dd>{visit.notes || '—'}</dd>
                          {visit.evidence_image_data_url && <><dt>{t('Fotografia')}</dt><dd><img className="field-evidence-thumb" src={visit.evidence_image_data_url} alt={t('Evidência do relatório')} /></dd></>}
                        </dl>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="chart-empty">{loading ? t('A carregar relatórios…') : t('Ainda não há relatórios para {{area}}.', { area: selectedParkLabel })}</p>}
      </section>
    </div>
  );
}

export interface FireObservation {
  observation_id: string;
  latitude: number;
  longitude: number;
  acquisition_date: string;
  acquisition_time?: string | null;
  satellite: string;
  instrument: string;
  product: string;
  brightness_temperature?: number | null;
  brightness_temperature_2?: number | null;
  frp?: number | null;
  confidence?: string | number | null;
  day_night?: string | null;
  processing_type: string;
  source: string;
  original_source?: string | null;
  feed?: string | null;
  event_id?: string | null;
  event_title?: string | null;
  event_url?: string | null;
  event_source_url?: string | null;
  event_magnitude?: number | null;
  event_magnitude_unit?: string | null;
  geometry?: GeoJSON.Geometry | null;
  field_verification_status?: FieldVisitStatus;
  field_verification_result?: ObservedResult | null;
  field_report_reference?: string | null;
}

export interface GlobalQuery {
  start_date?: string;
  end_date?: string;
  bbox?: string;
  park_id: ParkId;
}

export type ParkId =
  | 'gorongosa'
  | 'limpopo'
  | 'banhine'
  | 'zinave'
  | 'bazaruto'
  | 'maputo'
  | 'magoe'
  | 'quirimbas'
  | 'niassa_special_reserve'
  | 'niassa_lake_partial_reserve'
  | 'marromeu_national_reserve'
  | 'pomene_national_reserve'
  | 'licuati_forest_reserve'
  | 'ribaue_forest_reserve'
  | 'zomba_forest_reserve'
  | 'nhapacue_forest_reserve'
  | 'mupalue_forest_reserve'
  | 'moribane_forest_reserve'
  | 'mecuburi_forest_reserve'
  | 'matibane_forest_reserve'
  | 'maronga_forest_reserve'
  | 'inhamitanga_forest_reserve'
  | 'derre_forest_reserve'
  | 'baixo_pinda_forest_reserve'
  | 'mucheve_forest_reserve';

export type ParkAreaType = 'national_park' | 'fauna_reserve' | 'forest_reserve';

export interface NationalPark {
  id: ParkId;
  name: string;
  province: string | null;
  area_type: ParkAreaType;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  bbox: [number, number, number, number];
  boundary_source: string;
  boundary_license: string;
  boundary_url: string;
  boundary_note: string;
  boundary_quality: 'mapped' | 'approximate';
}

export type FieldVisitStatus = 'planned' | 'in_progress' | 'completed' | 'inconclusive' | 'cancelled';
export type ObservedResult =
  | 'active_fire_signs'
  | 'burn_scars'
  | 'controlled_burn'
  | 'false_positive'
  | 'no_signs_observed'
  | 'inconclusive'
  | 'unable_to_verify'
  | 'access_impossible';

export interface FieldVisitPayload {
  client_id: string;
  report_reference?: string | null;
  park_id: ParkId;
  record_type: 'detection' | 'manual';
  satellite_observation_id: string | null;
  satellite_feed: string | null;
  form_created_at_utc: string;
  scheduled_at_utc: string | null;
  actual_visit_at_utc: string | null;
  status: FieldVisitStatus;
  observed_result: ObservedResult | null;
  field_latitude: number | null;
  field_longitude: number | null;
  lead_ranger: string;
  unit_sector: string;
  severity: 'low' | 'moderate' | 'high' | 'critical' | null;
  estimated_area_ha: number | null;
  vegetation_type: 'dense_forest' | 'savanna_grass' | 'agricultural' | 'open_forest' | null;
  weather_conditions: Array<'strong_wind' | 'dry_weather' | 'recent_rain'>;
  notes: string;
  evidence_notes: string;
  evidence_image_data_url: string | null;
  classification: 'operational' | 'simulation';
}

export interface FieldVisit extends Omit<
  FieldVisitPayload,
  | 'report_reference'
  | 'record_type'
  | 'lead_ranger'
  | 'unit_sector'
  | 'severity'
  | 'estimated_area_ha'
  | 'vegetation_type'
  | 'weather_conditions'
  | 'evidence_notes'
  | 'evidence_image_data_url'
  | 'classification'
> {
  report_reference?: string | null;
  record_type?: 'detection' | 'manual';
  lead_ranger?: string;
  unit_sector?: string;
  severity?: FieldVisitPayload['severity'];
  estimated_area_ha?: number | null;
  vegetation_type?: FieldVisitPayload['vegetation_type'];
  weather_conditions?: FieldVisitPayload['weather_conditions'];
  evidence_notes?: string;
  evidence_image_data_url?: string | null;
  classification?: FieldVisitPayload['classification'];
  satellite_latitude?: number | null;
  satellite_longitude?: number | null;
  satellite_detection_date?: string | null;
  satellite_detection_time_utc?: string | null;
  satellite?: string | null;
  instrument?: string | null;
  source?: string | null;
  updated_at_utc?: string;
}

export interface FieldVisitReportAttachment {
  filename: string;
  content_type: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  content_base64: string;
}

export interface FieldVisitDispatchPayload {
  additional_recipient: string | null;
  notes: string;
  attachments: [FieldVisitReportAttachment, FieldVisitReportAttachment];
}

export interface DashboardSummary {
  total_detections: number;
  modis_detections: number;
  viirs_detections: number;
  eonet_events: number;
  field_verified_detections: number;
  recent_activity: Array<{
    date: string;
    total: number;
    modis: number;
    viirs: number;
    frp_mw_total: number;
    baseline_mean: number;
    baseline_lower: number;
    baseline_upper: number;
  }>;
  selected_area: string;
  selected_period: string;
  sensor_comparison: { labels: string[]; series: number[]; share: Record<string, number> };
  source_note: string;
  data_retrieval_note: string;
  source_counts: Record<string, number>;
  frp_distribution: Array<{ range: string; count: number }>;
  diurnal_overpasses: Array<{ hour_utc: number; satellite: string; detections: number }>;
}

export interface Telemetry {
  status: 'starting' | 'online' | 'degraded' | 'waiting_for_credentials' | string;
  last_sync_utc: string | null;
  next_sync_in_seconds: number;
  sync_interval_seconds: number;
  active_satellites: string[];
  sources: Record<string, { status: string; message?: string | null; record_count: number }>;
  observation_count: number;
}

export interface PlanetaryItem {
  id: string;
  collection: string;
  datetime: string | null;
  platform: string | null;
  instruments: string[] | null;
  cloud_cover: number | null;
  geometry: GeoJSON.Geometry | null;
  bbox: number[] | null;
  preview_url: string | null;
  tile_url_template: string | null;
  assets: Record<string, string>;
  item_url: string | null;
  provenance: string;
}

export interface Watchlist {
  id: string;
  name: string;
  enabled: boolean;
  geofence_type: 'preset' | 'radius' | 'bbox' | 'park';
  preset?: 'mozambique' | 'amazon' | 'california' | null;
  park_id?: ParkId | null;
  latitude?: number | null;
  longitude?: number | null;
  radius_km?: number | null;
  bbox?: number[] | null;
  sensor_filter: 'MODIS' | 'VIIRS' | 'HARMONIZED_HIGH_CONFIDENCE';
  min_frp_mw: number;
  min_confidence: 'low' | 'nominal' | 'high';
  notification_frequency: 'immediate' | 'hourly' | 'daily';
  recipients: string[];
  subject: string;
  notes: string;
  created_at?: string;
  updated_at?: string;
}

export interface AlertHistoryEntry {
  id: string;
  watchlist_id: string;
  triggered_at: string;
  status: 'queued' | 'sent' | 'failed' | 'not_configured' | string;
  message: string;
  recipients: string[];
  matched_observations: FireObservation[];
}

export interface Anomaly {
  date: string;
  total: number;
  z_score: number;
  baseline_mean: number;
  baseline_std: number;
  note: string;
}

export interface GeneratedReport {
  generated_at: string;
  region: string;
  sensor_selection: string[];
  record_count: number;
  summary: {
    notes: string;
    total_records: number;
    modis_records: number;
    viirs_records: number;
  };
  csv_export: string;
  geojson_export: string;
  notes: string;
}

export interface HarmonizationSummary {
  total_observations: number;
  modis_observations: number;
  viirs_observations: number;
  combined_average_frp: number | null;
  average_frp_by_sensor: Record<string, number | null>;
  temporal_coverage_days: number;
  methodology_note: string;
}

export interface HarmonizationMatch {
  left_observation_id: string;
  right_observation_id: string;
  distance_km: number;
  time_delta_hours: number;
  spatial_threshold_km: number;
  temporal_threshold_hours: number;
  uncertainty_note: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const STARTUP_REQUEST_TIMEOUT_MS = 10_000;

async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 0,
): Promise<T> {
  const controller = timeoutMs > 0 && !init?.signal ? new AbortController() : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : undefined;
  try {
    const response = await fetch(
      `${API_BASE}${path}`,
      controller ? { ...init, signal: controller.signal } : init,
    );
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json() as { detail?: string };
        detail = body.detail || detail;
      } catch {
        // Keep the HTTP status when the server does not return JSON.
      }
      throw new Error(`API request failed: ${detail}`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function queryString(params: object): string {
  const query = new URLSearchParams();
  const entries: [string, unknown][] = Object.entries(params);
  entries.forEach(([key, value]) => {
    if (typeof value === 'string' && value !== '') query.set(key, value);
    if (typeof value === 'number') query.set(key, String(value));
  });
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

function postJSON<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export const api = {
  getHealth: () => request<{ status: string; service: string; sources: string }>(
    '/health',
    undefined,
    STARTUP_REQUEST_TIMEOUT_MS,
  ),
  getParks: () => request<{
    items: NationalPark[];
    boundary_source: string;
    boundary_license: string;
  }>('/parks', undefined, STARTUP_REQUEST_TIMEOUT_MS),
  getTelemetry: (parkId: ParkId) =>
    request<Telemetry>(
      `/system/telemetry${queryString({ park_id: parkId })}`,
      undefined,
      STARTUP_REQUEST_TIMEOUT_MS,
    ),
  syncNow: () => postJSON<Telemetry>('/system/sync', {}),
  getDashboardSummary: (filters: GlobalQuery) =>
    request<DashboardSummary>(`/dashboard/summary${queryString(filters)}`),
  getFires: (params: GlobalQuery & {
    sensor?: string;
    search?: string;
    page?: number;
    page_size?: number;
    min_frp?: number;
  }) => request<{ items: FireObservation[]; total: number; page: number; page_size: number; source: string[] }>(
    `/fires${queryString(params)}`,
  ),
  getFireMap: (params: GlobalQuery & {
    sensor?: string;
    min_frp?: number;
    limit?: number;
  }) =>
    request<{ items: FireObservation[]; count: number; source: string[] }>(`/fire-map${queryString(params)}`),
  getCalendar: (params: GlobalQuery & {
    view?: string;
    sensor?: string;
  }) =>
    request<{ items: Array<{ bucket: string; total: number; modis: number; viirs: number }> }>(
      `/calendar${queryString(params)}`,
    ),
  getAnalyticsTrends: (params: GlobalQuery & { sensor?: string }) =>
    request<{ items: DashboardSummary['recent_activity']; source: string[] }>(
      `/analytics/trends${queryString(params)}`,
    ),
  getAnalyticsComparison: (params: GlobalQuery & { sensor?: string }) =>
    request<{
      comparison: DashboardSummary['sensor_comparison'];
      frp_distribution: DashboardSummary['frp_distribution'];
      diurnal_overpasses: DashboardSummary['diurnal_overpasses'];
      source: string[];
    }>(`/analytics/comparison${queryString(params)}`),
  getAnalyticsAnomalies: (params: GlobalQuery) =>
    request<{ anomalies: Anomaly[] }>(
      `/analytics/anomalies${queryString(params)}`,
    ),
  getHarmonizationSummary: (params: GlobalQuery) =>
    request<HarmonizationSummary>(`/harmonization/summary${queryString(params)}`),
  getHarmonizationMatches: (params: GlobalQuery) =>
    request<{ matches: HarmonizationMatch[] }>(
      `/harmonization/matches${queryString(params)}`,
    ),
  getPlanetaryItems: (params: {
    bbox: string;
    start_date: string;
    end_date: string;
    park_id: ParkId;
    collections?: string;
    limit?: number;
  }) => request<{ items: PlanetaryItem[]; count: number; source: string }>(
    `/planetary-computer/search${queryString(params)}`,
  ),
  getWatchlists: (parkId: ParkId) =>
    request<{ watchlists: Watchlist[] }>(`/alerts${queryString({ park_id: parkId })}`),
  createWatchlist: (payload: Omit<Watchlist, 'id' | 'created_at' | 'updated_at'>) =>
    postJSON<{ watchlist: Watchlist }>('/alerts', payload),
  updateWatchlist: (id: string, payload: Omit<Watchlist, 'id' | 'created_at' | 'updated_at'>) =>
    request<{ watchlist: Watchlist }>(`/alerts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  deleteWatchlist: (id: string) =>
    request<void>(`/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getAlertHistory: (parkId: ParkId) =>
    request<{ items: AlertHistoryEntry[] }>(`/alerts/history${queryString({ park_id: parkId })}`),
  getFieldVisits: (parkId: ParkId) =>
    request<{ items: FieldVisit[] }>(`/field-visits${queryString({ park_id: parkId })}`),
  createFieldVisit: (payload: FieldVisitPayload) =>
    request<{ item: FieldVisit; created: boolean }>('/field-visits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
  updateFieldVisit: (payload: FieldVisitPayload) =>
    request<{ item: FieldVisit }>(`/field-visits/${encodeURIComponent(payload.client_id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
  dispatchFieldVisitReport: (clientId: string, payload: FieldVisitDispatchPayload) =>
    postJSON<{ item: AlertHistoryEntry }>(
      `/field-visits/${encodeURIComponent(clientId)}/dispatch`,
      payload,
    ),
  sendTestEmail: (payload: { recipient: string; subject: string; notes: string }) =>
    postJSON<{ item: AlertHistoryEntry }>('/alerts/test', payload),
  generateReport: (payload: Record<string, unknown>) =>
    postJSON<GeneratedReport>('/reports/generate', payload),
};

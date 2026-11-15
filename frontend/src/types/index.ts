export type Sensor = 'MODIS' | 'VIIRS';

export interface FireObservation {
  observation_id: string;
  latitude: number;
  longitude: number;
  acquisition_date: string;
  acquisition_time?: string;
  satellite: string;
  instrument: string;
  product: string;
  brightness_temperature?: number | null;
  brightness_temperature_2?: number | null;
  frp?: number | null;
  confidence?: number | null;
  day_night?: string;
  processing_type: string;
  source: string;
  original_source?: string;
  version?: string;
}

export interface DashboardSummary {
  total_detections: number;
  modis_detections: number;
  viirs_detections: number;
  recent_activity: Array<{ date: string; total: number; modis: number; viirs: number }>;
  selected_area: string;
  selected_period: string;
  sensor_comparison: { labels: string[]; series: number[]; share: Record<string, number> };
  source_note: string;
  data_retrieval_note: string;
}

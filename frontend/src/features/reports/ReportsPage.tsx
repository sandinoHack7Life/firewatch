import { useEffect, useState } from 'react';

import type { GeneratedReport, NationalPark, ParkId } from '../../services/api';
import { api } from '../../services/api';
import { useOperationalContext } from '../../components/layout/OperationalContext';
import { useTranslation } from 'react-i18next';

export function ReportsPage() {
  const { t } = useTranslation();
  const { filters } = useOperationalContext();
  const [startDate, setStartDate] = useState(filters.start_date ?? '');
  const [endDate, setEndDate] = useState(filters.end_date ?? '');
  const [parkId, setParkId] = useState<ParkId>('gorongosa');
  const [parks, setParks] = useState<NationalPark[]>([]);
  const [sensors, setSensors] = useState<string[]>(['MODIS', 'VIIRS', 'EONET']);
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStartDate(filters.start_date ?? '');
    setEndDate(filters.end_date ?? '');
  }, [filters.start_date, filters.end_date]);

  useEffect(() => {
    let active = true;
    api.getParks()
      .then((response) => { if (active) setParks(response.items); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? t(reason.message) : t('National parks could not be loaded.'));
      });
    return () => { active = false; };
  }, []);

  const toggleSensor = (sensor: string) => {
    setSensors((current) => current.includes(sensor)
      ? current.filter((item) => item !== sensor)
      : [...current, sensor]);
  };

  const runReport = async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      setReport(await api.generateReport({
        region: filters.region,
        park_id: parkId,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        bbox: filters.bbox?.split(',').map(Number),
        sensors,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('Report generation failed.'));
    } finally {
      setLoading(false);
    }
  };

  const download = (content: string, fileName: string, contentType: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: contentType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Reports & Export')} · {parks.find((park) => park.id === parkId)?.name ?? parkId}</p>
          <h2>{t('Source Data Product Builder')}</h2>
          <p className="page-description">{t('Build public CSV and GeoJSON extracts from NASA source records for one mapped national park. Private field visits and team data are never exported.')}</p>
        </div>
      </header>
      {error && <p className="inline-error" role="alert">{error}</p>}

      <section className="section-card controls-column">
        <label>{t('National park')}
          <select value={parkId} onChange={(event) => setParkId(event.target.value as ParkId)}>
            {parks.map((park) => <option key={park.id} value={park.id}>{park.name} · {park.province}</option>)}
          </select>
        </label>
        <label>{t('Start date (UTC)')}<input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label>{t('End date (UTC)')}<input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} /></label>
        <div>
          <span>{t('Source selection')}</span>
          <div className="checkbox-row">
            {['MODIS', 'VIIRS', 'EONET'].map((source) => (
              <label key={source}>
                <input type="checkbox" checked={sensors.includes(source)} onChange={() => toggleSensor(source)} />
                {source === 'EONET' ? t('NASA EONET events') : source}
              </label>
            ))}
          </div>
        </div>
        <button className="primary-btn" type="button" disabled={loading || sensors.length === 0} onClick={() => void runReport()}>
          {loading ? t('Building extract…') : t('Generate report')}
        </button>
      </section>

      {report && (
        <section className="section-card">
          <div className="panel-header"><div><p className="eyebrow">{t('Generated {{date}}', { date: new Date(report.generated_at).toLocaleString() })}</p><h3>{t('{{count}} source records', { count: report.record_count.toLocaleString() })}</h3></div></div>
          <p>{t(report.summary.notes)}</p>
          <p>{t(report.notes)}</p>
          {report.record_count === 0 && <p className="chart-caption">{t('No records matched the selected filters. Exports contain headers / an empty FeatureCollection, not fabricated observations.')}</p>}
          <div className="download-row">
            <button className="primary-btn" type="button" onClick={() => download(report.csv_export, 'firewatch-live-report.csv', 'text/csv;charset=utf-8')}>{t('Download CSV')}</button>
            <button className="primary-btn" type="button" onClick={() => download(report.geojson_export, 'firewatch-live-report.geojson', 'application/geo+json;charset=utf-8')}>{t('Download GeoJSON')}</button>
          </div>
        </section>
      )}
    </div>
  );
}

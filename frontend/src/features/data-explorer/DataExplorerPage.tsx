import { useEffect, useState } from 'react';

import type { FireObservation } from '../../services/api';
import { api } from '../../services/api';
import { useOperationalContext } from '../../components/layout/OperationalContext';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 25;

export function DataExplorerPage() {
  const { t } = useTranslation();
  const { filters, selectedParkLabel } = useOperationalContext();
  const [records, setRecords] = useState<FireObservation[]>([]);
  const [selected, setSelected] = useState<FireObservation | null>(null);
  const [page, setPage] = useState(1);
  const [sensor, setSensor] = useState('');
  const [search, setSearch] = useState('');
  const [minFrp, setMinFrp] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getFires({
      ...filters,
      sensor: sensor || undefined,
      search: search || undefined,
      min_frp: minFrp ? Number(minFrp) : undefined,
      page,
      page_size: PAGE_SIZE,
    })
      .then((response) => {
        if (active) {
          setRecords(response.items);
          setTotal(response.total);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? t(reason.message) : t('Observation query failed.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [filters, page, sensor, search, minFrp]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const downloadCsv = async () => {
    try {
      const report = await api.generateReport({
        region: filters.region,
        start_date: filters.start_date,
        end_date: filters.end_date,
        bbox: filters.bbox?.split(',').map(Number),
        park_id: filters.park_id,
        sensors: sensor ? [sensor] : ['MODIS', 'VIIRS', 'EONET'],
        search: search || undefined,
        min_frp: minFrp ? Number(minFrp) : undefined,
      });
      const link = document.createElement('a');
      const url = URL.createObjectURL(new Blob([report.csv_export], { type: 'text/csv;charset=utf-8' }));
      link.href = url;
      link.download = 'firewatch-observations.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t('CSV export failed.'));
    }
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Data Explorer')} · {selectedParkLabel}</p>
          <h2>{t('Live Observation Records')}</h2>
          <p className="page-description">{t('Server-side filters and pagination over the current source cache. NASA EONET reports remain clearly distinguished from sensor detections.')}</p>
        </div>
        <button className="secondary-btn" type="button" onClick={() => void downloadCsv()}>{t('Export filtered data CSV')}</button>
      </header>

      <section className="section-card controls-row explorer-controls">
        <label>{t('Search source records')}
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t('Event, satellite, product, or ID')} />
        </label>
        <label>{t('Sensor / source')}
          <select value={sensor} onChange={(event) => { setSensor(event.target.value); setPage(1); }}>
            <option value="">{t('All sources')}</option><option value="MODIS">MODIS</option><option value="VIIRS">VIIRS</option><option value="EONET">NASA EONET</option>
          </select>
        </label>
          <label>{t('Minimum FRP (MW)')}
            <input type="number" min="0" step="any" value={minFrp} onChange={(event) => { setMinFrp(event.target.value); setPage(1); }} placeholder={t('No threshold')} />
        </label>
          <span className="metric-unit">{t('{{count}} matching records', { count: total.toLocaleString() })}</span>
      </section>

      {error && <p className="inline-error" role="alert">{error}</p>}

      <section className="section-card table-wrap">
        <table>
          <thead>
            <tr><th>{t('Observation / event')}</th><th>{t('Evidence source')}</th><th>{t('Platform')}</th><th>{t('Acquisition UTC')}</th><th>{t('Latitude')}</th><th>{t('Longitude')}</th><th>{t('FRP MW')}</th><th>{t('Confidence')}</th><th>{t('Field verification')}</th></tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={`${record.feed}:${record.observation_id}`}>
                <td><button className="table-link" type="button" onClick={() => setSelected(record)}>{record.event_title ?? record.observation_id}</button></td>
                <td>{record.source} · {record.instrument}</td>
                <td>{record.satellite}</td>
                <td>{record.acquisition_date} {record.acquisition_time ?? ''}</td>
                <td>{record.latitude.toFixed(5)}</td><td>{record.longitude.toFixed(5)}</td>
                <td>{record.frp ?? t('Not reported')}</td><td>{record.confidence ?? t('Not reported')}</td>
                <td>{record.field_verification_status ? `${t(record.field_verification_status)} · ${record.field_report_reference ?? ''}` : t('Not verified')}</td>
              </tr>
            ))}
            {!records.length && !loading && <tr><td colSpan={9}>{t('No matching source records were returned.')}</td></tr>}
          </tbody>
        </table>
        {loading && <p className="chart-caption">{t('Querying source records…')}</p>}
      </section>

      <div className="pager">
        <button disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>{t('Previous')}</button>
        <span>{t('Page {{page}} of {{pages}}', { page, pages: pageCount })}</span>
        <button disabled={page >= pageCount || loading} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>{t('Next')}</button>
      </div>

      {selected && (
        <div className="drawer-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <aside className="section-card record-drawer" role="dialog" aria-modal="true" aria-label={t('Observation detail')} onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" type="button" onClick={() => setSelected(null)}>{t('Close')}</button>
            <p className="eyebrow">{t('Source record detail')}</p>
            <h3>{selected.event_title ?? selected.observation_id}</h3>
            <dl className="metadata-list">
              <dt>{t('Record ID')}</dt><dd>{selected.observation_id}</dd>
              <dt>{t('Source')}</dt><dd>{selected.source} · {selected.feed}</dd>
              <dt>{t('Sensor')}</dt><dd>{selected.instrument} · {selected.satellite}</dd>
              <dt>{t('Product')}</dt><dd>{selected.product}</dd>
              <dt>{t('Acquisition UTC')}</dt><dd>{selected.acquisition_date} {selected.acquisition_time ?? ''}</dd>
              <dt>{t('Coordinates')}</dt><dd>{selected.latitude}, {selected.longitude}</dd>
              <dt>FRP</dt><dd>{selected.frp ?? t('Not reported')}</dd>
              <dt>{t('Confidence')}</dt><dd>{selected.confidence ?? t('Not reported')}</dd>
              <dt>{t('Day / night')}</dt><dd>{selected.day_night ?? t('Not reported')}</dd>
              <dt>{t('Processing')}</dt><dd>{selected.processing_type}</dd>
            </dl>
            {selected.event_url && <a href={selected.event_url} target="_blank" rel="noreferrer">{t('Open NASA event source')}</a>}
          </aside>
        </div>
      )}
    </div>
  );
}

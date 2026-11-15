import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { DashboardSummary } from '../../services/api';
import { api } from '../../services/api';
import { useOperationalContext } from '../../components/layout/OperationalContext';
import { FIRMS_SENSOR_COLORS, type FirmsSensor } from '../../utils/firmsSensors';
import { useTranslation } from 'react-i18next';

export function DashboardPage() {
  const { t } = useTranslation();
  const { filters, selectedParkLabel } = useOperationalContext();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getDashboardSummary(filters)
      .then((data) => {
        if (active) {
          setSummary(data);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? t(reason.message) : t('Dashboard request failed.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [filters, t]);

  const overpassData = useMemo(() => {
    const grouped = new Map<number, Record<string, number | string>>();
    (summary?.diurnal_overpasses ?? []).forEach(({ hour_utc, satellite, detections }) => {
      const current = grouped.get(hour_utc) ?? { hour_utc };
      current[satellite] = detections;
      grouped.set(hour_utc, current);
    });
    return [...grouped.values()].sort((left, right) => Number(left.hour_utc) - Number(right.hour_utc));
  }, [summary?.diurnal_overpasses]);
  const satelliteNames = [...new Set((summary?.diurnal_overpasses ?? []).map((item) => item.satellite))];
  const satelliteColors = ['#11a9c5', '#ef7d32', '#536d82', '#9c6ade', '#35a66f'];

  if (loading && !summary) return <div className="section-card">{t('Loading live-source summary…')}</div>;
  if (error && !summary) return <div className="section-card inline-error" role="alert">{error}</div>;
  if (!summary) return null;

  const activity = summary.recent_activity;
  const sensorData = ([
    { name: 'MODIS', value: summary.modis_detections },
    { name: 'VIIRS', value: summary.viirs_detections },
  ] satisfies Array<{ name: FirmsSensor; value: number }>).filter((entry) => entry.value > 0);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Operational picture')} · {selectedParkLabel}</p>
          <h2>{t('Fire activity in {{area}}', { area: selectedParkLabel })}</h2>
          <p className="page-description">{t('NASA source-attributed active-event and thermal-anomaly observations for the selected UTC period.')}</p>
        </div>
        <span className="live-source-tag">{loading ? t('Updating') : t('LIVE SOURCE DATA')}</span>
      </header>

      {error && <p className="inline-error" role="alert">{error}</p>}

      <section className="stats-grid command-stats">
        <article className="stat-card">
          <p>{t('Source records')}</p>
          <h3>{summary.total_detections.toLocaleString()}</h3>
          <span>{t('Records for {{area}} and selected period', { area: selectedParkLabel })}</span>
        </article>
        <article className="stat-card">
          <p>{t('MODIS thermal detections')}</p>
          <h3>{summary.modis_detections.toLocaleString()}</h3>
          <span>NASA FIRMS · {t('Aqua / Terra')}</span>
        </article>
        <article className="stat-card">
          <p>{t('VIIRS thermal detections')}</p>
          <h3>{summary.viirs_detections.toLocaleString()}</h3>
          <span>NASA FIRMS · {t('Suomi NPP / NOAA')}</span>
        </article>
        <article className="stat-card">
          <p>{t('Open EONET wildfire events')}</p>
          <h3>{summary.eonet_events.toLocaleString()}</h3>
          <span>{t('Event reports; not hotspot or FRP measurements')}</span>
        </article>
      </section>
      <p className="chart-caption field-verification-summary">
        {t('{{count}} deteções com verificação de campo concluída.', {
          count: summary.field_verified_detections.toLocaleString(),
        })}
      </p>

      {summary.total_detections === 0 && (
        <section className="section-card empty-live-state">
          <h3>{t('No observations match the current filters')}</h3>
          <p>{t(summary.data_retrieval_note)}</p>
          <p>{t('NASA EONET event geometries are displayed independently from NASA FIRMS satellite detections. No sample observations are substituted.')}</p>
        </section>
      )}

      <section className="panel-grid">
        <article className="section-card">
          <div className="panel-header">
            <div><p className="eyebrow">{t('Thermal observations')}</p><h3>{t('Daily activity and baseline')}</h3></div>
            <span className="metric-unit">{t('detections · UTC day')}</span>
          </div>
          <div className="chart-wrap chart-tall">
            {activity.length ? <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activity}>
                <CartesianGrid stroke="#e4ebf0" strokeDasharray="3 4" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="count" allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Area yAxisId="count" type="monotone" dataKey="baseline_upper" stroke="none" fill="#dbeaf2" fillOpacity={0.58} name={t('Baseline upper range')} />
                <Area yAxisId="count" type="monotone" dataKey="baseline_lower" stroke="none" fill="#fff" fillOpacity={1} name={t('Baseline lower range')} />
                <Line yAxisId="count" type="monotone" dataKey="modis" stroke={FIRMS_SENSOR_COLORS.MODIS} strokeWidth={2} dot={false} name="MODIS" />
                <Line yAxisId="count" type="monotone" dataKey="viirs" stroke={FIRMS_SENSOR_COLORS.VIIRS} strokeWidth={2} dot={false} name="VIIRS" />
                <Line yAxisId="count" type="monotone" dataKey="total" stroke="#172c3b" strokeWidth={2.5} dot={false} name={t('Total sensor detections')} />
              </AreaChart>
            </ResponsiveContainer> : <p className="chart-empty">{t('No MODIS/VIIRS thermal detections are available for this period.')}</p>}
          </div>
          <p className="chart-caption">{t('Shaded band is the mean ± one standard deviation over the selected observations; it is descriptive, not a forecast.')}</p>
        </article>

        <article className="section-card">
          <div className="panel-header">
            <div><p className="eyebrow">{t('Sensor contribution')}</p><h3>{t('MODIS / VIIRS share')}</h3></div>
            <span className="metric-unit">{t('sensor records only')}</span>
          </div>
          <div className="chart-wrap chart-tall">
            {sensorData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sensorData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={94} paddingAngle={3}>
                    {sensorData.map((item) => <Cell key={item.name} fill={FIRMS_SENSOR_COLORS[item.name]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="chart-empty">{t('No FIRMS sensor records in this selection.')}</p>}
          </div>
          <p className="chart-caption">{t('NASA EONET event reports are deliberately excluded from sensor detection counts.')}</p>
        </article>
      </section>

      <section className="panel-grid">
        <article className="section-card">
          <div className="panel-header">
            <div><p className="eyebrow">{t('Radiative power')}</p><h3>{t('FRP distribution')}</h3></div>
            <span className="metric-unit">{t('MW bins · records with FRP')}</span>
          </div>
          <div className="chart-wrap">
            {summary.frp_distribution.some((bucket) => bucket.count > 0) ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.frp_distribution}>
                <CartesianGrid stroke="#e4ebf0" strokeDasharray="3 4" />
                <XAxis dataKey="range" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#ef7d32" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer> : <p className="chart-empty">{t('FRP is unavailable until a FIRMS thermal-observation feed is configured and returns records.')}</p>}
          </div>
        </article>
        <article className="section-card">
          <div className="panel-header">
            <div><p className="eyebrow">{t('Acquisition timing')}</p><h3>{t('UTC overpass profile')}</h3></div>
            <span className="metric-unit">{t('FIRMS acquisition times')}</span>
          </div>
          <div className="chart-wrap">
            {overpassData.length ? <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overpassData}>
                <CartesianGrid stroke="#e4ebf0" strokeDasharray="3 4" />
                <XAxis dataKey="hour_utc" type="number" domain={[0, 23]} tickCount={12} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <ReferenceLine x={6} stroke="#9aaab6" strokeDasharray="4 4" />
                {satelliteNames.map((satellite, index) => (
                  <Line
                    key={satellite}
                    type="monotone"
                    dataKey={satellite}
                    stroke={satelliteColors[index % satelliteColors.length]}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer> : <p className="chart-empty">{t('No acquisition times in the FIRMS data.')}</p>}
          </div>
        </article>
      </section>

      <section className="section-card">
        <div className="panel-header">
          <div><p className="eyebrow">{t('Provenance')}</p><h3>{t('Source and coverage status')}</h3></div>
        </div>
        <div className="source-counts">
          {Object.entries(summary.source_counts).map(([source, count]) => (
            <div className="source-count" key={source}><span>{source}</span><strong>{count.toLocaleString()}</strong></div>
          ))}
        </div>
        <p className="scientific-note">{t(summary.data_retrieval_note)}</p>
      </section>
    </div>
  );
}

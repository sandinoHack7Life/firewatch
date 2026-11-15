import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api } from '../../services/api';
import type { Anomaly } from '../../services/api';
import { useOperationalContext } from '../../components/layout/OperationalContext';
import { FIRMS_SENSOR_COLORS } from '../../utils/firmsSensors';
import { useTranslation } from 'react-i18next';

export function AnalyticsPage() {
  const { t } = useTranslation();
  const { filters, selectedParkLabel, telemetry } = useOperationalContext();
  const firmsSourceErrors = Object.entries(telemetry?.sources ?? {})
    .filter(([source, status]) => source !== 'NASA_EONET' && status.status === 'error')
    .map(([source]) => source);
  const [trends, setTrends] = useState<Array<{
    date: string;
    total: number;
    modis: number;
    viirs: number;
    frp_mw_total: number;
    baseline_mean: number;
    baseline_lower: number;
    baseline_upper: number;
  }>>([]);
  const [frpHistogram, setFrpHistogram] = useState<Array<{ range: string; count: number }>>([]);
  const [overpasses, setOverpasses] = useState<Array<{ hour_utc: number; satellite: string; detections: number }>>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.getAnalyticsTrends(filters),
      api.getAnalyticsComparison(filters),
      api.getAnalyticsAnomalies(filters),
    ])
      .then(([trendResponse, comparisonResponse, anomalyResponse]) => {
        if (!active) return;
        setTrends(trendResponse.items);
        setFrpHistogram(comparisonResponse.frp_distribution);
        setOverpasses(comparisonResponse.diurnal_overpasses);
        setAnomalies(anomalyResponse.anomalies);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? t(reason.message) : t('Analytics request failed.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [filters, t]);

  const diurnalData = useMemo(() => {
    const grouped = new Map<number, Record<string, number | string>>();
    overpasses.forEach(({ hour_utc, satellite, detections }) => {
      const current = grouped.get(hour_utc) ?? { hour_utc };
      current[satellite] = detections;
      grouped.set(hour_utc, current);
    });
    return [...grouped.values()].sort((left, right) => Number(left.hour_utc) - Number(right.hour_utc));
  }, [overpasses]);
  const satelliteNames = useMemo(() => [...new Set(overpasses.map((item) => item.satellite))], [overpasses]);
  const satelliteColors = ['#11a9c5', '#ef7d32', '#536d82', '#9c6ade', '#35a66f'];

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Historical Analytics')} · {selectedParkLabel}</p>
          <h2>{t('Sensor Activity & Anomaly Analysis')}</h2>
          <p className="page-description">{t('Statistics are computed from real FIRMS thermal detections in the selected UTC window; event reports without FRP are excluded.')}</p>
        </div>
        {loading && <span className="live-source-tag">{t('Updating')}</span>}
      </header>
      {error && <p className="inline-error" role="alert">{error}</p>}

      <section className="panel-grid">
        <article className="section-card">
          <div className="panel-header">
            <div><p className="eyebrow">{t('Daily time series')}</p><h3>{t('Detections and radiative power')}</h3></div>
            <span className="metric-unit">{t('left: count · right: MW')}</span>
          </div>
          <div className="chart-wrap chart-tall">
            {trends.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trends}>
                  <CartesianGrid stroke="#e4ebf0" strokeDasharray="3 4" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="count" allowDecimals={false} />
                  <YAxis yAxisId="frp" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Area yAxisId="count" dataKey="baseline_upper" stroke="none" fill="#dbeaf2" fillOpacity={0.75} name={t('Baseline upper')} />
                  <Area yAxisId="count" dataKey="baseline_lower" stroke="none" fill="#fff" fillOpacity={1} name={t('Baseline lower')} />
                  <Line yAxisId="count" type="monotone" dataKey="total" stroke="#1b3444" strokeWidth={2} dot={false} name={t('Total sensor detections')} />
                  <Line yAxisId="count" type="monotone" dataKey="modis" stroke={FIRMS_SENSOR_COLORS.MODIS} dot={false} name="MODIS" />
                  <Line yAxisId="count" type="monotone" dataKey="viirs" stroke={FIRMS_SENSOR_COLORS.VIIRS} dot={false} name="VIIRS" />
                  <Bar yAxisId="frp" dataKey="frp_mw_total" fill="#edb34d" fillOpacity={0.65} name="FRP sum (MW)" />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <p className="chart-empty">
                {firmsSourceErrors.length > 0
                  ? t('FIRMS feeds failed: {{feeds}}. Check the latest source status; no substitute data are shown.', {
                    feeds: firmsSourceErrors.join(', '),
                  })
                  : t('No FIRMS thermal observations are available for this range.')}
              </p>
            )}
          </div>
          <p className="chart-caption">{t('Shaded band is the selected-window mean ± population standard deviation. It is an exploratory baseline, not a forecast or incident confirmation.')}</p>
        </article>

        <article className="section-card">
          <div className="panel-header">
            <div><p className="eyebrow">{t('Power distribution')}</p><h3>{t('Observed FRP by range')}</h3></div>
            <span className="metric-unit">{t('MW · only reported FIRMS FRP')}</span>
          </div>
          <div className="chart-wrap chart-tall">
            {frpHistogram.some((item) => item.count > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={frpHistogram}>
                  <CartesianGrid stroke="#e4ebf0" strokeDasharray="3 4" />
                  <XAxis dataKey="range" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ef7d32" radius={[4, 4, 0, 0]} name={t('FIRMS observations')} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <p className="chart-empty">{t('FRP is unavailable for the current feed and selection.')}</p>}
          </div>
        </article>
      </section>

      <section className="section-card">
        <div className="panel-header">
        <div><p className="eyebrow">{t('Orbital sampling')}</p><h3>{t('UTC acquisition-time profile')}</h3></div>
        <span className="metric-unit">{t('observed acquisition times only')}</span>
        </div>
        <div className="chart-wrap chart-tall">
          {diurnalData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={diurnalData}>
                <CartesianGrid stroke="#e4ebf0" strokeDasharray="3 4" />
                <XAxis dataKey="hour_utc" type="number" domain={[0, 23]} tickCount={12} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                {satelliteNames.map((satellite, index) => (
                  <Line
                    key={satellite}
                    type="monotone"
                    dataKey={satellite}
                    stroke={satelliteColors[index % satelliteColors.length]}
                    connectNulls={false}
                    dot={false}
                  />
                ))}
                <ReferenceLine x={12} stroke="#90a2af" strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="chart-empty">{t('The current source records do not include satellite acquisition times.')}</p>}
        </div>
      </section>

      <section className="section-card">
        <div className="panel-header">
        <div><p className="eyebrow">{t('Statistical screening')}</p><h3>{t('Daily anomaly flags')}</h3></div>
        <span className="metric-unit">|z| &gt; 1.5 · {t('relative to selected period')}</span>
        </div>
        {anomalies.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Date UTC')}</th><th>{t('Detections')}</th><th>{t('Z-score')}</th><th>{t('Baseline mean ± SD')}</th><th>{t('Interpretation')}</th></tr></thead>
              <tbody>
                {anomalies.map((item) => (
                  <tr key={item.date}>
                    <td>{item.date}</td><td>{item.total}</td><td>{item.z_score}</td>
                    <td>{item.baseline_mean} ± {item.baseline_std}</td><td>{t(item.note)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="chart-empty">{t('No dates exceed the anomaly threshold in this selection.')}</p>}
      </section>
    </div>
  );
}

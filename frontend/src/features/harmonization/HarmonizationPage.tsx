import { useEffect, useState } from 'react';

import { api } from '../../services/api';
import type { HarmonizationMatch, HarmonizationSummary } from '../../services/api';
import { useOperationalContext } from '../../components/layout/OperationalContext';
import { useTranslation } from 'react-i18next';

export function HarmonizationPage() {
  const { t } = useTranslation();
  const { filters, selectedParkLabel } = useOperationalContext();
  const [summary, setSummary] = useState<HarmonizationSummary | null>(null);
  const [matches, setMatches] = useState<HarmonizationMatch[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getHarmonizationSummary(filters),
      api.getHarmonizationMatches(filters),
    ])
      .then(([summaryData, matchesData]) => {
        if (!active) return;
        setSummary(summaryData);
        setMatches(matchesData.matches);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? t(reason.message) : t('Harmonization query failed.'));
      })
    return () => { active = false; };
  }, [filters, t]);

  if (error) return <p className="inline-error" role="alert">{error}</p>;
  if (!summary) return <div className="section-card">{t('Computing associations from current MODIS and VIIRS records…')}</div>;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Harmonization Explorer')} · {selectedParkLabel}</p>
          <h2>{t('Cross-Sensor Association Analysis')}</h2>
          <p className="page-description">{t('Original observations remain distinct; proximity matches are associations, not duplicate removal or proof of a shared physical fire.')}</p>
        </div>
      </header>

      <section className="stats-grid command-stats">
        <article className="stat-card"><p>{t('MODIS observations')}</p><h3>{summary.modis_observations.toLocaleString()}</h3><span>{t('Nominal 1 km thermal detection footprint')}</span></article>
        <article className="stat-card"><p>{t('VIIRS observations')}</p><h3>{summary.viirs_observations.toLocaleString()}</h3><span>{t('Nominal 375 m I-band footprint for active-fire products')}</span></article>
        <article className="stat-card"><p>{t('Potential associations')}</p><h3>{matches.length.toLocaleString()}</h3><span>{t('Cross-sensor pairs within declared limits')}</span></article>
        <article className="stat-card"><p>{t('FRP mean')}</p><h3>{summary.combined_average_frp === null ? '—' : `${summary.combined_average_frp} MW`}</h3><span>{t('Only records with a reported FRP contribute')}</span></article>
      </section>

      <section className="panel-grid">
        <article className="section-card">
          <div className="panel-header"><h3>{t('Sensor provenance & resolutions')}</h3></div>
          <ul className="key-list">
            <li><strong>MODIS:</strong> {t('Terra and Aqua observations; active-fire product pixels are approximately 1 km at nadir.')}</li>
            <li><strong>VIIRS:</strong> {t('Suomi NPP and NOAA platforms; active-fire I-band pixels are approximately 375 m at nadir.')}</li>
            <li>{t('Scan geometry changes effective footprint away from nadir. Nominal resolution is not an uncertainty radius.')}</li>
            <li>{t('Acquisition times, confidence encodings, processing streams, and source products are preserved per observation.')}</li>
            <li>{t('NASA EONET wildfire events are catalog reports, not thermal sensor detections, and are excluded here.')}</li>
          </ul>
        </article>
        <article className="section-card">
          <div className="panel-header"><h3>{t('Association rule & limitations')}</h3></div>
          <p className="scientific-note">{t(summary.methodology_note)}</p>
          <ul className="key-list">
            <li>{t('Candidate pairs require one MODIS and one VIIRS record within 1.5 km great-circle distance and 12 hours.')}</li>
            <li>{t('Great-circle distance uses a Haversine calculation on WGS84 longitude / latitude coordinates.')}</li>
            <li>{t('Time differences use source acquisition date and time; missing or unparsable times are not matched.')}</li>
            <li>{t('Cloud obscuration, geolocation uncertainty, pixel footprints, and orbit geometry are not resolved by point proximity.')}</li>
          </ul>
        </article>
      </section>

      <section className="section-card">
        <div className="panel-header"><div><p className="eyebrow">{t('Live feed output')}</p><h3>{t('Potential spatial-temporal associations')}</h3></div><span className="metric-unit">{t('{{count}} observed UTC dates', { count: summary.temporal_coverage_days })}</span></div>
        {matches.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('MODIS record')}</th><th>{t('VIIRS record')}</th><th>{t('Separation km')}</th><th>{t('Δ time h')}</th><th>{t('Thresholds')}</th><th>{t('Interpretation')}</th></tr></thead>
              <tbody>
                {matches.map((match) => (
                  <tr key={`${match.left_observation_id}-${match.right_observation_id}`}>
                    <td>{match.left_observation_id}</td><td>{match.right_observation_id}</td>
                    <td>{match.distance_km.toFixed(3)}</td><td>{match.time_delta_hours}</td>
                    <td>≤ {match.spatial_threshold_km} km / ≤ {match.temporal_threshold_hours} h</td><td>{t(match.uncertainty_note)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="chart-empty">{t('No candidate cross-sensor associations exist in the current selection.')}</p>}
      </section>
    </div>
  );
}

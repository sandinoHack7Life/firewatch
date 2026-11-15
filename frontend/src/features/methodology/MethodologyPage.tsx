import { useTranslation } from 'react-i18next';

export function MethodologyPage() {
  const { t } = useTranslation();
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Methodology & About')}</p>
          <h2>{t('Data Provenance, Harmonization & Limitations')}</h2>
          <p className="page-description">{t('The platform preserves distinctions between satellite thermal detections, reported wildfire events, and contextual imagery.')}</p>
        </div>
      </header>

      <section className="section-card">
        <h3>{t('Live observation sources')}</h3>
        <ul className="key-list">
          <li><strong>NASA FIRMS:</strong> {t('near-real-time MODIS, Suomi NPP VIIRS, and NOAA-20 VIIRS active-fire CSV feeds. Direct feeds require an operator-configured')} <code>FIRMS_MAP_KEY</code>.</li>
          <li><strong>NASA EONET:</strong> {t('open wildfire event reports are queried without credentials. EONET geometries and event links are not thermal anomaly measurements; FRP and sensor confidence remain unavailable unless the source reports them.')}</li>
          <li><strong>Microsoft Planetary Computer STAC:</strong> {t('public item searches provide acquisition metadata, footprints, cloud cover when present, provider provenance, COG assets, and item previews for MODIS fire products, Sentinel-2 L2A, and Landsat C2 L2.')}</li>
          <li>{t('Each API response preserves `source` / `feed` provenance. Source errors appear in system telemetry; the application does not substitute sample records.')}</li>
        </ul>
        <div className="source-links">
          <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS</a>
          <a href="https://eonet.gsfc.nasa.gov/docs/v3" target="_blank" rel="noreferrer">NASA EONET API v3</a>
          <a href="https://planetarycomputer.microsoft.com/api/stac/v1" target="_blank" rel="noreferrer">Planetary Computer STAC API</a>
          <a href="https://www.earthdata.nasa.gov/data/tools/firms" target="_blank" rel="noreferrer">NASA FIRMS documentation</a>
        </div>
      </section>

      <section className="panel-grid">
        <article className="section-card">
          <h3>{t('Sensor characteristics')}</h3>
          <ul className="key-list">
            <li>{t('MODIS active-fire pixels are approximately 1 km at nadir.')}</li>
            <li>{t('VIIRS active-fire I-band pixels are approximately 375 m at nadir.')}</li>
            <li>{t('Effective ground footprint varies with scan angle; nominal resolution is not an uncertainty radius.')}</li>
            <li>{t('Terra, Aqua, Suomi NPP, and NOAA platforms have different local overpass times. UI profiles use acquisition times present in source records.')}</li>
            <li>{t('FRP is reported in megawatts when available. It is not inferred from EONET event size or raster collection metadata.')}</li>
          </ul>
        </article>
        <article className="section-card">
          <h3>{t('Cross-sensor association rule')}</h3>
          <p>{t('Potential associations pair one MODIS and one VIIRS observation when their WGS84 point coordinates are within 1.5 km great-circle distance and acquisition times are within 12 hours.')}</p>
          <p>{t('Distance is computed with the Haversine formula. Missing or invalid acquisition times are excluded rather than treated as coincident.')}</p>
          <p>{t('Associations are candidate links only. They are not validated physical equivalence, deduplicated detections, or confirmation of a ground fire.')}</p>
        </article>
      </section>

      <section className="section-card">
        <h3>{t('Planetary Computer collection semantics')}</h3>
        <ul className="key-list">
          <li><code>modis-14A1-061</code> {t('is a MODIS daily eight-day packaged fire product at 1 km; its assets include fire-mask and maximum-FRP bands.')}</li>
          <li><code>modis-14A2-061</code> {t('is an eight-day maximum fire-pixel-class composite, not a point event feed.')}</li>
          <li><code>sentinel-2-l2a</code> {t('and')} <code>landsat-c2-l2</code> {t('provide contextual imagery and metadata. They are not active-fire detections by themselves.')}</li>
          <li>{t('STAC search results are scoped to the current map query bounds and UTC date window. Their footprints and original asset links remain attributed to their provider.')}</li>
        </ul>
      </section>

      <section className="section-card">
        <h3>{t('Operational limitations')}</h3>
        <ul className="key-list">
          <li>{t('FIRMS NRT collection and availability depend on the upstream service and configured key. When absent, the map can show open EONET event reports but cannot claim live MODIS/VIIRS FRP detections.')}</li>
          <li>{t('Cloud cover, smoke, canopy, viewing geometry, and algorithm thresholds affect detectability and confidence.')}</li>
          <li>{t('Satellite detection is not a fire perimeter, burned-area estimate, severity classification, or ground-truth incident determination.')}</li>
          <li>{t('EONET update cadence and source reporting latency differ from satellite acquisition time.')}</li>
          <li>{t('Email alert delivery requires backend SMTP configuration. Every attempt is retained with delivery state and matched observation identifiers.')}</li>
          <li>{t('Public satellite imagery tile providers may rate-limit requests. Source item links remain available when map tiles cannot be loaded.')}</li>
        </ul>
      </section>
    </div>
  );
}

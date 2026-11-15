import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import { CircleMarker, GeoJSON as LeafletGeoJSON, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { FireObservation, NationalPark, ParkId, PlanetaryItem } from '../../services/api';
import { api } from '../../services/api';
import { useOperationalContext } from '../../components/layout/OperationalContext';
import { FIRMS_SENSOR_COLORS, getFirmsSensor } from '../../utils/firmsSensors';

type SensorMode = 'both' | 'MODIS' | 'VIIRS';
type DisplayMode = 'real' | 'simulation';
type CalendarView = 'daily' | 'weekly' | 'monthly';

const DEFAULT_PARK_ID: ParkId = 'gorongosa';

const baseLayers = {
  OpenStreetMap: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  'Satellite imagery': {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
  'Topographic': {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap contributors',
  },
} as const;

const sensorColors: Record<string, string> = {
  ...FIRMS_SENSOR_COLORS,
  EONET: '#aab8c4',
  SIMULATION: '#9b7de3',
};

function markerRadius(record: FireObservation): number {
  if (record.instrument === 'EONET') return 5;
  return Math.max(4, Math.min(13, 4 + Math.sqrt(Math.max(0, record.frp ?? 0)) * 0.65));
}

function HeatOverlay({ points }: { points: [number, number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return undefined;
    const layer = L.heatLayer(points, {
      radius: 25,
      blur: 20,
      maxZoom: 9,
      minOpacity: 0.2,
      gradient: { 0.25: '#25c5df', 0.55: '#ffb13b', 0.85: '#ed553e', 1: '#c51e35' },
    });
    layer.addTo(map);
    return () => { map.removeLayer(layer); };
  }, [map, points]);
  return null;
}

function MapExtentControl({ onBounds }: { onBounds: (bbox: string) => void }) {
  const map = useMap();
  const { t } = useTranslation();
  useEffect(() => {
    const control = new L.Control({ position: 'topright' });
    control.onAdd = () => {
      const button = L.DomUtil.create('button', 'map-extent-button');
      button.type = 'button';
      button.textContent = t('Apply map bounds globally');
      button.setAttribute('aria-label', t('Apply map bounds globally'));
      L.DomEvent.disableClickPropagation(button);
      button.addEventListener('click', () => {
        const bounds = map.getBounds();
        const bbox = [
          bounds.getWest().toFixed(4),
          bounds.getSouth().toFixed(4),
          bounds.getEast().toFixed(4),
          bounds.getNorth().toFixed(4),
        ].join(',');
        onBounds(bbox);
      });
      return button;
    };
    control.addTo(map);
    return () => { control.remove(); };
  }, [map, onBounds, t]);
  return null;
}

function FitParkBounds({ park }: { park: NationalPark }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.geoJSON(park.geometry).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.08), { maxZoom: 9, animate: false });
  }, [map, park]);
  return null;
}

function illustrativeRecords(park: NationalPark): FireObservation[] {
  const [west, south, east, north] = park.bbox;
  const centerLatitude = (south + north) / 2;
  const centerLongitude = (west + east) / 2;
  return [
    { latitude: centerLatitude, longitude: centerLongitude },
    { latitude: centerLatitude + (north - south) * 0.08, longitude: centerLongitude - (east - west) * 0.08 },
    { latitude: centerLatitude - (north - south) * 0.08, longitude: centerLongitude + (east - west) * 0.08 },
  ].map((point, index) => ({
    observation_id: `SIM-${park.id}-${index + 1}`,
    latitude: point.latitude,
    longitude: point.longitude,
    acquisition_date: 'Illustrative only',
    acquisition_time: null,
    satellite: 'No satellite source',
    instrument: 'SIMULATION',
    product: 'Illustrative map marker',
    processing_type: 'simulation',
    source: 'SIMULATION ONLY — NOT NASA DATA',
    feed: 'SIMULATION',
  }));
}

export function FireMapPage() {
  const { t } = useTranslation();
  const { filters, setMapBounds, telemetry } = useOperationalContext();
  const [parks, setParks] = useState<NationalPark[]>([]);
  const [parkId, setParkId] = useState<ParkId>(DEFAULT_PARK_ID);
  const [sensorMode, setSensorMode] = useState<SensorMode>('both');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('real');
  const [calendarView, setCalendarView] = useState<CalendarView>('daily');
  const [calendarBuckets, setCalendarBuckets] = useState<Array<{ bucket: string; total: number }>>([]);
  const [records, setRecords] = useState<FireObservation[]>([]);
  const [selected, setSelected] = useState<FireObservation | null>(null);
  const [planetaryItems, setPlanetaryItems] = useState<PlanetaryItem[]>([]);
  const [selectedImagery, setSelectedImagery] = useState('');
  const [eonetVisible, setEonetVisible] = useState(false);
  const [baseLayer, setBaseLayer] = useState<keyof typeof baseLayers>('OpenStreetMap');
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [frpThreshold, setFrpThreshold] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageryError, setImageryError] = useState<string | null>(null);
  const [hasHarmonizedMatch, setHasHarmonizedMatch] = useState<boolean | null>(null);

  const selectedPark = parks.find((park) => park.id === parkId);

  useEffect(() => {
    let active = true;
    api.getParks()
      .then((response) => { if (active) setParks(response.items); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? t(reason.message) : t('National park boundaries could not be loaded.'));
      });
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getFireMap({
      ...filters,
      park_id: parkId,
      sensor: sensorMode === 'both' ? undefined : sensorMode,
      limit: 5000,
    })
      .then((response) => {
        if (active) {
          setRecords(response.items);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? t(reason.message) : t('Fire map request failed.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [filters, parkId, sensorMode, telemetry?.last_sync_utc, t]);

  useEffect(() => {
    let active = true;
    api.getCalendar({
      ...filters,
      park_id: parkId,
      view: calendarView,
      sensor: sensorMode === 'both' ? undefined : sensorMode,
    }).then((response) => {
      if (active) setCalendarBuckets(response.items.map(({ bucket, total }) => ({ bucket, total })));
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? t(reason.message) : t('Park detection calendar could not be loaded.'));
    });
    return () => { active = false; };
  }, [calendarView, filters, parkId, sensorMode, t]);

  const realRecords = useMemo(() => records.filter((record) => {
    const sensor = getFirmsSensor(record);
    const isEonet = record.instrument === 'EONET';
    return Number.isFinite(record.latitude)
      && Number.isFinite(record.longitude)
      && record.latitude >= -90
      && record.latitude <= 90
      && record.longitude >= -180
      && record.longitude <= 180
      && (isEonet ? eonetVisible : sensor !== null && (sensorMode === 'both' || sensor === sensorMode))
      && (isEonet || (record.frp ?? 0) >= frpThreshold);
  }), [records, eonetVisible, frpThreshold, sensorMode]);

  const simulationRecords = useMemo(
    () => selectedPark ? illustrativeRecords(selectedPark) : [],
    [selectedPark],
  );
  const visibleRecords = displayMode === 'real' ? realRecords : simulationRecords;

  const heatPoints = useMemo<[number, number, number][]>(() => visibleRecords
    .filter((record) => record.instrument !== 'EONET' && record.instrument !== 'SIMULATION' && record.frp !== null && record.frp !== undefined)
    .map((record) => [
      record.latitude,
      record.longitude,
      Math.max(0.08, Math.min(1, record.frp! / 80)),
    ]), [visibleRecords]);

  const imagery = planetaryItems.find((item) => item.id === selectedImagery);
  const hasSatelliteRecords = records.some((record) => getFirmsSensor(record) !== null);
  const firmsCredentialsRequired = Object.entries(telemetry?.sources ?? {})
    .some(([source, status]) => source !== 'NASA_EONET' && status.status === 'credentials_required');

  const inspectObservation = async (record: FireObservation) => {
    if (record.instrument === 'SIMULATION') {
      setSelected(record);
      setHasHarmonizedMatch(null);
      setPlanetaryItems([]);
      setSelectedImagery('');
      setImageryError(null);
      return;
    }
    setSelected(record);
    setPlanetaryItems([]);
    setSelectedImagery('');
    setImageryError(null);
    setHasHarmonizedMatch(null);
    const delta = 0.35;
    const west = Math.max(-180, record.longitude - delta);
    const south = Math.max(-90, record.latitude - delta);
    const east = Math.min(180, record.longitude + delta);
    const north = Math.min(90, record.latitude + delta);
    const bbox = [west, south, east, north].join(',');
    const [stacResult, matchResult] = await Promise.allSettled([
      api.getPlanetaryItems({
        bbox,
        start_date: filters.start_date ?? record.acquisition_date,
        end_date: filters.end_date ?? record.acquisition_date,
        limit: 12,
      }),
      api.getHarmonizationMatches(filters),
    ]);
    if (stacResult.status === 'fulfilled') {
      setPlanetaryItems(stacResult.value.items);
      const firstWithTiles = stacResult.value.items.find((item) => item.tile_url_template);
      if (firstWithTiles) setSelectedImagery(firstWithTiles.id);
    } else {
      setImageryError(stacResult.reason instanceof Error ? t(stacResult.reason.message) : t('STAC imagery search failed.'));
    }
    if (matchResult.status === 'fulfilled') {
      const matches = matchResult.value.matches;
      setHasHarmonizedMatch(matches.some((match) => (
        match.left_observation_id === record.observation_id
        || match.right_observation_id === record.observation_id
      )));
    }
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Mozambique National Parks')} · {selectedPark?.province ?? t('Loading boundary')}</p>
          <h2>{t('Firewatch Command Map')}</h2>
          <p className="page-description">{t('Satellite thermal anomalies support field planning; they do not automatically confirm wildfires.')}</p>
        </div>
        <span className="map-record-count">
          {displayMode === 'real' ? t('{{count}} real records', { count: visibleRecords.length.toLocaleString() }) : t('SIMULATION — illustrative only')}
          {loading ? ` · ${t('refreshing')}` : ''}
        </span>
      </header>

      <section className="map-controls section-card">
        <label>
          {t('National park')}
          <select value={parkId} onChange={(event) => {
            setParkId(event.target.value as ParkId);
            setSelected(null);
          }}>
            {parks.map((park) => <option key={park.id} value={park.id}>{park.name} · {park.province}</option>)}
          </select>
        </label>
        <label>
          {t('Satellite sensors')}
          <select value={sensorMode} onChange={(event) => setSensorMode(event.target.value as SensorMode)}>
            <option value="both">{t('Both: VIIRS + MODIS')}</option>
            <option value="VIIRS">{t('VIIRS only (375 m)')}</option>
            <option value="MODIS">{t('MODIS only (1 km)')}</option>
          </select>
        </label>
        <label>
          {t('Data display')}
          <select value={displayMode} onChange={(event) => {
            setDisplayMode(event.target.value as DisplayMode);
            setSelected(null);
          }}>
            <option value="real">{t('Real NASA records')}</option>
            <option value="simulation">{t('Simulation (clearly labeled)')}</option>
          </select>
        </label>
        <label>
          {t('Base layer')}
          <select value={baseLayer} onChange={(event) => setBaseLayer(event.target.value as keyof typeof baseLayers)}>
            {Object.keys(baseLayers).map((layer) => <option key={layer} value={layer}>{t(layer)}</option>)}
          </select>
        </label>
        <label className="sensor-toggle heat-toggle">
          <input type="checkbox" checked={eonetVisible} onChange={(event) => setEonetVisible(event.target.checked)} />
          {t('NASA EONET context')}
        </label>
        <label className="frp-control">
          {t('Minimum FRP')} <strong>{frpThreshold} MW</strong>
          <input type="range" min="0" max="50" step="1" value={frpThreshold} onChange={(event) => setFrpThreshold(Number(event.target.value))} />
          <small>{t('EONET event reports have no FRP and are not filtered by this control.')}</small>
        </label>
        <label className="sensor-toggle heat-toggle">
          <input type="checkbox" checked={heatmapEnabled} onChange={(event) => setHeatmapEnabled(event.target.checked)} />
          {t('FIRMS FRP heatmap')}
        </label>
      </section>

      {error && <p className="inline-error" role="alert">{error}</p>}
      {displayMode === 'simulation' && (
        <p className="simulation-warning" role="status">
          {t('SIMULATION MODE — the map shows illustrative locations only. These are not NASA observations, contain no measured FRP, and cannot create field visits or trigger alerts.')}
        </p>
      )}
      {!loading && !hasSatelliteRecords && firmsCredentialsRequired && (
        <p className="scientific-note">
          {t('No MODIS/VIIRS FIRMS observations are available because the satellite feeds require a configured FIRMS map key.')}
          {' '}{t('NASA EONET events are a separate evidence layer; no real-mode hotspot locations are simulated.')}
        </p>
      )}
      {selectedPark && (
        <p className="boundary-attribution">
          {t(selectedPark.boundary_note)} {t('Park boundary label')} {selectedPark.boundary_source} ({selectedPark.boundary_license}).
          {' '}<a href={selectedPark.boundary_url} target="_blank" rel="noreferrer">{t('View mapped boundary source')}</a>.
        </p>
      )}

      <section className="section-card park-calendar-strip">
        <div className="park-calendar-heading">
          <div><p className="eyebrow">{t('Detection recurrence')} · {selectedPark?.name ?? parkId}</p><h3>{t('Historical activity')}</h3></div>
          <label>{t('Aggregation')}
            <select value={calendarView} onChange={(event) => setCalendarView(event.target.value as CalendarView)}>
              <option value="daily">{t('Daily')}</option><option value="weekly">{t('Weekly')}</option><option value="monthly">{t('Monthly')}</option>
            </select>
          </label>
        </div>
        {calendarBuckets.length ? (
          <div className="park-calendar-buckets">
            {calendarBuckets.slice(-12).map((bucket) => (
              <span key={bucket.bucket} title={t('{{bucket}}: {{count}} records', { bucket: bucket.bucket, count: bucket.total })}>
                <strong>{bucket.total.toLocaleString()}</strong><small>{bucket.bucket}</small>
              </span>
            ))}
          </div>
        ) : <p className="chart-caption">{t('No detections in the selected park and date range. Empty dates are not interpreted as zero fire risk.')}</p>}
      </section>

      <section className="map-workspace">
        <div className="section-card map-shell">
          <MapContainer
            center={selectedPark ? [
              (selectedPark.bbox[1] + selectedPark.bbox[3]) / 2,
              (selectedPark.bbox[0] + selectedPark.bbox[2]) / 2,
            ] : [-18.8, 34.5]}
            zoom={selectedPark ? 7 : 6}
            minZoom={3}
            maxBounds={[[-90, -180], [90, 180]]}
            maxBoundsViscosity={1.0}
            scrollWheelZoom
            className="leaflet-map"
          >
            {selectedPark && (
              <>
                <FitParkBounds park={selectedPark} />
                <LeafletGeoJSON
                  key={selectedPark.id}
                  data={selectedPark.geometry}
                  style={{ color: '#f0a234', weight: 2, fillColor: '#f0a234', fillOpacity: 0.06, dashArray: '5 4' }}
                />
              </>
            )}
            <TileLayer
              attribution={baseLayers[baseLayer].attribution}
              url={baseLayers[baseLayer].url}
              noWrap
            />
            {heatmapEnabled && <HeatOverlay points={heatPoints} />}
            {imagery?.tile_url_template && (
              <TileLayer
                attribution="Microsoft Planetary Computer STAC / source provider"
                url={imagery.tile_url_template}
                opacity={0.62}
                noWrap
              />
            )}
            {visibleRecords.map((record) => {
              const sensor = getFirmsSensor(record);
              const color = sensor ? FIRMS_SENSOR_COLORS[sensor] : sensorColors[record.instrument] ?? '#aab8c4';
              return (
                <CircleMarker
                  key={`${record.feed}:${record.observation_id}`}
                  center={[record.latitude, record.longitude]}
                  radius={markerRadius(record)}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: record.instrument === 'EONET' ? 0.58 : record.instrument === 'SIMULATION' ? 0.5 : 0.84,
                    weight: selected?.observation_id === record.observation_id ? 3 : 1,
                  }}
                  eventHandlers={{ click: () => void inspectObservation(record) }}
                >
                  <Popup>
                    <div className="popup-card">
                      <strong>{record.event_title ?? record.observation_id}</strong>
                      {record.instrument === 'SIMULATION' ? (
                        <div className="simulation-popup">{t('Illustrative location only. No NASA source, FRP, confidence, or field dispatch action.')}</div>
                      ) : (
                        <>
                          <div>{t('Evidence:')} {record.source} · {sensor ?? record.instrument}</div>
                          <div>{t('Platform:')} {record.satellite}</div>
                          <div>FRP: {record.frp === null || record.frp === undefined ? t('not reported') : `${record.frp} MW`}</div>
                          <div>{t('Confidence:')} {record.confidence ?? t('not reported')}</div>
                          <div>{t('Acquisition:')} {record.acquisition_date} {record.acquisition_time ?? ''} UTC</div>
                          <button type="button" onClick={() => void inspectObservation(record)}>{t('Inspect source and imagery')}</button>
                        </>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
            <MapExtentControl onBounds={setMapBounds} />
          </MapContainer>
        </div>

        <aside className="section-card observation-inspector">
          <div className="panel-header">
            <p className="eyebrow">{t('Observation inspector')}</p>
            <h3>{selected?.event_title ?? selected?.observation_id ?? t('Select a map feature')}</h3>
          </div>
          {selected ? (
            <>
              <dl className="metadata-list">
                <dt>{t('Provenance')}</dt><dd>{selected.source} · {selected.feed}</dd>
                <dt>{t('Satellite / sensor')}</dt><dd>{selected.satellite} / {getFirmsSensor(selected) ?? selected.instrument}</dd>
                <dt>{t('Acquisition')}</dt><dd>{selected.acquisition_date} {selected.acquisition_time ?? ''} UTC</dd>
                <dt>{t('Position')}</dt><dd>{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</dd>
                <dt>FRP</dt><dd>{selected.frp ?? t('Not reported')}{selected.frp === null || selected.frp === undefined ? '' : ' MW'}</dd>
                <dt>{t('Confidence')}</dt><dd>{selected.confidence ?? t('Not reported')}</dd>
                <dt>{t('Cross-sensor match')}</dt><dd>{hasHarmonizedMatch === null ? t('Checking…') : hasHarmonizedMatch ? t('Potential proximity match') : t('No match in current selection')}</dd>
                {selected.event_magnitude !== null && selected.event_magnitude !== undefined && (
                  <><dt>{t('EONET reported magnitude')}</dt><dd>{selected.event_magnitude} {selected.event_magnitude_unit}</dd></>
                )}
              </dl>
              {selected.instrument === 'SIMULATION' ? (
                <p className="simulation-popup">{t('This illustrative marker is excluded from all backend data, reports, alerts, and field-visit forms.')}</p>
              ) : (
                <>
                  {selected.event_url && <a href={selected.event_url} target="_blank" rel="noreferrer">{t('Open NASA EONET event record')}</a>}
                  {selected.event_source_url && <a href={selected.event_source_url} target="_blank" rel="noreferrer">{t('Open contributing event source')}</a>}
                  {getFirmsSensor(selected) && selected.feed && (
                    <Link
                      className="field-visit-link"
                      to={`/field-visits?park_id=${parkId}&observation_id=${encodeURIComponent(selected.observation_id)}&feed=${encodeURIComponent(selected.feed)}`}
                    >
                      {t('Create private field verification record')}
                    </Link>
                  )}
                </>
              )}
              <div className="imagery-inspector">
                <h4>{t('Planetary Computer imagery')}</h4>
                {imageryError && <p className="inline-error">{imageryError}</p>}
                {selected.instrument === 'SIMULATION' ? (
                  <p>{t('Imagery lookup is disabled for illustrative simulation markers.')}</p>
                ) : planetaryItems.length > 0 ? (
                  <>
                    <label>
                      {t('STAC item')}
                      <select value={selectedImagery} onChange={(event) => setSelectedImagery(event.target.value)}>
                        {planetaryItems.map((item) => (
                          <option key={item.id} value={item.id}>{item.collection} · {item.datetime ?? item.id}</option>
                        ))}
                      </select>
                    </label>
                    {imagery && (
                      <div className="stac-metadata">
                        <span>{t('Platform:')} {imagery.platform ?? t('not specified')}</span>
                        <span>{t('Cloud cover:')} {imagery.cloud_cover ?? t('not reported')}{imagery.cloud_cover === null ? '' : '%'}</span>
                        {imagery.preview_url && <a href={imagery.preview_url} target="_blank" rel="noreferrer">{t('View item preview')}</a>}
                        {imagery.item_url && <a href={imagery.item_url} target="_blank" rel="noreferrer">{t('Open STAC item metadata')}</a>}
                        {imagery.tile_url_template && <span className="tile-status">{t('Raster tile overlay enabled')}</span>}
                      </div>
                    )}
                  </>
                ) : <p>{t('Querying public STAC imagery near this feature…')}</p>}
              </div>
            </>
          ) : (
            <p className="scientific-note">{t('Select a mapped record to inspect acquisition provenance, confidence, cross-sensor associations, event source, and nearby STAC imagery.')}</p>
          )}
        </aside>
      </section>
    </div>
  );
}

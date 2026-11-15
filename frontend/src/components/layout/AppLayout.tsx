import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { api, type NationalPark, type ParkId, type Telemetry } from '../../services/api';
import { Sidebar } from './Sidebar';
import type { OperationalContextValue } from './OperationalContext';

const DEFAULT_PARK_ID: ParkId = 'gorongosa';
const EXPLICIT_PARK_STORAGE_KEY = 'firewatch-explicit-national-park';
const LEGACY_PARK_STORAGE_KEY = 'firewatch-national-park';

const PARK_GROUPS = [
  { areaType: 'national_park', label: 'Parques Nacionais' },
  { areaType: 'fauna_reserve', label: 'Reservas de Fauna' },
  { areaType: 'forest_reserve', label: 'Reservas Florestais' },
] as const;

const regions = {
  Mozambique: '30.2,-26.9,40.9,-10.4',
  Global: undefined,
  'Amazon Basin': '-74,-16,-44,5',
  California: '-124.5,32.5,-114.1,42',
} as const;

function utcDate(daysAgo = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const requestedParkId = new URLSearchParams(location.search).get('park_id');
  const initialRequestedParkId = useRef(requestedParkId);
  const [utcNow, setUtcNow] = useState(() => new Date());
  const [region, setRegion] = useState<keyof typeof regions>('Mozambique');
  const [parks, setParks] = useState<NationalPark[]>([]);
  const [parksReady, setParksReady] = useState(false);
  const [parkLoadAttempt, setParkLoadAttempt] = useState(0);
  const [selectedParkId, setSelectedParkIdState] = useState<ParkId>(DEFAULT_PARK_ID);
  const telemetryParkIdRef = useRef(selectedParkId);
  const telemetryRequestIdRef = useRef(0);
  telemetryParkIdRef.current = selectedParkId;
  const [startDate, setStartDate] = useState(() => utcDate(30));
  const [endDate, setEndDate] = useState(() => utcDate());
  const [bboxOverride, setBboxOverride] = useState<string | undefined>();
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [parkError, setParkError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const syncParkQuery = useCallback((parkId: ParkId) => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('park_id') === parkId) return;
    searchParams.set('park_id', parkId);
    navigate({
      pathname: location.pathname,
      search: `?${searchParams.toString()}`,
      hash: location.hash,
    }, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  const refreshTelemetry = useCallback(async () => {
    const requestId = ++telemetryRequestIdRef.current;
    try {
      const nextTelemetry = await api.getTelemetry(selectedParkId);
      if (
        requestId !== telemetryRequestIdRef.current
        || telemetryParkIdRef.current !== selectedParkId
      ) return;
      setTelemetry(nextTelemetry);
      setTelemetryError(null);
    } catch (error) {
      if (
        requestId !== telemetryRequestIdRef.current
        || telemetryParkIdRef.current !== selectedParkId
      ) return;
      setTelemetryError(error instanceof Error ? error.message : 'Telemetry request failed.');
    }
  }, [selectedParkId]);

  const retryParkLoad = () => {
    setParkError(null);
    setParkLoadAttempt((attempt) => attempt + 1);
  };

  const telemetryRefreshMs = !telemetry || telemetry.status === 'starting' ? 5_000 : 30_000;

  useEffect(() => {
    void refreshTelemetry();
    const telemetryTimer = window.setInterval(
      () => void refreshTelemetry(),
      telemetryRefreshMs,
    );
    const clockTimer = window.setInterval(() => setUtcNow(new Date()), 1_000);
    return () => {
      telemetryRequestIdRef.current += 1;
      window.clearInterval(telemetryTimer);
      window.clearInterval(clockTimer);
    };
  }, [refreshTelemetry, telemetryRefreshMs]);

  useEffect(() => {
    let active = true;
    let explicitlySelectedParkId: string | null = null;
    try {
      explicitlySelectedParkId = window.localStorage.getItem(EXPLICIT_PARK_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_PARK_STORAGE_KEY);
    } catch {
      explicitlySelectedParkId = null;
    }
    api.getParks()
      .then(({ items }) => {
        if (!active) return;
        const queryPark = items.find((park) => park.id === initialRequestedParkId.current);
        const savedPark = items.find((park) => park.id === explicitlySelectedParkId);
        const defaultPark = items.find((park) => park.id === DEFAULT_PARK_ID);
        const selectedPark = queryPark ?? savedPark ?? defaultPark;
        if (!selectedPark) {
          setParkError('The default park is not available in the park registry.');
          return;
        }
        setParks(items);
        setSelectedParkIdState(selectedPark.id);
        try {
          if (explicitlySelectedParkId && !savedPark) {
            window.localStorage.removeItem(EXPLICIT_PARK_STORAGE_KEY);
          }
        } catch {
          // The registry selection remains valid for this session when storage is unavailable.
        }
        setParksReady(true);
      })
      .catch((error: unknown) => {
        if (active) {
          setParkError(error instanceof Error ? error.message : 'Conservation areas could not be loaded.');
        }
      });
    return () => { active = false; };
  }, [parkLoadAttempt]);

  useEffect(() => {
    if (parksReady) syncParkQuery(selectedParkId);
  }, [parksReady, selectedParkId, syncParkQuery]);

  const filters = useMemo(() => ({
    region,
    start_date: startDate,
    end_date: endDate,
    bbox: bboxOverride ?? regions[region],
    park_id: selectedParkId,
  }), [region, startDate, endDate, bboxOverride, selectedParkId]);

  const syncLiveData = async () => {
    setSyncing(true);
    setTelemetryError(null);
    try {
      await api.syncNow();
      await refreshTelemetry();
    } catch (error) {
      setTelemetryError(error instanceof Error ? t(error.message) : t('Live synchronization failed.'));
    } finally {
      setSyncing(false);
    }
  };

  const status = telemetry?.status ?? (telemetryError ? 'degraded' : 'starting');
  const satellites = telemetry?.active_satellites ?? [];
  const eonetStatus = telemetry?.sources.NASA_EONET?.status;
  const language = i18n.resolvedLanguage === 'pt' ? 'pt' : 'en';
  const selectedPark = parks.find((park) => park.id === selectedParkId) ?? null;
  const requestedPark = parks.find((park) => park.id === requestedParkId);
  const routeParkSelectionReady = requestedParkId === null
    || selectedParkId === (requestedPark?.id ?? DEFAULT_PARK_ID);
  const selectedParkLabel = selectedPark
    ? `${selectedPark.name}${selectedPark.province ? ` - ${selectedPark.province}` : ''}`
    : t('Loading parks…');

  const selectLanguage = (nextLanguage: 'en' | 'pt') => {
    try {
      window.localStorage.setItem('firewatch-language', nextLanguage);
    } catch {
      // Language switching still works when browser storage is unavailable.
    }
    void i18n.changeLanguage(nextLanguage);
  };

  const selectPark = useCallback((parkId: ParkId) => {
    if (!parks.some((park) => park.id === parkId)) return;
    setSelectedParkIdState(parkId);
    setBboxOverride(undefined);
    syncParkQuery(parkId);
    try {
      window.localStorage.setItem(EXPLICIT_PARK_STORAGE_KEY, parkId);
    } catch {
      // The current selection remains active when browser storage is unavailable.
    }
  }, [parks, syncParkQuery]);

  const context: OperationalContextValue = {
    filters,
    setMapBounds: setBboxOverride,
    parks,
    selectedPark,
    selectedParkId,
    selectedParkLabel,
    telemetry,
    telemetryError,
    refreshTelemetry,
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="content-frame">
        <header className="command-header">
            <div className="telemetry-strip">
              <div className="telemetry-status">
                <span className={`status-light status-${status}`} />
                <span>{t(status.replace(/_/g, ' '))}</span>
                <small>
                  {eonetStatus === 'online'
                    ? t('NASA EONET connected')
                    : telemetryError
                      ? t('Live source status unavailable')
                      : t('Checking live source connectivity')}
                </small>
              </div>
              <div className="satellite-strip" aria-label={t('Satellites seen in live FIRMS records')}>
                <span className="telemetry-label">{t('FIRMS platforms')}</span>
                {satellites.length > 0
                  ? satellites.map((satellite) => <span className="satellite-badge" key={satellite}>{satellite}</span>)
                  : <span className="satellite-empty">{t('No satellite records in current feed')}</span>}
              </div>
              <time className="utc-clock" dateTime={utcNow.toISOString()}>
                {utcNow.toISOString().replace('T', ' ').slice(0, 19)} UTC
              </time>
              <div className="language-switch" role="group" aria-label={t('Select language')}>
                {(['en', 'pt'] as const).map((value) => (
                  <span className="language-choice" key={value}>
                    {value === 'pt' && <span className="language-divider" aria-hidden="true">|</span>}
                    <button
                      type="button"
                      aria-pressed={language === value}
                      className={language === value ? 'active' : ''}
                      onClick={() => selectLanguage(value)}
                    >
                      {value.toUpperCase()}
                    </button>
                  </span>
                ))}
              </div>
              <button className="sync-button" onClick={syncLiveData} disabled={syncing}>
                {syncing ? t('Synchronizing…') : t('Sync Live NASA Data Now')}
              </button>
            </div>
            <div className="global-filter-strip">
              <label>
                {t('Region')}
                <select value={region} onChange={(event) => {
                  setRegion(event.target.value as keyof typeof regions);
                  setBboxOverride(undefined);
                }}>
                  {Object.keys(regions).map((name) => <option key={name} value={name}>{t(name)}</option>)}
                </select>
              </label>
              <label>
                {t('Conservation area')}
                {parksReady
                  ? (
                    <select
                      value={selectedParkId}
                      onChange={(event) => {
                        const park = parks.find((item) => item.id === event.target.value);
                        if (park) selectPark(park.id);
                      }}
                    >
                      {PARK_GROUPS.map(({ areaType, label }) => {
                        const items = parks.filter((park) => park.area_type === areaType);
                        return items.length ? (
                          <optgroup key={areaType} label={t(label)}>
                            {items.map((park) => (
                              <option key={park.id} value={park.id}>
                                {park.name}{park.province ? ` - ${park.province}` : ''}
                              </option>
                            ))}
                          </optgroup>
                        ) : null;
                      })}
                    </select>
                  )
                  : (
                    <span className="park-selector-loading">
                      {t(parkError ? 'Parks unavailable' : 'Loading parks…')}
                    </span>
                  )}
              </label>
              <label>
                {t('From (UTC)')}
                <input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label>
                {t('Through (UTC)')}
                <input type="date" value={endDate} min={startDate} max={utcDate()} onChange={(event) => setEndDate(event.target.value)} />
              </label>
              <span className="telemetry-last-sync">
                {t('Last sync:')} {telemetry?.last_sync_utc ? new Date(telemetry.last_sync_utc).toISOString().slice(11, 19) + ' UTC' : t('pending')}
              </span>
            </div>
            {telemetryError && <p className="inline-error" role="alert">{t(telemetryError)}</p>}
            {parkError && (
              <p className="inline-error" role="alert">
                {t(parkError)}{' '}
                <button
                  type="button"
                  onClick={retryParkLoad}
                >
                  {t('Retry')}
                </button>
              </p>
            )}
        </header>
        <main className="content">
          {parkError
            ? (
              <p className="chart-empty" role="alert">
                {t(parkError)}{' '}
                <button type="button" onClick={retryParkLoad}>{t('Retry')}</button>
              </p>
            )
            : parksReady && routeParkSelectionReady
            ? <Outlet context={context} />
            : <p className="chart-empty">{t('Loading parks…')}</p>}
        </main>
      </div>
    </div>
  );
}

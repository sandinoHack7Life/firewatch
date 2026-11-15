import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { api, type Telemetry } from '../../services/api';
import { Sidebar } from './Sidebar';
import type { OperationalContextValue } from './OperationalContext';

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
  const [utcNow, setUtcNow] = useState(() => new Date());
  const [region, setRegion] = useState<keyof typeof regions>('Mozambique');
  const [startDate, setStartDate] = useState(() => utcDate(30));
  const [endDate, setEndDate] = useState(() => utcDate());
  const [bboxOverride, setBboxOverride] = useState<string | undefined>();
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refreshTelemetry = useCallback(async () => {
    try {
      setTelemetry(await api.getTelemetry());
      setTelemetryError(null);
    } catch (error) {
      setTelemetryError(error instanceof Error ? t(error.message) : t('Telemetry request failed.'));
    }
  }, [t]);

  useEffect(() => {
    void refreshTelemetry();
    const telemetryTimer = window.setInterval(() => void refreshTelemetry(), 30_000);
    const clockTimer = window.setInterval(() => setUtcNow(new Date()), 1_000);
    return () => {
      window.clearInterval(telemetryTimer);
      window.clearInterval(clockTimer);
    };
  }, [refreshTelemetry]);

  const filters = useMemo(() => ({
    region,
    start_date: startDate,
    end_date: endDate,
    bbox: bboxOverride ?? regions[region],
  }), [region, startDate, endDate, bboxOverride]);

  const syncLiveData = async () => {
    setSyncing(true);
    setTelemetryError(null);
    try {
      setTelemetry(await api.syncNow());
    } catch (error) {
      setTelemetryError(error instanceof Error ? t(error.message) : t('Live synchronization failed.'));
    } finally {
      setSyncing(false);
    }
  };

  const context: OperationalContextValue = {
    filters,
    setMapBounds: setBboxOverride,
    telemetry,
    telemetryError,
    refreshTelemetry,
  };
  const status = telemetry?.status ?? 'starting';
  const satellites = telemetry?.active_satellites ?? [];
  const eonetStatus = telemetry?.sources.NASA_EONET?.status;
  const language = i18n.resolvedLanguage === 'pt' ? 'pt' : 'en';

  const selectLanguage = (nextLanguage: 'en' | 'pt') => {
    try {
      window.localStorage.setItem('firewatch-language', nextLanguage);
    } catch {
      // Language switching still works when browser storage is unavailable.
    }
    void i18n.changeLanguage(nextLanguage);
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
            {telemetryError && <p className="inline-error" role="alert">{telemetryError}</p>}
        </header>
        <main className="content">
          <Outlet context={context} />
        </main>
      </div>
    </div>
  );
}

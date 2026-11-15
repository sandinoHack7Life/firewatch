import { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/api';
import { useOperationalContext } from '../../components/layout/OperationalContext';
import { useTranslation } from 'react-i18next';

type CalendarView = 'daily' | 'weekly' | 'monthly';
interface CalendarBucket {
  bucket: string;
  total: number;
  modis: number;
  viirs: number;
  baseline: number | null;
}

function isoWeekBucket(date: Date): string {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `W${String(week).padStart(2, '0')}-${thursday.getUTCFullYear()}`;
}

function bucketAlignmentKey(bucket: string, view: CalendarView): string {
  if (view === 'daily') return bucket.slice(5);
  if (view === 'monthly') return bucket.slice(5);
  return bucket.slice(0, 3);
}

function completeCalendar(
  items: Array<{ bucket: string; total: number; modis: number; viirs: number }>,
  start: string,
  end: string,
  view: CalendarView,
  baselineItems: Array<{ bucket: string; total: number }>,
): CalendarBucket[] {
  const actual = new Map(items.map((item) => [item.bucket, item]));
  const baseline = new Map(baselineItems.map((item) => [bucketAlignmentKey(item.bucket, view), item.total]));
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) return [];

  const buckets = new Map<string, CalendarBucket>();
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    let bucket: string;
    if (view === 'weekly') bucket = isoWeekBucket(cursor);
    else if (view === 'monthly') bucket = cursor.toISOString().slice(0, 7);
    else bucket = cursor.toISOString().slice(0, 10);
    if (!buckets.has(bucket)) {
      const observed = actual.get(bucket);
      buckets.set(bucket, {
        bucket,
        total: observed?.total ?? 0,
        modis: observed?.modis ?? 0,
        viirs: observed?.viirs ?? 0,
        baseline: baseline.get(bucketAlignmentKey(bucket, view)) ?? null,
      });
    }
    if (view === 'monthly') cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    else if (view === 'weekly') cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return [...buckets.values()];
}

function shiftYear(value: string, years: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const shiftedYear = year + years;
  const maxDay = new Date(Date.UTC(shiftedYear, month, 0)).getUTCDate();
  return `${shiftedYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
}

export function CalendarPage() {
  const { t } = useTranslation();
  const { filters, selectedParkLabel } = useOperationalContext();
  const [view, setView] = useState<CalendarView>('daily');
  const [sensor, setSensor] = useState('');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [calendar, setCalendar] = useState<CalendarBucket[]>([]);
  const [baselineAvailable, setBaselineAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const activeStart = selectedYear === null ? filters.start_date ?? today : `${selectedYear}-01-01`;
  const activeEnd = selectedYear === null
    ? filters.end_date ?? today
    : selectedYear === new Date().getUTCFullYear() ? today : `${selectedYear}-12-31`;
  const baselineStart = shiftYear(activeStart, -1);
  const baselineEnd = shiftYear(activeEnd, -1);
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getUTCFullYear();
    return Array.from({ length: currentYear - 1999 }, (_, index) => currentYear - index);
  }, []);

  useEffect(() => {
    setSelectedYear(null);
  }, [filters.start_date, filters.end_date]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.getCalendar({
        ...filters,
        start_date: activeStart,
        end_date: activeEnd,
        view,
        sensor: sensor || undefined,
      }),
      api.getCalendar({
        ...filters,
        start_date: baselineStart,
        end_date: baselineEnd,
        view,
        sensor: sensor || undefined,
      }),
    ]).then(([currentResponse, baselineResponse]) => {
      if (!active) return;
      setBaselineAvailable(baselineResponse.items.length > 0);
      setCalendar(completeCalendar(
        currentResponse.items,
        activeStart,
        activeEnd,
        view,
        baselineResponse.items,
      ));
      setError(null);
    })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? t(reason.message) : t('Calendar request failed.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [activeEnd, activeStart, baselineEnd, baselineStart, filters, sensor, t, view]);

  const maxValue = Math.max(...calendar.map((item) => item.total), 0);
  const maxBaseline = Math.max(...calendar.map((item) => item.baseline ?? 0), 0);
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('Burning Activity Calendar')} · {selectedParkLabel}</p>
          <h2>{t('Observed Detection Calendar')}</h2>
          <p className="page-description">{t('Counts are real stored observations. A blank date means no record was returned, not a zero-risk day.')}</p>
        </div>
        {loading && <span className="live-source-tag">{t('Updating')}</span>}
      </header>
      {error && <p className="inline-error" role="alert">{error}</p>}

      <section className="section-card controls-row">
        <label>{t('Aggregation')}
          <select value={view} onChange={(event) => setView(event.target.value as CalendarView)}>
            <option value="daily">{t('Daily')}</option><option value="weekly">{t('Weekly')}</option><option value="monthly">{t('Monthly')}</option>
          </select>
        </label>
        <label>{t('Sensor')}
          <select value={sensor} onChange={(event) => setSensor(event.target.value)}>
            <option value="">{t('All evidence')}</option><option value="MODIS">MODIS</option><option value="VIIRS">VIIRS</option><option value="EONET">{t('EONET events')}</option>
          </select>
        </label>
        <label>{t('Calendar year')}
          <select value={selectedYear === null ? 'range' : String(selectedYear)} onChange={(event) => {
            setSelectedYear(event.target.value === 'range' ? null : Number(event.target.value));
          }}>
            <option value="range">{t('Global date range')}</option>
            {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <div className="year-navigation">
          <button type="button" className="secondary-btn" disabled={selectedYear === null || selectedYear <= 2000} onClick={() => setSelectedYear((year) => year === null ? null : year - 1)}>{t('Previous year')}</button>
          <button type="button" className="secondary-btn" disabled={selectedYear === null || selectedYear >= new Date().getUTCFullYear()} onClick={() => setSelectedYear((year) => year === null ? null : year + 1)}>{t('Next year')}</button>
        </div>
        <span className="metric-unit">{t('{{count}} observations / events', { count: calendar.reduce((sum, item) => sum + item.total, 0).toLocaleString() })}</span>
      </section>

      <p className="chart-caption">
        {t('Showing {{start}} through {{end}} UTC.', { start: activeStart, end: activeEnd })} {baselineAvailable
          ? t('Comparison uses the same dates in {{year}} from records currently available.', { year: new Date(`${baselineStart}T00:00:00Z`).getUTCFullYear() })
          : t('No prior-year observations are available for comparison; baseline values are not inferred.')}
      </p>

      <section className="section-card">
        {calendar.length ? (
          <div className="calendar-grid observed-calendar">
            {calendar.map((item) => {
              const intensity = maxValue ? item.total / maxValue : 0;
              const baselineIntensity = maxBaseline ? (item.baseline ?? 0) / maxBaseline : 0;
              return (
                <article
                  key={item.bucket}
                  className="calendar-cell"
                  style={{
                    backgroundColor: intensity
                      ? `rgba(224, ${Math.round(244 - intensity * 112)}, ${Math.round(249 - intensity * 169)}, ${0.34 + intensity * 0.66})`
                      : '#f7fafb',
                  }}
                  title={t('{{bucket}}: {{count}} records', { bucket: item.bucket, count: item.total })}
                  aria-label={item.baseline === null
                    ? t('{{bucket}}: {{count}} observations, no prior-year comparison', { bucket: item.bucket, count: item.total })
                    : t('{{bucket}}: {{count}} observations, prior-year comparison {{baseline}}', { bucket: item.bucket, count: item.total, baseline: item.baseline })}
                >
                  <strong className="calendar-value">{item.total.toLocaleString()}</strong>
                  <span className="calendar-label">{item.bucket}</span>
                  <span className="calendar-split">MODIS {item.modis} · VIIRS {item.viirs}</span>
                  <span className="calendar-baseline" style={{ opacity: item.baseline === null ? 0.4 : 0.55 + baselineIntensity * 0.45 }}>
                    {t('Prior year:')} {item.baseline === null || !baselineAvailable ? t('n/a') : item.baseline.toLocaleString()}
                  </span>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="chart-empty">{loading ? t('Retrieving observations…') : t('No records in {{area}} for this range. Empty dates are not interpolated.', { area: selectedParkLabel })}</p>
        )}
      </section>
    </div>
  );
}

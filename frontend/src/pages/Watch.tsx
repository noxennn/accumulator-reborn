import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  Legend,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useWebSocketData } from '../hooks/useWebSocketData';
import { sensorApi, type WatchPeriodSeries } from '../lib/sensorApi';

const MAX_POINTS = 50;
const SUMMARY_PERIODS = ['day', 'week', 'month'] as const;
type SummaryPeriod = (typeof SUMMARY_PERIODS)[number];

function formatInvalidField(field: string): string {
  const key = field.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key === 'co2') return 'CO₂';
  if (key === 'voc' || key === 'tvoc') return 'VOC';
  if (key === 'pm25' || key === 'pm2p5') return 'PM2.5';
  if (key === 'pm10') return 'PM10';
  return field;
}

function getStatusClass(status?: 'green' | 'yellow' | 'red'): string {
  if (status === 'red')    return 'text-error font-medium';
  if (status === 'yellow') return 'text-warning font-medium';
  if (status === 'green')  return 'text-success';
  return '';
}

const METRICS = [
  { key: 'co2'  as const, label: 'CO₂',   unit: 'ppm',    color: '#6366f1' },
  { key: 'voc'  as const, label: 'VOC',   unit: 'ppb',    color: '#f59e0b' },
  { key: 'pm25' as const, label: 'PM2.5', unit: 'μg/m³',  color: '#ef4444' },
  { key: 'pm10' as const, label: 'PM10',  unit: 'μg/m³',  color: '#10b981' },
];

function formatSummaryLabel(ts: string, granularity: string): string {
  const date = new Date(ts);
  if (granularity === 'hour') {
    return format(date, 'HH:mm');
  }
  return format(date, 'MM-dd');
}

function aggregateFieldCounts(series?: WatchPeriodSeries) {
  return (series?.points ?? []).reduce(
    (acc, point) => {
      acc.co2 += point.invalid_by_field.co2;
      acc.voc += point.invalid_by_field.voc;
      acc.pm25 += point.invalid_by_field.pm25;
      acc.pm10 += point.invalid_by_field.pm10;
      acc.missing += point.invalid_by_field.missing;
      acc.other += point.invalid_by_field.other;
      return acc;
    },
    { co2: 0, voc: 0, pm25: 0, pm10: 0, missing: 0, other: 0 }
  );
}

export default function Watch() {
  const { t } = useTranslation();
  const { dataBuffer, logsBuffer, invalidBuffer, isConnected, error, arduinoStatus } = useWebSocketData();
  const [periodSeries, setPeriodSeries] = useState<Record<SummaryPeriod, WatchPeriodSeries> | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [highlightedTimestamp, setHighlightedTimestamp] = useState<string | null>(null);
  const [hoveredTimestamp, setHoveredTimestamp] = useState<string | null>(null);
  const [chartPulse, setChartPulse] = useState(false);
  const lastSeenTimestampRef = useRef<string | null>(null);

  const latestPoint = dataBuffer[dataBuffer.length - 1] || null;

  useEffect(() => {
    let mounted = true;

    const loadSeries = async () => {
      try {
        if (!mounted) return;
        setSummaryLoading(true);
        const response = await sensorApi.getWatchPeriodSeries();
        if (!mounted) return;
        setPeriodSeries(response);
        setSummaryError(null);
      } catch {
        if (!mounted) return;
        setSummaryError(t('watch.summaryLoadFailed'));
      } finally {
        if (!mounted) return;
        setSummaryLoading(false);
      }
    };

    loadSeries();
    const timer = setInterval(loadSeries, 30000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [t]);

  useEffect(() => {
    if (!latestPoint?.timestamp) return;
    if (latestPoint.timestamp === lastSeenTimestampRef.current) return;

    lastSeenTimestampRef.current = latestPoint.timestamp;
    setHighlightedTimestamp(latestPoint.timestamp);
    setChartPulse(true);

    const rowTimer = setTimeout(() => setHighlightedTimestamp(null), 900);
    const chartTimer = setTimeout(() => setChartPulse(false), 550);

    return () => {
      clearTimeout(rowTimer);
      clearTimeout(chartTimer);
    };
  }, [latestPoint?.timestamp]);

  const chartAnimationEnabled = dataBuffer.length <= MAX_POINTS;

  const estimatedIntervalSeconds = useMemo(() => {
    if (dataBuffer.length < 3) return null;

    const tail = dataBuffer.slice(-6);
    const diffs: number[] = [];

    for (let i = 1; i < tail.length; i += 1) {
      const current = new Date(tail[i].timestamp).getTime();
      const previous = new Date(tail[i - 1].timestamp).getTime();
      const diff = current - previous;
      if (diff > 0) diffs.push(diff);
    }

    if (diffs.length === 0) return null;

    const averageMs = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
    return Math.max(1, Math.round(averageMs / 1000));
  }, [dataBuffer]);

  const chartData = useMemo(
    () =>
      dataBuffer.slice(-MAX_POINTS).map(p => ({
        ...p,
        time: format(new Date(p.timestamp), 'HH:mm:ss'),
      })),
    [dataBuffer]
  );

  const allData = useMemo(() => dataBuffer.slice().reverse(), [dataBuffer]);

  return (
    <div className="px-0 py-2 md:py-4 space-y-4 md:space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('watch.title')}</h1>
          <p className="text-sm opacity-70">
            {t('watch.lastUpdate')}:{' '}
            <span className="font-mono">
              {latestPoint ? format(new Date(latestPoint.timestamp), 'HH:mm:ss') : '-'}
            </span>
          </p>
        </div>
        <div
          className={`badge badge-lg gap-2 ${
            isConnected ? 'badge-success' : 'badge-error'
          }`}
        >
          <span
            className={`inline-block w-2 h-2 rounded-full animate-pulse ${
              isConnected ? 'bg-green-200' : 'bg-red-200'
            }`}
          />
          {isConnected ? t('watch.connected') : t('watch.disconnected')}
        </div>
      </div>

      {error && (
        <div className="alert alert-error text-sm py-2">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card bg-base-200/80 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <p className="text-xs uppercase tracking-wide opacity-60">{t('watch.arduinoFirstConnected')}</p>
            <p className="text-sm font-semibold leading-snug mt-1 font-mono">
              {arduinoStatus.first_connected
                ? format(new Date(arduinoStatus.first_connected), 'dd.MM.yyyy HH:mm:ss')
                : '-'}
            </p>
          </div>
        </div>
        <div className="card bg-base-200/80 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <p className="text-xs uppercase tracking-wide opacity-60">{t('watch.arduinoLastDisconnected')}</p>
            <p className={`text-sm font-semibold leading-snug mt-1 font-mono ${arduinoStatus.last_disconnected && !arduinoStatus.is_connected ? 'text-error' : ''}`}>
              {arduinoStatus.last_disconnected
                ? format(new Date(arduinoStatus.last_disconnected), 'dd.MM.yyyy HH:mm:ss')
                : '-'}
            </p>
          </div>
        </div>
        <div className="card bg-base-200/80 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <p className="text-xs uppercase tracking-wide opacity-60">{t('watch.samplingRate')}</p>
            <p className="text-sm font-semibold leading-snug mt-1 font-mono">
              {estimatedIntervalSeconds ? `${estimatedIntervalSeconds}s` : '-'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t('watch.periodSummaryTitle')}</h2>
          {summaryLoading && <span className="text-xs opacity-60">{t('watch.loadingSummary')}</span>}
        </div>

        {summaryError && (
          <div className="alert alert-warning text-sm py-2">{summaryError}</div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {SUMMARY_PERIODS.map((periodKey) => {
            const series = periodSeries?.[periodKey];
            const isSeriesLoading = summaryLoading && !series;
            const totals = (series?.points ?? []).reduce(
              (acc, point) => {
                acc.logCount += point.log_count;
                acc.invalidCount += point.invalid_count;
                acc.restartWarningCount += point.restart_warning_count;
                return acc;
              },
              { logCount: 0, invalidCount: 0, restartWarningCount: 0 }
            );
            const fieldCounts = aggregateFieldCounts(series);
            const chartPoints = (series?.points ?? []).map(point => ({
              label: formatSummaryLabel(point.bucket_start, series?.granularity ?? 'day'),
              logCount: point.log_count,
              invalidCount: point.invalid_count,
              restartWarningCount: point.restart_warning_count,
            }));

            return (
              <div key={periodKey} className="card bg-base-200 shadow border border-base-300">
                <div className="card-body p-4 gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{t(`watch.${periodKey}`)}</h3>
                    <span className="text-xs opacity-60">{series?.points.length ?? 0} {t('watch.buckets')}</span>
                  </div>

                  {isSeriesLoading ? (
                    <div className="flex justify-center items-center" style={{ height: 286 }}>
                      <span className="loading loading-spinner loading-md opacity-50"></span>
                    </div>
                  ) : (
                    <>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-base-100/70 p-2">
                        <p className="text-[10px] uppercase opacity-60">{t('watch.logs')}</p>
                        <p className="font-semibold">{totals.logCount}</p>
                      </div>
                      <div className="rounded-lg bg-base-100/70 p-2">
                        <p className="text-[10px] uppercase opacity-60">{t('watch.invalidData')}</p>
                        <p className="font-semibold">{totals.invalidCount}</p>
                      </div>
                      <div className="rounded-lg bg-base-100/70 p-2">
                        <p className="text-[10px] uppercase opacity-60">{t('watch.restartWarnings')}</p>
                        <p className="font-semibold">{totals.restartWarningCount}</p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-base-300 bg-base-100/50 p-2">
                      <p className="text-xs font-medium mb-2 opacity-80">{t('watch.invalidByField')}</p>
                      <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
                        <span>CO₂: {fieldCounts.co2}</span>
                        <span>VOC: {fieldCounts.voc}</span>
                        <span>PM2.5: {fieldCounts.pm25}</span>
                        <span>PM10: {fieldCounts.pm10}</span>
                        <span>{t('watch.missing')}: {fieldCounts.missing}</span>
                        <span>{t('watch.other')}: {fieldCounts.other}</span>
                      </div>
                    </div>

                    <ResponsiveContainer width="100%" height={170}>
                      <ComposedChart data={chartPoints} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={18} />
                        <YAxis tick={{ fontSize: 10 }} width={35} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="logCount" name={t('watch.logs')} fill="#60a5fa" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="invalidCount" name={t('watch.invalidData')} fill="#f97316" radius={[4, 4, 0, 0]} />
                        <Line
                          type="monotone"
                          dataKey="restartWarningCount"
                          name={t('watch.restartWarnings')}
                          stroke="#ef4444"
                          strokeWidth={2}
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card bg-base-200 shadow border border-base-300">
        <div className="card-body p-4 md:p-5">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h2 className="card-title text-base">{t('watch.liveData')}</h2>
            <span className="text-xs opacity-60">{allData.length} {t('watch.records')}</span>
          </div>
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="table table-sm">
              <thead className="text-xs uppercase tracking-wide opacity-70 sticky top-0 bg-base-200 z-10">
                <tr>
                  <th>{t('watch.time')}</th>
                  <th>CO₂ (ppm)</th>
                  <th>VOC (ppb)</th>
                  <th>PM2.5 (μg/m³)</th>
                  <th>PM10 (μg/m³)</th>
                </tr>
              </thead>
              <tbody>
                {allData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center opacity-50 py-4">
                      {t('watch.waiting')}
                    </td>
                  </tr>
                ) : (
                  allData.map((p, i) => (
                    <tr
                      key={p.timestamp + i}
                      onMouseEnter={() => setHoveredTimestamp(p.timestamp)}
                      onMouseLeave={() => setHoveredTimestamp(null)}
                      className={`transition-all duration-700 ${
                        i === 0 ? 'font-semibold' : ''
                      } ${
                        p.timestamp === hoveredTimestamp
                          ? 'relative z-10 bg-base-100/90 shadow-[0_10px_24px_-12px_rgba(99,102,241,0.45)]'
                          : ''
                      } ${
                        p.timestamp === highlightedTimestamp
                          ? 'bg-primary/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                          : ''
                      }`}
                    >
                      <td className="font-mono">
                        {format(new Date(p.timestamp), 'HH:mm:ss')}
                      </td>
                      <td className={getStatusClass(p.threshold_status?.co2)}>{p.co2.toFixed(0)}</td>
                      <td className={getStatusClass(p.threshold_status?.voc)}>{p.voc.toFixed(0)}</td>
                      <td className={getStatusClass(p.threshold_status?.pm25)}>{p.pm25.toFixed(1)}</td>
                      <td className={getStatusClass(p.threshold_status?.pm10)}>{p.pm10.toFixed(1)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {METRICS.map(({ key, label, unit, color }) => (
          <div
            key={key}
            className={`card bg-base-200 shadow border border-base-300 transition-all duration-500 ${
              chartPulse ? 'ring-1 ring-primary/30 scale-[1.01]' : ''
            }`}
          >
            <div className="card-body p-4">
              <h2 className="card-title text-sm flex items-center justify-between">
                {label}{' '}
                <span className="text-xs font-normal opacity-50">({unit})</span>
              </h2>
              {chartData.length === 0 ? (
                <div className="flex justify-center items-center" style={{ height: 180 }}>
                  <span className="loading loading-spinner loading-md opacity-40"></span>
                </div>
              ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart
                  data={chartData}
                  margin={{ top: 4, right: 8, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={40}
                  />
                  <YAxis tick={{ fontSize: 10 }} width={45} />
                  <Tooltip
                    formatter={(v: number) => [
                      typeof v === 'number' ? +v.toFixed(1) : v,
                      `${label} (${unit})`
                    ]}
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      border: '1px solid #e5e7eb',
                      borderRadius: '0.5rem',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                      fontSize: 12,
                    }}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Line
                    type="monotone"
                    dataKey={key}
                    stroke={color}
                    dot={(props: any) => {
                      const { cx, cy, payload } = props;
                      if (!hoveredTimestamp || payload?.timestamp !== hoveredTimestamp) return <g />;
                      if (typeof cx !== 'number' || typeof cy !== 'number') return <g />;
                      return <circle cx={cx} cy={cy} r={5} fill="#ffffff" stroke={color} strokeWidth={2} />;
                    }}
                    strokeWidth={2}
                    isAnimationActive={chartAnimationEnabled}
                    animationDuration={chartAnimationEnabled ? 550 : 0}
                    animationEasing="ease-out"
                  />
                </LineChart>
              </ResponsiveContainer>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Arduino Logs */}
        <div className="card bg-base-200 shadow border border-base-300">
          <div className="card-body p-4">
            <h2 className="card-title text-sm mb-2">{t('watch.logs')}</h2>
            <div className="overflow-x-auto max-h-56 overflow-y-auto">
              <table className="table table-sm">
                <thead className="text-xs uppercase tracking-wide opacity-70 sticky top-0 bg-base-200 z-10">
                  <tr>
                    <th>{t('watch.time')}</th>
                    <th>{t('watch.message')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logsBuffer.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="text-center opacity-50 py-4">
                        {t('watch.logsEmpty')}
                      </td>
                    </tr>
                  ) : (
                    logsBuffer.slice().reverse().map((entry, i) => (
                      <tr key={entry.timestamp + i}>
                        <td className="font-mono text-xs whitespace-nowrap">
                          {format(new Date(entry.timestamp), 'HH:mm:ss')}
                        </td>
                        <td className="font-mono text-xs break-all">{entry.message}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Invalid Data */}
        <div className="card bg-base-200 shadow border border-base-300">
          <div className="card-body p-4">
            <h2 className="card-title text-sm mb-2">{t('watch.invalidData')}</h2>
            <div className="overflow-x-auto max-h-56 overflow-y-auto">
              <table className="table table-sm">
                <thead className="text-xs uppercase tracking-wide opacity-70 sticky top-0 bg-base-200 z-10">
                  <tr>
                    <th>{t('watch.time')}</th>
                    <th>{t('watch.field')}</th>
                    <th>{t('watch.value')}</th>
                    <th>{t('watch.reason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {!isConnected && invalidBuffer.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center opacity-50 py-4">
                        {t('watch.waiting')}
                      </td>
                    </tr>
                  ) : invalidBuffer.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center opacity-50 py-4">
                        {t('watch.invalidEmpty')}
                      </td>
                    </tr>
                  ) : (
                    invalidBuffer.slice().reverse().map((entry, i) => (
                      <tr key={entry.timestamp + i} title={`CO₂:${entry.co2} VOC:${entry.voc} PM2.5:${entry.pm25} PM10:${entry.pm10}`}>
                        <td className="font-mono text-xs whitespace-nowrap">
                          {format(new Date(entry.timestamp), 'HH:mm:ss')}
                        </td>
                        <td className="text-xs font-mono">{formatInvalidField(entry.field)}</td>
                        <td className="text-xs font-mono">{entry.value}</td>
                        <td className="text-xs break-all">{entry.reason}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useWebSocketData } from '../hooks/useWebSocketData';

const PERIODS = [1, 5, 15, 30, 60] as const;
type Period = (typeof PERIODS)[number];

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

export default function Watch() {
  const { t } = useTranslation();
  const { dataBuffer, logsBuffer, invalidBuffer, isConnected, error } = useWebSocketData();
  const [period, setPeriod] = useState<Period>(60);
  const [highlightedTimestamp, setHighlightedTimestamp] = useState<string | null>(null);
  const [hoveredTimestamp, setHoveredTimestamp] = useState<string | null>(null);
  const [chartPulse, setChartPulse] = useState(false);
  const lastSeenTimestampRef = useRef<string | null>(null);

  const latestPoint = dataBuffer[dataBuffer.length - 1] || null;

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

  const cutoff = useMemo(() => Date.now() - period * 1000, [period]);
  const windowedData = useMemo(
    () => dataBuffer.filter(p => new Date(p.timestamp).getTime() >= cutoff),
    [dataBuffer, cutoff]
  );

  const chartAnimationEnabled = windowedData.length <= 180;

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
      windowedData.map(p => ({
        ...p,
        time: format(new Date(p.timestamp), 'HH:mm:ss'),
      })),
    [windowedData]
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card bg-base-200/80 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <p className="text-xs uppercase tracking-wide opacity-60">{t('watch.points')}</p>
            <p className="text-2xl font-semibold leading-none mt-1">{windowedData.length}</p>
          </div>
        </div>
        <div className="card bg-base-200/80 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <p className="text-xs uppercase tracking-wide opacity-60">{t('watch.chartWindow')}</p>
            <p className="text-2xl font-semibold leading-none mt-1">{period}s</p>
          </div>
        </div>
        <div className="card bg-base-200/80 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <p className="text-xs uppercase tracking-wide opacity-60">{t('watch.samplingRate')}</p>
            <p className="text-2xl font-semibold leading-none mt-1">
              {estimatedIntervalSeconds ? `${estimatedIntervalSeconds}s` : '-'}
            </p>
          </div>
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

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium opacity-70">{t('watch.chartWindow')}:</span>
        <div className="join">
          {PERIODS.map(p => (
            <button
              key={p}
              className={`join-item btn btn-sm ${
                period === p ? 'btn-primary' : 'btn-ghost'
              }`}
              onClick={() => setPeriod(p)}
            >
              {p}s
            </button>
          ))}
        </div>
        <span className="text-xs opacity-50">
          ({windowedData.length} {t('watch.points')})
        </span>
      </div>

      {windowedData.length === 0 && (
        <div className="alert alert-info text-sm">
          <span>{t('watch.noDataInWindow', { period })}</span>
          {estimatedIntervalSeconds && (
            <span className="opacity-80">
              {t('watch.samplingHint', { interval: estimatedIntervalSeconds })}
            </span>
          )}
        </div>
      )}

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
                      <td colSpan={4} className="text-center py-4">
                        <span className="loading loading-spinner loading-sm opacity-50"></span>
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

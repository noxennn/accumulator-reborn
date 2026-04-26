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

const METRICS = [
  { key: 'co2'  as const, label: 'CO₂',   unit: 'ppm',    color: '#6366f1' },
  { key: 'voc'  as const, label: 'VOC',   unit: 'ppb',    color: '#f59e0b' },
  { key: 'pm25' as const, label: 'PM2.5', unit: 'μg/m³',  color: '#ef4444' },
  { key: 'pm10' as const, label: 'PM10',  unit: 'μg/m³',  color: '#10b981' },
];

export default function Watch() {
  const { t } = useTranslation();
  const { dataBuffer, isConnected, error } = useWebSocketData();
  const [period, setPeriod] = useState<Period>(60);
  const [highlightedTimestamp, setHighlightedTimestamp] = useState<string | null>(null);
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

  const last10 = useMemo(() => dataBuffer.slice(-10).reverse(), [dataBuffer]);

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
            <span className="text-xs opacity-60">{t('watch.latestTen')}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead className="text-xs uppercase tracking-wide opacity-70">
                <tr>
                  <th>{t('watch.time')}</th>
                  <th>CO₂ (ppm)</th>
                  <th>VOC (ppb)</th>
                  <th>PM2.5 (μg/m³)</th>
                  <th>PM10 (μg/m³)</th>
                </tr>
              </thead>
              <tbody>
                {last10.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center opacity-50 py-4">
                      {t('watch.waiting')}
                    </td>
                  </tr>
                ) : (
                  last10.map((p, i) => (
                    <tr
                      key={p.timestamp + i}
                      className={`transition-all duration-700 ${
                        i === 0 ? 'font-semibold' : ''
                      } ${
                        p.timestamp === highlightedTimestamp
                          ? 'bg-primary/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                          : ''
                      }`}
                    >
                      <td className="font-mono">
                        {format(new Date(p.timestamp), 'HH:mm:ss')}
                      </td>
                      <td>{p.co2.toFixed(0)}</td>
                      <td>{p.voc.toFixed(0)}</td>
                      <td>{p.pm25.toFixed(1)}</td>
                      <td>{p.pm10.toFixed(1)}</td>
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
                    contentStyle={{ fontSize: 12 }}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Line
                    type="monotone"
                    dataKey={key}
                    stroke={color}
                    dot={false}
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
    </div>
  );
}

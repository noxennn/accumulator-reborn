import { useState } from 'react';
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

  const cutoff = Date.now() - period * 1000;
  const windowedData = dataBuffer.filter(
    p => new Date(p.timestamp).getTime() >= cutoff
  );

  const chartData = windowedData.map(p => ({
    ...p,
    time: format(new Date(p.timestamp), 'HH:mm:ss'),
  }));

  const last10 = [...dataBuffer].reverse().slice(0, 10);

  return (
    <div className="p-6 space-y-6">
      {/* Header + connection badge */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">{t('watch.title')}</h1>
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

      {/* Live data list — last 10 readings */}
      <div className="card bg-base-200 shadow">
        <div className="card-body p-4">
          <h2 className="card-title text-base mb-2">{t('watch.liveData')}</h2>
          <div className="overflow-x-auto">
            <table className="table table-xs">
              <thead>
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
                    <tr key={p.timestamp + i} className={i === 0 ? 'font-semibold' : ''}>
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

      {/* Period selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium opacity-70">{t('watch.window')}:</span>
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

      {/* Charts — 2×2 grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {METRICS.map(({ key, label, unit, color }) => (
          <div key={key} className="card bg-base-200 shadow">
            <div className="card-body p-4">
              <h2 className="card-title text-sm">
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
                    isAnimationActive={false}
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

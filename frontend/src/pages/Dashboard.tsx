import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceArea } from 'recharts';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { subDays } from 'date-fns';

import AQIIndicator from '../components/AQIIndicator';
import CO2Indicator from '../components/CO2Indicator';
import PM25Indicator from '../components/PM25Indicator';
import PM10Indicator from '../components/PM10Indicator';
import VOCIndicator from '../components/VOCIndicator';
import AlertIndicator from '../components/AlertIndicator';
import { useAlerts } from '../hooks/useAlerts';
import { useDailyStats } from '../hooks/useDailyStats';
import { sensorApi } from '../lib/sensorApi';
import { settingsApi } from '../lib/settingsApi';
import { analyticsApi } from '../lib/analyticsApi';
import { SensorData, UserSettings } from '../types';
import { useAuth } from '../hooks/useAuth';

interface ExceededInterval {
  metric: string;
  start: string;
  end: string;
  threshold: number;
  max_value: number;
  avg_value: number;
  duration_minutes: number;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const TREND_PERIODS = ['5m', '15m', '30m', '1h', '2h'];

const toHHMM = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const Dashboard = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [histLoading, setHistLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentData, setCurrentData] = useState<SensorData | null>(null);
  const [historicalData, setHistoricalData] = useState<SensorData[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);

  const [trendPeriod, setTrendPeriod] = useState('15m');
  const [datePreset, setDatePreset] = useState<'today' | '7d' | '14d' | '30d'>('today');
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime]     = useState(() => toHHMM(new Date()));
  const [timeRangeError, setTimeRangeError] = useState<string | null>(null);

  // Represents what's currently rendered in the chart (applied after clicking Uygula)
  const [applied, setApplied] = useState({
    startTime: '00:00',
    endTime: toHHMM(new Date()),
    trendPeriod: '15m',
    datePreset: 'today' as 'today' | '7d' | '14d' | '30d',
  });

  const isDirty =
    datePreset  !== applied.datePreset  ||
    startTime   !== applied.startTime   ||
    endTime     !== applied.endTime     ||
    trendPeriod !== applied.trendPeriod;

  const [exceededIntervals, setExceededIntervals] = useState<ExceededInterval[]>([]);
  const [hoveredInterval, setHoveredInterval] = useState<ExceededInterval | null>(null);

  const [visibleMetrics, setVisibleMetrics] = useState<Record<string, boolean>>({
    co2: true,
    pm25: true,
    pm10: true,
    voc: true
  });

  useEffect(() => {
    const fetchCurrentData = async () => {
      try {
        setLoading(true);
        const data = await sensorApi.getCurrentData();
        setCurrentData(data);
        setError(null);
      } catch (err) {
        console.error('Error fetching current sensor data:', err);
        setError(t('errors.dataLoadFailed'));
      } finally {
        setLoading(false);
      }
    };

    fetchCurrentData();
    const intervalId = setInterval(fetchCurrentData, 30000);
    return () => clearInterval(intervalId);
  }, [t]);

  const fetchHistoricalData = useCallback(async () => {
    let startDate: Date;
    let clampedEnd: Date;

    if (applied.datePreset === 'today') {
      // --- validation ---
      const [sh, sm] = applied.startTime.split(':').map(Number);
      const [eh, em] = applied.endTime.split(':').map(Number);
      const startMinutes = sh * 60 + sm;
      const endMinutes   = eh * 60 + em;

      if (endMinutes <= startMinutes) {
        setTimeRangeError('Bitiş saati başlangıç saatinden sonra olmalıdır.');
        return;
      }
      if (endMinutes - startMinutes < 5) {
        setTimeRangeError('Aralık en az 5 dakika olmalıdır.');
        return;
      }
      setTimeRangeError(null);

      const today = new Date();
      startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sh, sm, 0);
      const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh, em, 59);
      clampedEnd = endDate > today ? today : endDate;
    } else {
      setTimeRangeError(null);
      const days = applied.datePreset === '7d' ? 7 : applied.datePreset === '14d' ? 14 : 30;
      const now = new Date();
      clampedEnd = now;
      startDate = subDays(now, days - 1);
      startDate.setHours(0, 0, 0, 0);
    }

    try {
      setHistLoading(true);
      const rows = await analyticsApi.getAggregatedData(
        startDate.toISOString(),
        clampedEnd.toISOString(),
        applied.trendPeriod
      );
      const formatted = rows.map((r: any) => ({
        ...r,
        time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
      setHistoricalData(formatted);
    } catch (err) {
      console.error('Error fetching historical sensor data:', err);
      setError(t('errors.historicalDataFailed'));
    } finally {
      setHistLoading(false);
    }
  }, [applied, t]);

  const handleApply = () => {
    if (datePreset === 'today') {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const startMinutes = sh * 60 + sm;
      const endMinutes   = eh * 60 + em;

      if (endMinutes <= startMinutes) {
        setTimeRangeError('Bitiş saati başlangıç saatinden sonra olmalıdır.');
        return;
      }
      if (endMinutes - startMinutes < 5) {
        setTimeRangeError('Aralık en az 5 dakika olmalıdır.');
        return;
      }
      setTimeRangeError(null);
    }
    setApplied({ startTime, endTime, trendPeriod, datePreset });
  };

  useEffect(() => {
    fetchHistoricalData();
    const intervalId = setInterval(fetchHistoricalData, 60000);
    return () => clearInterval(intervalId);
  }, [fetchHistoricalData]);

  useEffect(() => {
    if (!isAuthenticated) return;
    settingsApi.getSettings()
      .then(setSettings)
      .catch(err => console.error('Error fetching user settings:', err));
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let startDate: Date;
    let endDate: Date;
    if (applied.datePreset === 'today') {
      const [sh, sm] = applied.startTime.split(':').map(Number);
      const [eh, em] = applied.endTime.split(':').map(Number);
      const today = new Date();
      startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sh, sm, 0);
      const endD = new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh, em, 59);
      endDate = endD > today ? today : endD;
    } else {
      const days = applied.datePreset === '7d' ? 7 : applied.datePreset === '14d' ? 14 : 30;
      endDate = new Date();
      startDate = subDays(endDate, days - 1);
      startDate.setHours(0, 0, 0, 0);
    }
    sensorApi.getExceededIntervals(startDate.toISOString(), endDate.toISOString())
      .then(setExceededIntervals)
      .catch(() => setExceededIntervals([]));
  }, [isAuthenticated, applied]);

  const toggleMetricVisibility = (metric: string) => {
    setVisibleMetrics(prev => ({ ...prev, [metric]: !prev[metric] }));
  };

  // Find the closest `time` label in historicalData to an ISO timestamp (for ReferenceArea bounds).
  const findClosestTime = (isoTs: string): string | null => {
    if (!historicalData.length) return null;
    const target = new Date(isoTs).getTime();
    let best = historicalData[0] as any;
    let bestDiff = Math.abs(new Date(best.timestamp).getTime() - target);
    for (const p of historicalData as any[]) {
      const diff = Math.abs(new Date(p.timestamp).getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = p; }
    }
    return best.time ?? null;
  };

  const calculateAQI = (pm25: number, pm10: number) => {
    return Math.max((pm25 / 12) * 50, (pm10 / 55) * 50);
  };

  const getLatestData = () => {
    if (currentData) {
      return {
        co2: currentData.co2,
        pm25: currentData.pm25,
        pm10: currentData.pm10,
        voc: currentData.voc,
        aqi: calculateAQI(currentData.pm25, currentData.pm10)
      };
    }
    return { co2: 600, pm25: 15, pm10: 30, voc: 1.2, aqi: 60 };
  };

  const latestData = getLatestData();

  const thresholds = settings?.thresholds || {
    co2: 1000, pm25: 35, pm10: 150, voc: 3,
  };

  const co2Alerts  = useAlerts(latestData.co2,  thresholds.co2,  'co2');
  const pm25Alerts = useAlerts(latestData.pm25, thresholds.pm25, 'pm25');
  const pm10Alerts = useAlerts(latestData.pm10, thresholds.pm10, 'pm10');
  const vocAlerts  = useAlerts(latestData.voc,  thresholds.voc,  'voc');
  const allAlerts  = [...co2Alerts, ...pm25Alerts, ...pm10Alerts, ...vocAlerts];

  const dailyStats = useDailyStats();

  const metrics = [
    { id: 'co2',  name: t('sensors.co2'),  color: '#8884d8', unit: 'ppm'   },
    { id: 'pm25', name: t('sensors.pm25'), color: '#82ca9d', unit: 'μg/m³' },
    { id: 'pm10', name: t('sensors.pm10'), color: '#ffc658', unit: 'μg/m³' },
    { id: 'voc',  name: t('sensors.voc'),  color: '#ff8042', unit: 'ppb'   }
  ];

  if (loading && !currentData && !historicalData.length) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

  if (error && !currentData && !historicalData.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] p-4 sm:p-6">
        <div className="card bg-base-100 shadow-xl w-full max-w-2xl">
          <div className="card-body text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 mx-auto text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-2xl font-bold mt-4">{t('errors.dataLoadFailed')}</h2>
            <p className="text-lg opacity-80 mt-2">{error}</p>
            <p className="text-base opacity-60 mt-4">{t('errors.tryAgainMessage')}</p>
            <div className="card-actions justify-center mt-6">
              <button onClick={() => window.location.reload()} className="btn btn-primary btn-lg">
                {t('actions.refresh')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-0 py-2 md:py-4 space-y-4 md:space-y-6">
      {error && (
        <div className="alert alert-warning shadow-lg mb-4">
          <div>
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Row 1: AQI + Air quality indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <AQIIndicator value={latestData.aqi} timestamp={currentData?.timestamp} />
        <CO2Indicator  value={latestData.co2}  timestamp={currentData?.timestamp} stats={dailyStats.co2} />
        <PM25Indicator value={latestData.pm25} timestamp={currentData?.timestamp} stats={dailyStats.pm25} />
        <PM10Indicator value={latestData.pm10} timestamp={currentData?.timestamp} stats={dailyStats.pm10} />
      </div>

      {/* Row 2: VOC + Alert */}
      <div className={`grid grid-cols-1 md:grid-cols-2 ${isAuthenticated ? 'lg:grid-cols-2' : 'lg:grid-cols-1'} gap-4`}>
        <VOCIndicator value={latestData.voc} timestamp={currentData?.timestamp} stats={dailyStats.voc} />
        {isAuthenticated && <AlertIndicator alerts={allAlerts} />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="card-title text-lg">{t('trend.title')}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {/* Date preset */}
                <div className="join">
                  {(['today', '7d', '14d', '30d'] as const).map(p => (
                    <button
                      key={p}
                      className={`join-item btn btn-xs ${
                        datePreset === p ? 'btn-primary' : 'btn-outline'
                      }`}
                      onClick={() => setDatePreset(p)}
                      disabled={histLoading}
                    >
                      {p === 'today'
                        ? t('trend.today', 'Bugün')
                        : p === '7d' ? t('analyticsPage.last7Days')
                        : p === '14d' ? t('analyticsPage.last14Days')
                        : t('analyticsPage.last30Days')}
                    </button>
                  ))}
                </div>
                {/* Time range inputs - only for today */}
                {datePreset === 'today' && (
                  <div className="flex items-center gap-1">
                    <input
                      type="time"
                      value={startTime}
                      onChange={e => setStartTime(e.target.value)}
                      className={`input input-bordered input-xs w-28 ${
                        timeRangeError ? 'input-error' : ''
                      }`}
                      disabled={histLoading}
                    />
                    <span className="text-base-content/60 text-xs">—</span>
                    <input
                      type="time"
                      value={endTime}
                      onChange={e => setEndTime(e.target.value)}
                      className={`input input-bordered input-xs w-28 ${
                        timeRangeError ? 'input-error' : ''
                      }`}
                      disabled={histLoading}
                    />
                  </div>
                )}
                {/* Bucket period */}
                <div className="join">
                  {TREND_PERIODS.map(p => (
                    <button
                      key={p}
                      className={`join-item btn btn-xs ${
                        trendPeriod === p ? 'btn-primary' : 'btn-outline'
                      }`}
                      onClick={() => setTrendPeriod(p)}
                      disabled={histLoading}
                    >
                      {t(`trend.periods.${p}`, p)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 flex-nowrap">
                  <button
                    className="btn btn-primary btn-xs"
                    onClick={handleApply}
                    disabled={histLoading || !isDirty}
                  >
                    {histLoading
                      ? <RefreshCw className="w-3 h-3 animate-spin" />
                      : t('trend.apply')}
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={fetchHistoricalData}
                    disabled={histLoading}
                    title="Yenile"
                  >
                    <RefreshCw className={`w-4 h-4 ${histLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </div>
            {timeRangeError && (
              <p className="text-error text-xs mt-1">{timeRangeError}</p>
            )}
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historicalData.length > 0 ? historicalData : []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="time" stroke="#6b7280" tick={{ fill: '#6b7280' }} />
                  <YAxis stroke="#6b7280" tick={{ fill: '#6b7280' }} />
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      typeof v === 'number' ? +v.toFixed(1) : v, name
                    ]}
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      border: '1px solid #e5e7eb',
                      borderRadius: '0.5rem',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Legend
                    onClick={(dataEntry) => toggleMetricVisibility(dataEntry.dataKey as string)}
                    wrapperStyle={{ cursor: 'pointer' }}
                    formatter={(value, entry) => {
                      const metricId = entry.dataKey as string;
                      const active = metricId && visibleMetrics[metricId];
                      return (
                        <span style={{
                          opacity: active ? 1 : 0.4,
                          margin: '0 8px',
                          fontWeight: active ? 'bold' : 'normal'
                        }}>
                          {value}
                        </span>
                      );
                    }}
                  />
                  {metrics.map(metric => (
                    <Line
                      key={metric.id}
                      type="monotone"
                      dataKey={metric.id}
                      stroke={metric.color}
                      name={`${metric.name} (${metric.unit})`}
                      strokeWidth={2}
                      dot={false}
                      hide={!visibleMetrics[metric.id]}
                    />
                  ))}
                  {hoveredInterval && (() => {
                    const x1 = findClosestTime(hoveredInterval.start);
                    const x2 = findClosestTime(hoveredInterval.end);
                    if (!x1 || !x2) return null;
                    return (
                      <ReferenceArea
                        x1={x1}
                        x2={x2}
                        fill="rgba(239,68,68,0.15)"
                        stroke="rgba(239,68,68,0.4)"
                        strokeOpacity={0.8}
                      />
                    );
                  })()}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-sm text-center text-gray-500">
              {t('trend.legendHelp')}
            </div>
          </div>
        </div>

        {isAuthenticated && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-lg">{t('threshold.exceededIntervals')}</h2>
              {exceededIntervals.filter(iv => visibleMetrics[iv.metric]).length === 0 ? (
                <p className="text-sm opacity-40">{t('threshold.noExceededIntervals')}</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {metrics.filter(m => visibleMetrics[m.id]).map(m => {
                    const intervals = exceededIntervals.filter(iv => iv.metric === m.id);
                    return (
                      <div key={m.id}>
                        <p className="text-xs font-bold uppercase mb-1" style={{ color: m.color }}>{m.name}</p>
                        {intervals.length === 0 ? (
                          <p className="text-xs opacity-40">{t('threshold.noExceededIntervals')}</p>
                        ) : (
                          <ul className="space-y-1 max-h-52 overflow-y-auto pr-1">
                            {intervals.map((iv, i) => (
                              <li
                                key={i}
                                onMouseEnter={() => setHoveredInterval(iv)}
                                onMouseLeave={() => setHoveredInterval(null)}
                                className={`text-xs px-2 py-1 rounded cursor-pointer select-none transition-colors ${
                                  hoveredInterval === iv
                                    ? 'bg-error/20 ring-1 ring-error/30'
                                    : 'hover:bg-base-300'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="opacity-70 truncate">{fmtTime(iv.start)} – {fmtTime(iv.end)}</span>
                                  <span className="font-mono text-error shrink-0">↑{iv.max_value}</span>
                                </div>
                                <span className="opacity-50">{iv.duration_minutes}{t('threshold.minSuffix')}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;

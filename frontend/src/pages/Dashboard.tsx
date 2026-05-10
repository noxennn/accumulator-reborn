import { useState, useEffect, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceArea } from 'recharts';
import { useTranslation } from 'react-i18next';
import { RefreshCw, AlarmClock, TrendingUp, Activity, FlaskConical, ShieldAlert } from 'lucide-react';

import AQIIndicator from '../components/AQIIndicator';
import CO2Indicator from '../components/CO2Indicator';
import PM25Indicator from '../components/PM25Indicator';
import PM10Indicator from '../components/PM10Indicator';
import VOCIndicator from '../components/VOCIndicator';
import AlertIndicator from '../components/AlertIndicator';
import InfoTooltip from '../components/InfoTooltip';
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

const CardTitleWithInfo = ({
  title,
  info,
  icon: Icon,
}: {
  title: string;
  info: string;
  icon: React.ComponentType<{ className?: string }>;
}) => (
  <div className="flex items-center gap-1.5">
    <Icon className="w-4 h-4 text-primary/80" />
    <h3 className="card-title text-base">{title}</h3>
    <InfoTooltip title={title} description={info} />
  </div>
);

const Dashboard = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [histLoading, setHistLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentData, setCurrentData] = useState<SensorData | null>(null);
  const [historicalData, setHistoricalData] = useState<SensorData[]>([]);
  const [dashboardAnalysis, setDashboardAnalysis] = useState<Awaited<ReturnType<typeof analyticsApi.getDashboardAnalysis>> | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);

  const [trendPeriod, setTrendPeriod] = useState('15m');
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime]     = useState(() => toHHMM(new Date()));
  const [timeRangeError, setTimeRangeError] = useState<string | null>(null);

  // Represents what's currently rendered in the chart (applied after clicking Uygula)
  const [applied, setApplied] = useState({
    startTime: '00:00',
    endTime: toHHMM(new Date()),
    trendPeriod: '15m',
  });

  const isDirty =
    startTime !== applied.startTime ||
    endTime   !== applied.endTime   ||
    trendPeriod !== applied.trendPeriod;

  const [exceededIntervals, setExceededIntervals] = useState<ExceededInterval[]>([]);
  const filteredExceededIntervals = useMemo(
    () => exceededIntervals.filter(iv => iv.duration_minutes >= 5),
    [exceededIntervals]
  );
  const [exceededLoading, setExceededLoading] = useState(true);
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
    const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sh, sm, 0);
    const endDate   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh, em, 59);
    const clampedEnd = endDate > today ? today : endDate;

    try {
      setHistLoading(true);
      const [rows, analysis] = await Promise.all([
        analyticsApi.getAggregatedData(
          startDate.toISOString(),
          clampedEnd.toISOString(),
          applied.trendPeriod
        ),
        analyticsApi.getDashboardAnalysis(
          startDate.toISOString(),
          clampedEnd.toISOString(),
          applied.trendPeriod
        ),
      ]);
      const formatted = rows.map((r: any) => ({
        ...r,
        time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
      setHistoricalData(formatted);
      setDashboardAnalysis(analysis);
    } catch (err) {
      console.error('Error fetching historical sensor data:', err);
      setError(t('errors.historicalDataFailed'));
    } finally {
      setHistLoading(false);
    }
  }, [applied, t]);

  const handleApply = () => {
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
    setExceededLoading(true);
    setApplied({ startTime, endTime, trendPeriod });
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
    const [sh, sm] = applied.startTime.split(':').map(Number);
    const [eh, em] = applied.endTime.split(':').map(Number);
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sh, sm, 0);
    const endDate   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh, em, 59);
    const clampedEnd = endDate > today ? today : endDate;
    setExceededLoading(true);
    sensorApi.getExceededIntervals(startDate.toISOString(), clampedEnd.toISOString())
      .then(setExceededIntervals)
      .catch(() => setExceededIntervals([]))
      .finally(() => setExceededLoading(false));
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

  const getLatestData = () => {
    if (currentData) {
      return {
        co2: currentData.co2,
        pm25: currentData.pm25,
        pm10: currentData.pm10,
        voc: currentData.voc,
        aqi: dashboardAnalysis?.aqi ?? 0
      };
    }
    return { co2: 600, pm25: 15, pm10: 30, voc: 1.2, aqi: dashboardAnalysis?.aqi ?? 60 };
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

  const advancedAnalysis = dashboardAnalysis?.advanced ?? null;

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

      {/* Row 1: AQI + pollutant indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <AQIIndicator value={latestData.aqi} timestamp={currentData?.timestamp} />
        <CO2Indicator  value={latestData.co2}  timestamp={currentData?.timestamp} stats={dailyStats.co2} />
        <VOCIndicator value={latestData.voc} timestamp={currentData?.timestamp} stats={dailyStats.voc} />
        <PM25Indicator value={latestData.pm25} timestamp={currentData?.timestamp} stats={dailyStats.pm25} />
        <PM10Indicator value={latestData.pm10} timestamp={currentData?.timestamp} stats={dailyStats.pm10} />
      </div>

      {isAuthenticated && advancedAnalysis && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body p-4">
                <CardTitleWithInfo
                  title={t('dashboardAnalysis.titles.exceedanceDuration')}
                  info={t('dashboardAnalysis.info.exceedanceDuration')}
                  icon={AlarmClock}
                />
                <div className="text-sm space-y-1 font-mono">
                  <p>{t('sensors.co2')}: {advancedAnalysis.duration_by_metric.co2} {t('dashboardAnalysis.units.minuteShort')}</p>
                  <p>{t('sensors.voc')}: {advancedAnalysis.duration_by_metric.voc} {t('dashboardAnalysis.units.minuteShort')}</p>
                  <p>{t('sensors.pm25')}: {advancedAnalysis.duration_by_metric.pm25} {t('dashboardAnalysis.units.minuteShort')}</p>
                  <p>{t('sensors.pm10')}: {advancedAnalysis.duration_by_metric.pm10} {t('dashboardAnalysis.units.minuteShort')}</p>
                </div>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body p-4">
                <CardTitleWithInfo
                  title={t('dashboardAnalysis.titles.peakRecovery')}
                  info={t('dashboardAnalysis.info.peakRecovery')}
                  icon={TrendingUp}
                />
                {advancedAnalysis.peak ? (
                  <div className="text-sm space-y-1">
                    <p>
                      {t('dashboardAnalysis.labels.peak')}: <span className="font-semibold">{advancedAnalysis.peak.metric.toUpperCase()}</span> ({advancedAnalysis.peak.value})
                    </p>
                    <p className="opacity-70">{fmtTime(advancedAnalysis.peak.timestamp)}</p>
                    <p>
                      {t('dashboardAnalysis.labels.recovery')}:{' '}
                      <span className="font-semibold">
                        {advancedAnalysis.recovery_minutes !== null
                          ? `${advancedAnalysis.recovery_minutes} ${t('dashboardAnalysis.units.minuteShort')}`
                          : t('dashboardAnalysis.labels.notRecovered')}
                      </span>
                    </p>
                  </div>
                ) : (
                  <p className="text-sm opacity-60">{t('dashboardAnalysis.labels.noPeakExceedance')}</p>
                )}
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body p-4">
                <CardTitleWithInfo
                  title={t('dashboardAnalysis.titles.ventilationEfficiency')}
                  info={t('dashboardAnalysis.info.ventilationEfficiency')}
                  icon={Activity}
                />
                <p className="text-sm opacity-70">{t('dashboardAnalysis.labels.co2Slope')}</p>
                <p className="text-2xl font-bold">{advancedAnalysis.co2_slope_per_minute} {t('dashboardAnalysis.units.ppmPerMinute')}</p>
                <p className="text-sm font-semibold">
                  {advancedAnalysis.ventilation_label_key === 'insufficientData'
                    ? t('dashboardAnalysis.labels.insufficientData')
                    : t(`dashboardAnalysis.ventilation.${advancedAnalysis.ventilation_label_key}`)}
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body p-4">
                <CardTitleWithInfo
                  title={t('dashboardAnalysis.titles.vocCo2Anomaly')}
                  info={t('dashboardAnalysis.info.vocCo2Anomaly')}
                  icon={FlaskConical}
                />
                <div className="text-sm space-y-1">
                  <p>{t('dashboardAnalysis.labels.co2NormalVocHigh')}: <span className="font-semibold">{advancedAnalysis.anomaly_chemical}</span></p>
                  <p>{t('dashboardAnalysis.labels.co2HighVocHigh')}: <span className="font-semibold">{advancedAnalysis.anomaly_crowded}</span></p>
                </div>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body p-4">
                <CardTitleWithInfo
                  title={t('dashboardAnalysis.titles.rollingRiskScore')}
                  info={t('dashboardAnalysis.info.rollingRiskScore')}
                  icon={ShieldAlert}
                />
                <div className="text-sm space-y-1">
                  <p>{t('dashboardAnalysis.labels.last15Min')}: <span className="font-semibold">{advancedAnalysis.risk15}</span></p>
                  <p>{t('dashboardAnalysis.labels.last30Min')}: <span className="font-semibold">{advancedAnalysis.risk30}</span></p>
                  <p className="opacity-70">{t('dashboardAnalysis.labels.weightedAverageRisk')}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <AlertIndicator alerts={allAlerts} />
          </div>
        </>
      )}

      <div className={`grid grid-cols-1 ${isAuthenticated ? 'lg:grid-cols-2' : 'lg:grid-cols-1'} gap-6`}>
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <div>
              <h2 className="card-title text-base sm:text-lg mb-2">{t('trend.title')}</h2>
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Time range inputs */}
                <div className="flex items-center gap-1">
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className={`input input-bordered input-xs w-[5.4rem] sm:w-24 ${
                      timeRangeError ? 'input-error' : ''
                    }`}
                    disabled={histLoading}
                  />
                  <span className="text-base-content/60 text-xs">—</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    className={`input input-bordered input-xs w-[5.4rem] sm:w-24 ${
                      timeRangeError ? 'input-error' : ''
                    }`}
                    disabled={histLoading}
                  />
                </div>
                {/* Bucket period */}
                <div className="join">
                  {TREND_PERIODS.map(p => (
                    <button
                      key={p}
                      className={`join-item btn btn-xs px-2 ${
                        trendPeriod === p ? 'btn-primary' : 'btn-outline'
                      }`}
                      onClick={() => setTrendPeriod(p)}
                      disabled={histLoading}
                    >
                      {t(`trend.periods.${p}`, p)}
                    </button>
                  ))}
                </div>
                <div className="join">
                  <button
                    className="join-item btn btn-primary btn-xs"
                    onClick={handleApply}
                    disabled={histLoading || !isDirty}
                  >
                    {histLoading
                      ? <RefreshCw className="w-3 h-3 animate-spin" />
                      : t('trend.apply')}
                  </button>
                  <button
                    className="join-item btn btn-ghost btn-xs"
                    onClick={fetchHistoricalData}
                    disabled={histLoading}
                    title={t('actions.refresh')}
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
              {exceededLoading ? (
                <div className="flex justify-center items-center py-6">
                  <span className="loading loading-spinner loading-md opacity-50"></span>
                </div>
              ) : filteredExceededIntervals.filter(iv => visibleMetrics[iv.metric]).length === 0 ? (
                <p className="text-sm opacity-40">{t('threshold.noExceededIntervals')}</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {metrics.filter(m => visibleMetrics[m.id]).map(m => {
                    const intervals = filteredExceededIntervals
                      .filter(iv => iv.metric === m.id)
                      .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
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

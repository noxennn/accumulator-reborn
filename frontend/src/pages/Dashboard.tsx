import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { format, subHours } from 'date-fns';
import AQIIndicator from '../components/AQIIndicator';
import CO2Indicator from '../components/CO2Indicator';
import PM25Indicator from '../components/PM25Indicator';
import PM10Indicator from '../components/PM10Indicator';
import VOCIndicator from '../components/VOCIndicator';
import AIPredictions from '../components/AIPredictions';
import AlertIndicator from '../components/AlertIndicator';
import { useAlerts } from '../hooks/useAlerts';
import { sensorApi } from '../lib/sensorApi';
import { settingsApi } from '../lib/settingsApi';
import { analyticsApi } from '../lib/analyticsApi';
import { SensorData, UserSettings } from '../types';
import { useAuth } from '../hooks/useAuth';

const TREND_PERIODS = [
  { value: '5m',  label: '5 dk'  },
  { value: '15m', label: '15 dk' },
  { value: '30m', label: '30 dk' },
  { value: '1h',  label: '1 sa'  },
  { value: '2h',  label: '2 sa'  },
];

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

  const [visibleMetrics, setVisibleMetrics] = useState({
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
    try {
      setHistLoading(true);
      const endDate = new Date();
      const startDate = subHours(endDate, 24);
      const rows = await analyticsApi.getAggregatedData(
        startDate.toISOString(),
        endDate.toISOString(),
        trendPeriod
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
  }, [trendPeriod, t]);

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

  const toggleMetricVisibility = (metric: string) => {
    setVisibleMetrics(prev => ({ ...prev, [metric]: !prev[metric] }));
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
      <div className="flex flex-col items-center justify-center min-h-[80vh] p-6">
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
    <div className="p-6 space-y-6">
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
        <CO2Indicator  value={latestData.co2}  timestamp={currentData?.timestamp} />
        <PM25Indicator value={latestData.pm25} timestamp={currentData?.timestamp} />
        <PM10Indicator value={latestData.pm10} timestamp={currentData?.timestamp} />
      </div>

      {/* Row 2: VOC + Alert */}
      <div className={`grid grid-cols-1 md:grid-cols-2 ${isAuthenticated ? 'lg:grid-cols-2' : 'lg:grid-cols-1'} gap-4`}>
        <VOCIndicator value={latestData.voc} timestamp={currentData?.timestamp} />
        {isAuthenticated && <AlertIndicator alerts={allAlerts} />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="card-title text-lg">{t('trend.title')}</h2>
              <div className="flex items-center gap-2">
                <div className="join">
                  {TREND_PERIODS.map(p => (
                    <button
                      key={p.value}
                      className={`join-item btn btn-xs ${trendPeriod === p.value ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setTrendPeriod(p.value)}
                      disabled={histLoading}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={fetchHistoricalData}
                  disabled={histLoading}
                  title="Yenile"
                >
                  <RefreshCw className={`w-4 h-4 ${histLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
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
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-sm text-center text-gray-500">
              {t('trend.legendHelp')}
            </div>
          </div>
        </div>

        <AIPredictions historicalData={historicalData} />
      </div>
    </div>
  );
};

export default Dashboard;

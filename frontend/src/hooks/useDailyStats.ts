import { useState, useEffect } from 'react';
import { analyticsApi, SensorStatistics } from '../lib/analyticsApi';

export interface DailyStats {
  co2:  SensorStatistics | null;
  pm25: SensorStatistics | null;
  pm10: SensorStatistics | null;
  voc:  SensorStatistics | null;
}

export function useDailyStats(): DailyStats {
  const [stats, setStats] = useState<DailyStats>({ co2: null, pm25: null, pm10: null, voc: null });

  useEffect(() => {
    const fetch = async () => {
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const start = startOfDay.toISOString();
      const end   = now.toISOString();

      const [co2, pm25, pm10, voc] = await Promise.allSettled([
        analyticsApi.getMetricStats('co2',  start, end),
        analyticsApi.getMetricStats('pm25', start, end),
        analyticsApi.getMetricStats('pm10', start, end),
        analyticsApi.getMetricStats('voc',  start, end),
      ]);

      setStats({
        co2:  co2.status  === 'fulfilled' ? co2.value  : null,
        pm25: pm25.status === 'fulfilled' ? pm25.value : null,
        pm10: pm10.status === 'fulfilled' ? pm10.value : null,
        voc:  voc.status  === 'fulfilled' ? voc.value  : null,
      });
    };

    fetch();
    // Refresh every 5 minutes
    const id = setInterval(fetch, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return stats;
}

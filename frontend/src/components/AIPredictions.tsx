import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Wind, Gauge, AlertCircle } from 'lucide-react';
import { format, subHours } from 'date-fns';
import { sensorApi } from '../lib/sensorApi';

interface PredictionData {
  time: string;
  co2: number;
  pm25: number;
  pm10: number;
  voc: number;
}

const calculateHourlyAverages = (data) => {
  const groupedByHour = {};

  data.forEach(item => {
    const timeString = format(new Date(item.timestamp), 'HH:00');
    if (!groupedByHour[timeString]) {
      groupedByHour[timeString] = {
        co2: [], pm25: [], pm10: [], voc: [],
        count: 0,
        timestamp: new Date(item.timestamp).getTime()
      };
    }
    groupedByHour[timeString].co2.push(item.co2);
    groupedByHour[timeString].pm25.push(item.pm25);
    groupedByHour[timeString].pm10.push(item.pm10);
    groupedByHour[timeString].voc.push(item.voc);
    groupedByHour[timeString].count += 1;
  });

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return Object.keys(groupedByHour)
    .map(timeStr => {
      const h = groupedByHour[timeStr];
      return {
        time: timeStr,
        co2:  avg(h.co2),
        pm25: avg(h.pm25),
        pm10: avg(h.pm10),
        voc:  avg(h.voc),
        timestamp: h.timestamp
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
};

const makeMockData = (): PredictionData[] =>
  Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setHours(date.getHours() - (6 - i));
    return {
      time: format(date, 'HH:00'),
      co2:  Math.random() * 500 + 400,
      pm25: Math.random() * 30 + 10,
      pm10: Math.random() * 50 + 20,
      voc:  Math.random() * 2 + 0.5
    };
  });

const AIPredictions = ({ historicalData = [] }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [hourlyData, setHourlyData] = useState<PredictionData[]>([]);

  const [visibleMetrics, setVisibleMetrics] = useState({
    co2: true, pm25: true, pm10: false, voc: false
  });

  const toggleMetric = (metric: string) =>
    setVisibleMetrics(prev => ({ ...prev, [metric]: !prev[metric] }));

  useEffect(() => {
    const fetchHourlyData = async () => {
      try {
        setLoading(true);

        if (historicalData.length > 0) {
          const averages = calculateHourlyAverages(historicalData);
          if (averages.length > 0) {
            setHourlyData(averages.slice(-7));
            setLoading(false);
            return;
          }
        }

        const endDate = new Date();
        const startDate = subHours(endDate, 7);
        const formattedStart = startDate.toISOString();
        const formattedEnd   = endDate.toISOString();

        const data = await sensorApi.getHistoricalData(formattedStart, formattedEnd);

        if (data.length === 0) {
          setHourlyData(makeMockData());
        } else {
          setHourlyData(calculateHourlyAverages(data).slice(-7));
        }
      } catch {
        setHourlyData(makeMockData());
      } finally {
        setLoading(false);
      }
    };

    fetchHourlyData();
  }, [historicalData]);

  const metrics = [
    { id: 'co2',  name: t('sensors.co2'),  icon: <Wind       className="w-4 h-4 text-primary"   />, unit: 'ppm',   fmt: (v: number) => Math.round(v)    },
    { id: 'pm25', name: t('sensors.pm25'), icon: <AlertCircle className="w-4 h-4 text-success"  />, unit: 'μg/m³', fmt: (v: number) => v.toFixed(1)     },
    { id: 'pm10', name: t('sensors.pm10'), icon: <AlertCircle className="w-4 h-4 text-warning"  />, unit: 'μg/m³', fmt: (v: number) => v.toFixed(1)     },
    { id: 'voc',  name: t('sensors.voc'),  icon: <Gauge       className="w-4 h-4 text-secondary"/>, unit: 'ppb',   fmt: (v: number) => v.toFixed(2)     }
  ];

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="card-title text-lg">
            {t('predictions.title')} ({t('predictions.last7Hours')})
          </h2>
        </div>

        <div className="flex flex-wrap gap-2 mt-2 mb-4">
          {metrics.map(metric => (
            <div key={metric.id} className="form-control">
              <label className="cursor-pointer label gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-primary"
                  checked={visibleMetrics[metric.id]}
                  onChange={() => toggleMetric(metric.id)}
                />
                <span className="label-text">{metric.name}</span>
              </label>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-8">
            <div className="loading loading-spinner loading-md"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th>{t('predictions.time')}</th>
                  {metrics.filter(m => visibleMetrics[m.id]).map(m => (
                    <th key={m.id}>{m.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hourlyData.map((row, i) => (
                  <tr key={i}>
                    <td>{row.time}</td>
                    {metrics.filter(m => visibleMetrics[m.id]).map(m => (
                      <td key={m.id}>
                        <div className="flex items-center gap-2">
                          {m.icon}
                          {m.fmt(row[m.id])}{m.unit}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIPredictions;

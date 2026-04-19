import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LineChart,
  Line,
  // BarChart,
  // Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  ComposedChart,
  Scatter
} from 'recharts';
import { format, subDays, eachDayOfInterval, parseISO } from 'date-fns';
import { tr, enUS } from 'date-fns/locale';
import { /* Download, */ FileText, FileDown, RefreshCw } from 'lucide-react';
// html2canvas'ı html2canvas-pro ile değiştiriyoruz
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { analyticsApi } from '../lib/analyticsApi';

const generateMockData = (days: number) => {
  const end = new Date();
  const start = subDays(end, days - 1);
  return eachDayOfInterval({ start, end }).map(date => ({
    date: format(date, 'yyyy-MM-dd'),
    co2: Math.random() * 500 + 400,
    pm25: Math.random() * 30 + 10,
    pm10: Math.random() * 50 + 20,
    voc: Math.random() * 2 + 0.5,
  }));
};

const Analytics = () => {
  const { t, i18n } = useTranslation();
  const [dateRange, setDateRange] = useState('7');
  const [data, setData] = useState(() => generateMockData(7));
  const [selectedMetrics, setSelectedMetrics] = useState(['co2', 'pm25']);
  const [chartType, setChartType] = useState<'line' | 'area' | 'composed'>('line');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartRef = React.useRef<HTMLDivElement>(null);

  const dateLocale = i18n.language === 'tr' ? tr : enUS;

  // Fetch historical data from API
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Calculate start and end dates
        const end = new Date();
        const start = subDays(end, Number(dateRange) - 1);
        
        // Format dates in ISO format for the API with Turkish time (UTC+3)
        const turkishOffset = 3 * 60 * 60 * 1000; // UTC+3 için 3 saat
        const turkishStartDate = new Date(start.getTime() + turkishOffset);
        const turkishEndDate = new Date(end.getTime() + turkishOffset);
        
        const formattedStart = turkishStartDate.toISOString().split('T')[0] + 'T00:00:00';
        const formattedEnd = turkishEndDate.toISOString().split('T')[0] + 'T23:59:59';
        
        // Fetch historical data from API
        const apiData = await analyticsApi.getAnalyticsData(formattedStart, formattedEnd);
        
        // Format and process the data
        const formattedData = apiData.map(item => ({
          date: format(new Date(item.timestamp), 'yyyy-MM-dd'),
          co2: item.co2,
          pm25: item.pm25,
          pm10: item.pm10,
          voc: item.voc,
          originalTimestamp: new Date(item.timestamp).getTime()
        }));
        
        // Group by date (in case we have multiple readings per day)
        const groupedData = {};
        formattedData.forEach(item => {
          if (!groupedData[item.date]) {
            groupedData[item.date] = {
              date: item.date,
              co2: 0, pm25: 0, pm10: 0, voc: 0,
              count: 0,
              dateObj: new Date(item.date)
            };
          }
          groupedData[item.date].co2  += item.co2;
          groupedData[item.date].pm25 += item.pm25;
          groupedData[item.date].pm10 += item.pm10;
          groupedData[item.date].voc  += item.voc;
          groupedData[item.date].count += 1;
        });
        
        let averagedData = Object.values(groupedData).map(item => ({
          date: item.date,
          co2:  item.co2  / item.count,
          pm25: item.pm25 / item.count,
          pm10: item.pm10 / item.count,
          voc:  item.voc  / item.count,
          dateObj: item.dateObj
        }));
        
        // Sort data by date chronologically
        averagedData.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
        
        // Remove the dateObj property as it's no longer needed
        averagedData = averagedData.map(({ dateObj, ...rest }) => rest);
        
        // If we have data, use it, otherwise do not use mock data
        if (averagedData.length > 0) {
          setData(averagedData);
        } else {
          console.log("No data returned from API");
          setData([]);
          setError(t('errors.noDataAvailable'));
        }
        
      } catch (err) {
        console.error("Error fetching analytics data:", err);
        setError(t('errors.dataLoadFailed'));
        setData([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [dateRange, t]);

  // Fetch statistics from API for selected metrics
  const fetchStats = async (metricId: string) => {
    try {
      const end = new Date();
      const start = subDays(end, Number(dateRange) - 1);
      
      // Format dates in ISO format for the API with Turkish time (UTC+3)
      const turkishOffset = 3 * 60 * 60 * 1000; // UTC+3 için 3 saat
      const turkishStartDate = new Date(start.getTime() + turkishOffset);
      const turkishEndDate = new Date(end.getTime() + turkishOffset);
      
      const formattedStart = turkishStartDate.toISOString().split('T')[0] + 'T00:00:00';
      const formattedEnd = turkishEndDate.toISOString().split('T')[0] + 'T23:59:59';
      
      const statsData = await analyticsApi.getMetricStats(metricId, formattedStart, formattedEnd);
      
      return analyticsApi.formatStats(statsData);
    } catch (err) {
      console.error(`Error fetching stats for ${metricId}:`, err);
      // Fall back to calculated stats from the current data set
      return calculateStats(metricId);
    }
  };

  const metrics = [
    { id: 'co2',  name: t('sensors.co2'),  color: '#8884d8', unit: t('units.co2') },
    { id: 'pm25', name: t('sensors.pm25'), color: '#82ca9d', unit: t('units.pm')  },
    { id: 'pm10', name: t('sensors.pm10'), color: '#ffc658', unit: t('units.pm')  },
    { id: 'voc',  name: t('sensors.voc'),  color: '#ff8042', unit: t('units.voc') }
  ];

  const calculateStats = (metricId: string) => {
    const values = data.map(d => d[metricId]);
    return {
      min: Math.min(...values).toFixed(1),
      max: Math.max(...values).toFixed(1),
      avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1),
      std: Math.sqrt(
        values.reduce((a, b) => a + Math.pow(b - Number((values.reduce((c, d) => c + d, 0) / values.length).toFixed(1)), 2), 0) / values.length
      ).toFixed(1)
    };
  };

  const [metricStats, setMetricStats] = useState<Record<string, any>>({});

  // Fetch stats for selected metrics when they change
  useEffect(() => {
    const getStatsForMetrics = async () => {
      const stats = {};
      
      for (const metricId of selectedMetrics) {
        stats[metricId] = await fetchStats(metricId);
      }
      
      setMetricStats(stats);
    };
    
    if (!loading && selectedMetrics.length > 0) {
      getStatsForMetrics();
    }
  }, [selectedMetrics, data, loading]);

  const downloadReport = () => {
    const reportData = selectedMetrics.map(metricId => {
      const metric = metrics.find(m => m.id === metricId)!;
      const stats = metricStats[metricId] || calculateStats(metricId);
      return `${metric.name} (${metric.unit})\n` +
        `Minimum: ${stats.min}\n` +
        `Maximum: ${stats.max}\n` +
        `Average: ${stats.avg}\n` +
        `Standard Deviation: ${stats.std}\n\n`;
    }).join('');

    const blob = new Blob([reportData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `air-quality-report-${format(new Date(), 'yyyy-MM-dd')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadPDF = async () => {
    if (!chartRef.current) return;

    try {
      // Grafik alanını kopyalayıp arkaplan rengini açıkça belirterek oklch sorununu önleme
      const chartClone = chartRef.current.cloneNode(true) as HTMLElement;
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.top = '-9999px';
      container.style.left = '-9999px';
      container.style.width = chartRef.current.clientWidth + 'px';
      container.style.height = chartRef.current.clientHeight + 'px';
      container.style.backgroundColor = '#ffffff'; // Açık arkaplan rengi
      container.appendChild(chartClone);
      document.body.appendChild(container);

      // Modern renk formatlarını desteklemeyen html2canvas ayarları
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        // Renk fonksiyonları için özel ayarlar
        onclone: (_document, element) => {
          // Tüm elementlere geleneksel renk değerleri atama
          const elements = element.querySelectorAll('*');
          elements.forEach(el => {
            if (el instanceof HTMLElement) {
              // Tema renklerini saf renklerle değiştirme
              el.style.backgroundColor = window.getComputedStyle(el).backgroundColor;
              el.style.color = window.getComputedStyle(el).color;
              el.style.borderColor = window.getComputedStyle(el).borderColor;
            }
          });
        }
      });

      // Temizlik
      document.body.removeChild(container);

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);

      // İstatistikleri ekle
      pdf.setFontSize(12);
      let yPos = imgHeight + 10;
      selectedMetrics.forEach(metricId => {
        const metric = metrics.find(m => m.id === metricId)!;
        const stats = metricStats[metricId] || calculateStats(metricId);
        pdf.text(`${metric.name} (${metric.unit})`, 10, yPos);
        yPos += 7;
        pdf.text(`Minimum: ${stats.min}`, 15, yPos);
        yPos += 7;
        pdf.text(`Maximum: ${stats.max}`, 15, yPos);
        yPos += 7;
        pdf.text(`Average: ${stats.avg}`, 15, yPos);
        yPos += 7;
        pdf.text(`Standard Deviation: ${stats.std}`, 15, yPos);
        yPos += 10;
      });

      pdf.save(`air-quality-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    } catch (error) {
      console.error("PDF oluşturma hatası:", error);
      alert(t('errors.pdfGenerationFailed'));
    }
  };

  const renderChart = () => {
    const ChartComponent = {
      line: LineChart,
      area: AreaChart,
      composed: ComposedChart
    }[chartType];

    return (
      <ResponsiveContainer width="100%" height="100%">
        <ChartComponent data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis 
            dataKey="date" 
            tickFormatter={(date) => format(parseISO(date), 'MMM d', { locale: dateLocale })}
            stroke="#6b7280"
            tick={{ fill: '#6b7280' }}
          />
          <YAxis 
            stroke="#6b7280"
            tick={{ fill: '#6b7280' }}
          />
          <Tooltip 
            labelFormatter={(date) => format(parseISO(date as string), 'PPP', { locale: dateLocale })}
            contentStyle={{
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }}
          />
          <Legend 
            wrapperStyle={{
              paddingTop: '20px',
              color: '#6b7280'
            }}
          />
          {selectedMetrics.map(metricId => {
            const metric = metrics.find(m => m.id === metricId)!;
            if (chartType === 'line') {
              return (
                <Line
                  key={metric.id}
                  type="monotone"
                  dataKey={metric.id}
                  stroke={metric.color}
                  name={`${metric.name} (${metric.unit})`}
                  dot={false}
                  strokeWidth={2}
                />
              );
            } else if (chartType === 'area') {
              return (
                <Area
                  key={metric.id}
                  type="monotone"
                  dataKey={metric.id}
                  fill={metric.color}
                  stroke={metric.color}
                  name={`${metric.name} (${metric.unit})`}
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
              );
            } else {
              return (
                <React.Fragment key={metric.id}>
                  <Line
                    type="monotone"
                    dataKey={metric.id}
                    stroke={metric.color}
                    name={`${metric.name} (${metric.unit})`}
                    dot={false}
                    strokeWidth={2}
                  />
                  <Scatter
                    dataKey={metric.id}
                    fill={metric.color}
                    name={`${metric.name} Points`}
                    shape="circle"
                    r={4}
                  />
                </React.Fragment>
              );
            }
          })}
        </ChartComponent>
      </ResponsiveContainer>
    );
  };

  // Show loading spinner while loading data
  if (loading && !data.length) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

  // Show full-page error display when there's a critical error and no data
  if (error && !data.length) {
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
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
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
      
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-4 items-center">
          <select 
            className="select select-bordered w-full max-w-xs"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            disabled={loading}
          >
            <option value="7">{t('analyticsPage.last7Days')}</option>
            <option value="14">{t('analyticsPage.last14Days')}</option>
            <option value="30">{t('analyticsPage.last30Days')}</option>
          </select>

          <select
            className="select select-bordered w-full max-w-xs"
            value={chartType}
            onChange={(e) => setChartType(e.target.value as 'line' | 'area' | 'composed')}
            disabled={loading}
          >
            <option value="line">{t('analyticsPage.lineChart')}</option>
            <option value="area">{t('analyticsPage.areaChart')}</option>
            <option value="composed">{t('analyticsPage.composedChart')}</option>
          </select>
        </div>

        <div className="flex gap-2">
          <button
            className="btn btn-outline btn-primary"
            onClick={downloadReport}
            disabled={loading}
          >
            <FileText className="w-4 h-4 mr-2" />
            TXT
          </button>
          <button
            className="btn btn-outline btn-primary"
            onClick={downloadPDF}
            disabled={loading}
          >
            <FileDown className="w-4 h-4 mr-2" />
            PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 bg-base-200 p-4 rounded-lg">
        {metrics.map(metric => (
          <label key={metric.id} className="cursor-pointer label gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-primary"
              checked={selectedMetrics.includes(metric.id)}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedMetrics([...selectedMetrics, metric.id]);
                } else {
                  setSelectedMetrics(selectedMetrics.filter(m => m !== metric.id));
                }
              }}
              disabled={loading}
            />
            <span className="label-text">{metric.name}</span>
          </label>
        ))}
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title flex justify-between">
            <span>{t('analyticsPage.trendAnalysis')}</span>
            {loading && <RefreshCw className="w-5 h-5 animate-spin" />}
          </h2>
          <div ref={chartRef} className="h-[400px]">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="loading loading-spinner loading-lg"></div>
              </div>
            ) : (
              renderChart()
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {selectedMetrics.map(metricId => {
          const metric = metrics.find(m => m.id === metricId)!;
          const stats = metricStats[metricId] || calculateStats(metricId);
          return (
            <div key={metricId} className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h3 className="card-title text-lg">
                  {metric.name}
                  <span className="text-sm font-normal opacity-70">({metric.unit})</span>
                </h3>
                {loading ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="loading loading-spinner"></div>
                  </div>
                ) : (
                  <div className="stats stats-vertical shadow">
                    <div className="stat">
                      <div className="stat-title">{t('analyticsPage.minimum')}</div>
                      <div className="stat-value text-lg">{stats.min}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-title">{t('analyticsPage.maximum')}</div>
                      <div className="stat-value text-lg">{stats.max}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-title">{t('analyticsPage.average')}</div>
                      <div className="stat-value text-lg">{stats.avg}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-title">{t('analyticsPage.standardDeviation')}</div>
                      <div className="stat-value text-lg">{stats.std}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Analytics;
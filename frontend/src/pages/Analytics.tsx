import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, AreaChart, Area, ComposedChart, Scatter
} from 'recharts';
import { format, subDays } from 'date-fns';
import { tr, enUS, type Locale } from 'date-fns/locale';
import { FileText, FileDown, RefreshCw } from 'lucide-react';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { analyticsApi } from '../lib/analyticsApi';

// ── Sabitler ────────────────────────────────────────────────────────

const PERIODS = [
  { value: '5m'  },
  { value: '15m' },
  { value: '30m' },
  { value: '1h'  },
  { value: '2h'  },
  { value: '4h'  },
  { value: '8h'  },
  { value: '12h' },
  { value: '1d'  },
];

const PERIOD_MINUTES: Record<string, number> = {
  '5m': 5, '15m': 15, '30m': 30, '1h': 60,
  '2h': 120, '4h': 240, '8h': 480, '12h': 720, '1d': 1440,
};

const toISO = (d: Date) => d.toISOString().slice(0, 19);

// ── Yardımcı: x-ekseni etiketi ──────────────────────────────────────
const xLabel = (ts: string, period: string, locale: Locale): string => {
  try {
    const d = new Date(ts);
    if (PERIOD_MINUTES[period] >= 1440) return format(d, 'dd MMM', { locale });
    if (PERIOD_MINUTES[period] >= 120)  return format(d, 'dd MMM HH:mm', { locale });
    return format(d, 'HH:mm');
  } catch { return ts; }
};

// ── Tooltip formatter: 2 ondalık basamak ────────────────────────────
const tooltipFormatter = (value: number, name: string) => [
  typeof value === 'number' ? +value.toFixed(2) : value,
  name,
];

// ── Bileşen ─────────────────────────────────────────────────────────

const Analytics = () => {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'tr' ? tr : enUS;
  const chartRef = useRef<HTMLDivElement>(null);

  // Tarih seçimi
  const [datePreset, setDatePreset] = useState<'7d' | '14d' | '30d' | 'custom'>('7d');
  const today = format(new Date(), 'yyyy-MM-dd');
  const [customStart, setCustomStart] = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [customEnd,   setCustomEnd]   = useState(today);

  // Periyot ve grafik tipi
  const [period, setPeriod] = useState('1h');
  const [chartType, setChartType] = useState<'line' | 'area' | 'composed'>('line');
  const [selectedMetrics, setSelectedMetrics] = useState(['co2', 'pm25']);

  // Veri
  const [data, setData] = useState<any[]>([]);
  const [metricStats, setMetricStats] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const metrics = [
    { id: 'co2',  name: t('sensors.co2'),  color: '#8884d8', unit: t('units.co2') },
    { id: 'pm25', name: t('sensors.pm25'), color: '#82ca9d', unit: t('units.pm')  },
    { id: 'pm10', name: t('sensors.pm10'), color: '#ffc658', unit: t('units.pm')  },
    { id: 'voc',  name: t('sensors.voc'),  color: '#ff8042', unit: t('units.voc') },
  ];

  // ── Tarih aralığını hesapla ───────────────────────────────────────
  const getDateRange = useCallback(() => {
    const end = new Date();
    end.setHours(23, 59, 59);
    let start: Date;
    if (datePreset === 'custom') {
      return {
        start: customStart + 'T00:00:00',
        end:   customEnd   + 'T23:59:59',
      };
    }
    const days = datePreset === '7d' ? 7 : datePreset === '14d' ? 14 : 30;
    start = subDays(end, days - 1);
    start.setHours(0, 0, 0);
    return { start: toISO(start), end: toISO(end) };
  }, [datePreset, customStart, customEnd]);

  // ── Veri çek ─────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getDateRange();
      const rows = await analyticsApi.getAggregatedData(start, end, period);
      if (rows.length === 0) {
        setData([]);
        setError(t('errors.noDataAvailable'));
      } else {
        setData(rows);
      }
    } catch (err) {
      console.error(err);
      setError(t('errors.dataLoadFailed'));
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [getDateRange, period, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── İstatistik çek ───────────────────────────────────────────────
  useEffect(() => {
    if (loading || !data.length || !selectedMetrics.length) return;
    const { start, end } = getDateRange();
    const load = async () => {
      const stats: Record<string, any> = {};
      for (const id of selectedMetrics) {
        try {
          const s = await analyticsApi.getMetricStats(id, start, end);
          stats[id] = analyticsApi.formatStats(s);
        } catch {
          const vals = data.map(d => d[id]).filter(Boolean);
          if (!vals.length) { stats[id] = { min: '-', max: '-', avg: '-', std: '-' }; continue; }
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          stats[id] = {
            min: Math.min(...vals).toFixed(1),
            max: Math.max(...vals).toFixed(1),
            avg: avg.toFixed(1),
            std: Math.sqrt(vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length).toFixed(1),
          };
        }
      }
      setMetricStats(stats);
    };
    load();
  }, [selectedMetrics, data, loading]);

  // ── Rapor indir ──────────────────────────────────────────────────
  const downloadReport = () => {
    const content = selectedMetrics.map(id => {
      const m = metrics.find(x => x.id === id)!;
      const s = metricStats[id] || {};
      return `${m.name} (${m.unit})\nMin: ${s.min ?? '-'}  Max: ${s.max ?? '-'}  Ort: ${s.avg ?? '-'}  StdSap: ${s.std ?? '-'}\n`;
    }).join('\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([content], { type: 'text/plain' })),
      download: `air-quality-${format(new Date(), 'yyyy-MM-dd')}.txt`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadPDF = async () => {
    if (!chartRef.current) return;
    try {
      const container = document.createElement('div');
      Object.assign(container.style, {
        position: 'absolute', top: '-9999px', left: '-9999px',
        width: chartRef.current.clientWidth + 'px',
        height: chartRef.current.clientHeight + 'px',
        backgroundColor: '#ffffff',
      });
      container.appendChild(chartRef.current.cloneNode(true));
      document.body.appendChild(container);
      const canvas = await html2canvas(container, {
        scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false,
        onclone: (_doc, el) => {
          el.querySelectorAll('*').forEach(e => {
            if (e instanceof HTMLElement) {
              const cs = window.getComputedStyle(e);
              e.style.backgroundColor = cs.backgroundColor;
              e.style.color = cs.color;
            }
          });
        },
      });
      document.body.removeChild(container);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const w = 210, h = (canvas.height * w) / canvas.width;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
      let y = h + 10;
      pdf.setFontSize(11);
      selectedMetrics.forEach(id => {
        const m = metrics.find(x => x.id === id)!;
        const s = metricStats[id] || {};
        pdf.text(`${m.name} (${m.unit})`, 10, y); y += 7;
        pdf.text(`Min: ${s.min ?? '-'}  Max: ${s.max ?? '-'}  Ort: ${s.avg ?? '-'}  StdSap: ${s.std ?? '-'}`, 15, y); y += 10;
      });
      pdf.save(`air-quality-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    } catch (e) {
      console.error(e);
      alert(t('errors.pdfGenerationFailed'));
    }
  };

  // ── Grafik render ────────────────────────────────────────────────
  const renderChart = () => {
    const ChartComp = { line: LineChart, area: AreaChart, composed: ComposedChart }[chartType];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ChartComp data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={ts => xLabel(ts, period, dateLocale)}
            stroke="#6b7280"
            tick={{ fill: '#6b7280' }}
            minTickGap={40}
          />
          <YAxis stroke="#6b7280" tick={{ fill: '#6b7280' }} />
          <Tooltip
            formatter={tooltipFormatter}
            labelFormatter={ts => xLabel(ts as string, period, dateLocale)}
            contentStyle={{
              backgroundColor: 'rgba(255,255,255,0.95)',
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
            }}
          />
          <Legend wrapperStyle={{ paddingTop: 20, color: '#6b7280' }} />
          {selectedMetrics.map(id => {
            const m = metrics.find(x => x.id === id)!;
            if (chartType === 'area') return (
              <Area key={id} type="monotone" dataKey={id} stroke={m.color} fill={m.color}
                name={`${m.name} (${m.unit})`} fillOpacity={0.3} strokeWidth={2} dot={false} />
            );
            if (chartType === 'composed') return (
              <React.Fragment key={id}>
                <Line type="monotone" dataKey={id} stroke={m.color} name={`${m.name} (${m.unit})`} strokeWidth={2} dot={false} />
                <Scatter dataKey={id} fill={m.color} r={3} />
              </React.Fragment>
            );
            return (
              <Line key={id} type="monotone" dataKey={id} stroke={m.color}
                name={`${m.name} (${m.unit})`} strokeWidth={2} dot={false} />
            );
          })}
        </ChartComp>
      </ResponsiveContainer>
    );
  };

  // ── Yüklenme / hata ekranları ────────────────────────────────────
  if (loading && !data.length) return (
    <div className="flex items-center justify-center h-screen">
      <div className="loading loading-spinner loading-lg" />
    </div>
  );

  if (error && !data.length) return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-4 sm:p-6">
      <div className="card bg-base-100 shadow-xl w-full max-w-2xl">
        <div className="card-body text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 mx-auto text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-2xl font-bold mt-4">{t('errors.dataLoadFailed')}</h2>
          <p className="text-lg opacity-80 mt-2">{error}</p>
          <div className="card-actions justify-center mt-6">
            <button onClick={fetchData} className="btn btn-primary">{t('actions.refresh')}</button>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Ana render ───────────────────────────────────────────────────
  return (
    <div className="px-0 py-2 md:py-4 space-y-4 md:space-y-6">
      {error && (
        <div className="alert alert-warning shadow-lg">
          <div>
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* ── Kontroller ── */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body py-4 space-y-4">

          {/* Satır 1: Preset + Periyot + Grafik tipi + Butonlar */}
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="flex flex-wrap gap-3 items-center">

              {/* Tarih preset */}
              <div className="join">
                {(['7d','14d','30d'] as const).map(p => (
                  <button
                    key={p}
                    className={`join-item btn btn-sm ${datePreset === p ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setDatePreset(p)}
                    disabled={loading}
                  >
                    {p === '7d' ? t('analyticsPage.last7Days') : p === '14d' ? t('analyticsPage.last14Days') : t('analyticsPage.last30Days')}
                  </button>
                ))}
                <button
                  className={`join-item btn btn-sm ${datePreset === 'custom' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setDatePreset('custom')}
                  disabled={loading}
                >
                  {t('analyticsPage.custom')}
                </button>
              </div>

              {/* Periyot */}
              <select
                className="select select-bordered select-sm"
                value={period}
                onChange={e => setPeriod(e.target.value)}
                disabled={loading}
              >
                {PERIODS.map(p => (
                  <option key={p.value} value={p.value}>{t(`trend.periods.${p.value}`, p.value)}</option>
                ))}
              </select>

              {/* Grafik tipi */}
              <select
                className="select select-bordered select-sm"
                value={chartType}
                onChange={e => setChartType(e.target.value as any)}
                disabled={loading}
              >
                <option value="line">{t('analyticsPage.lineChart')}</option>
                <option value="area">{t('analyticsPage.areaChart')}</option>
                <option value="composed">{t('analyticsPage.composedChart')}</option>
              </select>
            </div>

            {/* İndir + Yenile */}
            <div className="flex gap-2">
              <button className="btn btn-outline btn-primary btn-sm" onClick={downloadReport} disabled={loading}>
                <FileText className="w-4 h-4 mr-1" /> TXT
              </button>
              <button className="btn btn-outline btn-primary btn-sm" onClick={downloadPDF} disabled={loading}>
                <FileDown className="w-4 h-4 mr-1" /> PDF
              </button>
              <button className="btn btn-ghost btn-sm" onClick={fetchData} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Satır 2: Özel tarih aralığı (sadece custom seçiliyse) */}
          {datePreset === 'custom' && (
            <div className="flex flex-wrap gap-3 items-center">
              <label className="text-sm opacity-70">{t('analyticsPage.customStart')}</label>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={customStart}
                max={customEnd}
                onChange={e => setCustomStart(e.target.value)}
              />
              <label className="text-sm opacity-70">{t('analyticsPage.customEnd')}</label>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={customEnd}
                min={customStart}
                max={today}
                onChange={e => setCustomEnd(e.target.value)}
              />
              <button className="btn btn-primary btn-sm" onClick={fetchData} disabled={loading}>
                {t('analyticsPage.apply')}
              </button>
            </div>
          )}

          {/* Satır 3: Metrik seçimi */}
          <div className="flex flex-wrap gap-4">
            {metrics.map(m => (
              <label key={m.id} className="cursor-pointer flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary checkbox-sm"
                  checked={selectedMetrics.includes(m.id)}
                  onChange={e => setSelectedMetrics(prev =>
                    e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id)
                  )}
                  disabled={loading}
                />
                <span className="label-text">{m.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── Grafik ── */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title flex justify-between">
            <span>{t('analyticsPage.trendAnalysis')}</span>
            {loading && <RefreshCw className="w-5 h-5 animate-spin" />}
          </h2>
          <div ref={chartRef} className="h-[400px]">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="loading loading-spinner loading-lg" />
              </div>
            ) : data.length > 0 ? renderChart() : (
              <div className="flex items-center justify-center h-full opacity-50">
                {t('errors.noDataAvailable')}
              </div>
            )}
          </div>
          {data.length > 0 && (
            <p className="text-xs opacity-50 text-right">
              {data.length} veri noktası · her nokta seçilen periyodun ortalaması
            </p>
          )}
        </div>
      </div>

      {/* ── İstatistik kartları ── */}
      {selectedMetrics.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {selectedMetrics.map(id => {
            const m = metrics.find(x => x.id === id)!;
            const s = metricStats[id];
            return (
              <div key={id} className="card bg-base-100 shadow-xl">
                <div className="card-body">
                  <h3 className="card-title text-base">
                    {m.name}
                    <span className="text-sm font-normal opacity-60">({m.unit})</span>
                  </h3>
                  {loading ? (
                    <div className="flex justify-center py-4"><div className="loading loading-spinner" /></div>
                  ) : (
                    <div className="stats stats-vertical shadow">
                      <div className="stat py-2"><div className="stat-title text-xs">{t('analyticsPage.minimum')}</div><div className="stat-value text-lg">{s?.min ?? '-'}</div></div>
                      <div className="stat py-2"><div className="stat-title text-xs">{t('analyticsPage.maximum')}</div><div className="stat-value text-lg">{s?.max ?? '-'}</div></div>
                      <div className="stat py-2"><div className="stat-title text-xs">{t('analyticsPage.average')}</div><div className="stat-value text-lg">{s?.avg ?? '-'}</div></div>
                      <div className="stat py-2"><div className="stat-title text-xs">{t('analyticsPage.standardDeviation')}</div><div className="stat-value text-lg">{s?.std ?? '-'}</div></div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Analytics;

import React from 'react';
import { SensorStatistics } from '../lib/analyticsApi';

interface StatsRowProps {
  stats: SensorStatistics;
  unit: string;
  precision?: number;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

const StatsRow: React.FC<StatsRowProps> = ({ stats, unit, precision = 1 }) => {
  const fmt = (v: number | null | undefined) =>
    v != null ? Number(v).toFixed(precision) : '—';

  return (
    <div className="mt-3 pt-3 border-t border-base-200 grid grid-cols-3 gap-1 text-xs">
      {/* Min */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-info font-semibold">Min</span>
        <span className="font-bold">{fmt(stats.min)} {unit}</span>
        <span className="text-base-content/50">{fmtTime(stats.min_time)}</span>
      </div>

      {/* Avg */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-warning font-semibold">Ort</span>
        <span className="font-bold">{fmt(stats.avg)} {unit}</span>
        <span className="text-base-content/50">bugün</span>
      </div>

      {/* Max */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-error font-semibold">Max</span>
        <span className="font-bold">{fmt(stats.max)} {unit}</span>
        <span className="text-base-content/50">{fmtTime(stats.max_time)}</span>
      </div>
    </div>
  );
};

export default StatsRow;

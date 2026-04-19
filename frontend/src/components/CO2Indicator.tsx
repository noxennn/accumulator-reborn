import React from 'react';
import { Wind } from 'lucide-react';
import InfoTooltip from './InfoTooltip';
import StatsRow from './StatsRow';
import { SensorStatistics } from '../lib/analyticsApi';

interface CO2IndicatorProps {
  value: number;
  timestamp?: Date | string | null;
  stats?: SensorStatistics | null;
}

const CO2Indicator: React.FC<CO2IndicatorProps> = ({ value, timestamp, stats }) => {
  return (
    <div className="card bg-base-100 shadow-xl h-full">
      <div className="card-body p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wind className="w-5 h-5 text-primary" />
            <div className="flex items-center gap-1">
              <h2 className="card-title text-lg">CO₂</h2>
              <InfoTooltip
                title="Karbondioksit (CO₂)"
                description="Havadaki karbondioksit konsantrasyonu. Yüksek seviyeler baş ağrısı, yorgunluk ve konsantrasyon sorunlarına yol açabilir."
                optimalRange="400-800 ppm"
                timestamp={timestamp}
              />
            </div>
          </div>
          <div className="text-2xl font-bold">{Math.round(value)} ppm</div>
        </div>
        {stats && <StatsRow stats={stats} unit="ppm" precision={0} />}
      </div>
    </div>
  );
};

export default CO2Indicator;
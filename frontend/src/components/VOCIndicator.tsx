import React from 'react';
import { Wind } from 'lucide-react';
import InfoTooltip from './InfoTooltip';
import StatsRow from './StatsRow';
import { SensorStatistics } from '../lib/analyticsApi';

interface VOCIndicatorProps {
  value: number;
  timestamp?: Date | string | null;
  stats?: SensorStatistics | null;
}

const VOCIndicator: React.FC<VOCIndicatorProps> = ({ value, timestamp, stats }) => {
  return (
    <div className="card bg-base-100 shadow-xl h-full">
      <div className="card-body p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wind className="w-5 h-5 text-primary" />
            <div className="flex items-center gap-1">
              <h2 className="card-title text-lg">VOC</h2>
              <InfoTooltip
                title="Uçucu Organik Bileşikler (VOC)"
                description="Havada bulunan organik kimyasal maddeler. Yüksek seviyeler baş ağrısı, mide bulantısı ve göz tahrişine neden olabilir."
                optimalRange="0-3 ppm"
                timestamp={timestamp}
              />
            </div>
          </div>
          <div className="text-2xl font-bold">{value.toFixed(2)} ppm</div>
        </div>
        {stats && <StatsRow stats={stats} unit="ppb" precision={2} />}
      </div>
    </div>
  );
};

export default VOCIndicator;
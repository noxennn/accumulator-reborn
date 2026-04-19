import React from 'react';
import { useTranslation } from 'react-i18next';
import { Wind } from 'lucide-react';
import InfoTooltip from './InfoTooltip';
import StatsRow from './StatsRow';
import { SensorStatistics } from '../lib/analyticsApi';

interface PM10IndicatorProps {
  value: number;
  timestamp?: Date | string | null;
  stats?: SensorStatistics | null;
}

const PM10Indicator: React.FC<PM10IndicatorProps> = ({ value, timestamp, stats }) => {
  const { t } = useTranslation();

  return (
    <div className="card bg-base-100 shadow-xl h-full">
      <div className="card-body p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wind className="w-5 h-5 text-primary" />
            <div className="flex items-center gap-1">
              <h2 className="card-title text-lg">PM10</h2>
              <InfoTooltip
                title="PM10"
                description="10 mikrometreden küçük partikül madde. Solunum yollarını etkileyebilir ve alerjik reaksiyonlara neden olabilir."
                optimalRange="0-150 μg/m³"
                timestamp={timestamp}
              />
            </div>
          </div>
          <div className="text-2xl font-bold">{Math.round(value)} μg/m³</div>
        </div>
        {stats && <StatsRow stats={stats} unit="μg/m³" precision={1} />}
      </div>
    </div>
  );
};

export default PM10Indicator;
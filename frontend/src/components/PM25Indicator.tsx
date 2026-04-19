import React from 'react';
import { useTranslation } from 'react-i18next';
import { Wind } from 'lucide-react';
import InfoTooltip from './InfoTooltip';
import StatsRow from './StatsRow';
import { SensorStatistics } from '../lib/analyticsApi';

interface PM25IndicatorProps {
  value: number;
  timestamp?: Date | string | null;
  stats?: SensorStatistics | null;
}

const PM25Indicator: React.FC<PM25IndicatorProps> = ({ value, timestamp, stats }) => {
  const { t } = useTranslation();

  return (
    <div className="card bg-base-100 shadow-xl h-full">
      <div className="card-body p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wind className="w-5 h-5 text-primary" />
            <div className="flex items-center gap-1">
              <h2 className="card-title text-lg">PM2.5</h2>
              <InfoTooltip
                title="PM2.5"
                description="2.5 mikrometreden küçük partikül madde. Akciğerlere derinlemesine nüfuz edebilir ve solunum sorunlarına yol açabilir."
                optimalRange="0-35 μg/m³"
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

export default PM25Indicator;
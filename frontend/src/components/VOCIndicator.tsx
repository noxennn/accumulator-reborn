import React from 'react';
import { Wind } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import InfoTooltip from './InfoTooltip';
import StatsRow from './StatsRow';
import { SensorStatistics } from '../lib/analyticsApi';

interface VOCIndicatorProps {
  value: number;
  timestamp?: Date | string | null;
  stats?: SensorStatistics | null;
}

const VOCIndicator: React.FC<VOCIndicatorProps> = ({ value, timestamp, stats }) => {
  const { t } = useTranslation();
  return (
    <div className="card bg-base-100 shadow-xl h-full">
      <div className="card-body p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wind className="w-5 h-5 text-primary" />
            <div className="flex items-center gap-1">
              <h2 className="card-title text-lg">VOC</h2>
              <InfoTooltip
                title={t('sensorTooltips.voc.title')}
                description={t('sensorTooltips.voc.description')}
                optimalRange={t('sensorTooltips.voc.optimalRange')}
                timestamp={timestamp}
              />
            </div>
          </div>
          <div className="text-2xl font-bold leading-none">
            {value.toFixed(2)} <span className="text-sm font-semibold opacity-70">ppm</span>
          </div>
        </div>
        {stats && <StatsRow stats={stats} unit="ppb" precision={2} />}
      </div>
    </div>
  );
};

export default VOCIndicator;
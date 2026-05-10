import React from 'react';
import { useTranslation } from 'react-i18next';
import { Wind } from 'lucide-react';
import InfoTooltip from './InfoTooltip';

interface AQIIndicatorProps {
  value: number;
  timestamp?: Date | string | null;
}

const AQIIndicator: React.FC<AQIIndicatorProps> = ({ value, timestamp }) => {
  const { t } = useTranslation();

  const getAQIColor = (aqi: number) => {
    if (aqi <= 50) return 'bg-aqi-good';
    if (aqi <= 100) return 'bg-aqi-moderate';
    if (aqi <= 150) return 'bg-aqi-poor';
    if (aqi <= 200) return 'bg-aqi-very-poor';
    return 'bg-aqi-hazardous';
  };

  const getAQILabel = (aqi: number) => {
    if (aqi <= 50) return t('aqi.levels.good');
    if (aqi <= 100) return t('aqi.levels.moderate');
    if (aqi <= 150) return t('aqi.levels.poor');
    if (aqi <= 200) return t('aqi.levels.veryPoor');
    return t('aqi.levels.hazardous');
  };

  const getAQIDescription = (aqi: number) => {
    if (aqi <= 50) return t('aqi.description.good');
    if (aqi <= 100) return t('aqi.description.moderate');
    if (aqi <= 150) return t('aqi.description.poor');
    if (aqi <= 200) return t('aqi.description.veryPoor');
    return t('aqi.description.hazardous');
  };

  // Değeri yuvarla ve maksimum 3 basamakla sınırla
  const displayValue = Math.min(Math.round(value), 999);

  return (
    <div className="card bg-base-100 shadow-xl h-full">
      <div className="card-body p-4">
        <div className="flex items-center gap-2 min-w-0">
          <Wind className="w-5 h-5 text-primary" />
          <div className="flex items-start gap-1 min-w-0">
            <h2 className="card-title flex-1 min-w-0 text-sm sm:text-base lg:text-lg leading-tight whitespace-normal break-words">
              {t('aqi.title')}
            </h2>
            <div className="shrink-0 mt-0.5">
              <InfoTooltip
                title={t('aqi.title')}
                description={getAQIDescription(value)}
                optimalRange="0-50"
                timestamp={timestamp}
              />
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold">{getAQILabel(value)}</p>
            <p className="text-sm opacity-70">{t('aqi.currentLevel')}</p>
          </div>
          <div className={`shrink-0 w-12 h-12 rounded-full ${getAQIColor(value)} flex items-center justify-center text-white text-lg font-bold`}>
            {displayValue}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AQIIndicator;
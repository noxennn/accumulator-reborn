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

  // Değeri yuvarla ve maksimum 3 basamakla sınırla
  const displayValue = Math.min(Math.round(value), 999);

  return (
    <div className="card bg-base-100 shadow-xl h-full">
      <div className="card-body p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wind className="w-5 h-5 text-primary" />
            <div className="flex items-center gap-1">
              <h2 className="card-title text-lg">{t('aqi.title')}</h2>
              <InfoTooltip
                title={t('aqi.title')}
                description={t('aqi.description')}
                optimalRange="0-50"
                timestamp={timestamp}
              />
            </div>
          </div>
          <div className={`w-12 h-12 rounded-full ${getAQIColor(value)} flex items-center justify-center text-white text-lg font-bold`}>
            {displayValue}
          </div>
        </div>
        <div className="mt-2">
          <p className="text-lg font-semibold">{getAQILabel(value)}</p>
          <p className="text-sm opacity-70">{t('aqi.currentLevel')}</p>
        </div>
      </div>
    </div>
  );
};

export default AQIIndicator;
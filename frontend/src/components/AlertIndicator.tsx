import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

interface AlertIndicatorProps {
  alerts: string[];
}

const AlertIndicator: React.FC<AlertIndicatorProps> = ({ alerts }) => {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);

  const getAlertMessage = () => {
    if (alerts.length === 0) {
      return {
        message: t('alerts.all_normal'),
        color: "text-success"
      };
    } else if (alerts.length <= 2) {
      return {
        message: t('alerts.some_high'),
        color: "text-warning"
      };
    } else {
      return {
        message: t('alerts.critical'),
        color: "text-error"
      };
    }
  };

  const alertStatus = getAlertMessage();

  return (
    <div className="card bg-base-100 shadow-xl h-full">
      <div className="card-body p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-5 h-5 ${alertStatus.color}`} />
          <h2 className="card-title text-lg">{t('alerts.title')}</h2>
        </div>
        <div className="mt-2">
          <button 
            className={`flex items-center gap-2 text-lg font-semibold ${alertStatus.color} hover:opacity-80 transition-opacity`}
            onClick={() => setShowDetails(!showDetails)}
          >
            {alertStatus.message}
            {alerts.length > 0 && (
              showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
            )}
          </button>
          {showDetails && alerts.length > 0 && (
            <div className="mt-2 space-y-2">
              {alerts.map((alert, index) => (
                <div key={index} className="flex items-center gap-2 text-warning">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{alert}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AlertIndicator; 
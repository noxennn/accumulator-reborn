import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { settingsApi } from '../lib/settingsApi';

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [measurementSystem, setMeasurementSystem] = useState<'metric' | 'imperial'>('metric');
  const [thresholds, setThresholds] = useState({
    co2: 1000,
    pm25: 25,
    pm10: 50,
    voc: 500
  });

  // Fetch settings from API when component mounts
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        const settings = await settingsApi.getSettings();
        
        // Update state with fetched settings
        setNotifications(settings.notifications);
        setMeasurementSystem(settings.format);
        setThresholds(settings.thresholds);
      } catch (error) {
        console.error('Failed to fetch settings:', error);
        // Keep default values
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  // Handle saving settings
  const saveSettings = async () => {
    try {
      setLoading(true);
      
      // Prepare settings data for API
      const updatedSettings = {
        notifications,
        format: measurementSystem,
        thresholds
      };
      
      // Send to API
      await settingsApi.updateSettings(updatedSettings);
      
      // Show success message (could use a toast or alert)
      alert(t('settingsPage.saveSuccess'));
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert(t('settingsPage.saveError'));
    } finally {
      setLoading(false);
    }
  };

  // Update a threshold value
  const updateThreshold = (key: string, value: number) => {
    setThresholds(prev => ({
      ...prev,
      [key]: value
    }));
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">{t('settingsPage.title')}</h1>
      
      <div className="space-y-6">
        {/* Bildirim Ayarları */}
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">{t('settingsPage.notifications.title')}</h2>
            <div className="form-control">
              <label className="label cursor-pointer">
                <span className="label-text">{t('settingsPage.notifications.enable')}</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifications}
                  onChange={(e) => setNotifications(e.target.checked)}
                  disabled={loading}
                />
              </label>
            </div>
            <p className="text-sm opacity-70">{t('settingsPage.notifications.description')}</p>
          </div>
        </div>

        {/* Uyarı Eşikleri */}
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">{t('settingsPage.thresholds.title')}</h2>
            <div className="space-y-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">{t('settingsPage.thresholds.co2')}</span>
                </label>
                <input 
                  type="number" 
                  className="input input-bordered" 
                  value={thresholds.co2}
                  onChange={(e) => updateThreshold('co2', parseInt(e.target.value))}
                  disabled={loading}
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">{t('settingsPage.thresholds.pm25')}</span>
                </label>
                <input 
                  type="number" 
                  className="input input-bordered" 
                  value={thresholds.pm25}
                  onChange={(e) => updateThreshold('pm25', parseInt(e.target.value))}
                  disabled={loading}
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">{t('settingsPage.thresholds.pm10')}</span>
                </label>
                <input 
                  type="number" 
                  className="input input-bordered" 
                  value={thresholds.pm10}
                  onChange={(e) => updateThreshold('pm10', parseInt(e.target.value))}
                  disabled={loading}
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">{t('settingsPage.thresholds.voc')}</span>
                </label>
                <input 
                  type="number" 
                  className="input input-bordered" 
                  value={thresholds.voc}
                  onChange={(e) => updateThreshold('voc', parseInt(e.target.value))}
                  disabled={loading}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Görüntüleme Ayarları */}
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">{t('settingsPage.display.title')}</h2>
            <div className="form-control">
              <label className="label">
                <span className="label-text">{t('settingsPage.display.system')}</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={measurementSystem}
                onChange={(e) => setMeasurementSystem(e.target.value as 'metric' | 'imperial')}
                disabled={loading}
              >
                <option value="metric">{t('settingsPage.display.metric')}</option>
                <option value="imperial">{t('settingsPage.display.imperial')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button 
            className="btn btn-primary"
            onClick={saveSettings}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="loading loading-spinner"></span>
                {t('settingsPage.saving')}
              </>
            ) : (
              t('settingsPage.saveChanges')
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
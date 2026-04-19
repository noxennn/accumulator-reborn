import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Save, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { settingsApi } from '../lib/settingsApi';
import { UserSettings } from '../types';

const Settings = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings>({
    id: 0,
    notifications: true,
    format: 'metric',
    thresholds: {
      co2: 1000,
      pm25: 35,
      pm10: 150,
      voc: 3,
    },
  });

  // Fetch user settings from API
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        const data = await settingsApi.getSettings();
        setSettings(data);
      } catch (err) {
        console.error('Error fetching settings:', err);
        setError(t('settingsPage.loadError'));
      } finally {
        setLoading(false);
      }
    };
    
    fetchSettings();
  }, [t]);

  // Save settings to API
  const saveSettings = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      
      const updatedSettings = await settingsApi.updateSettings({
        notifications: settings.notifications,
        format: settings.format,
        thresholds: settings.thresholds,
      });
      
      setSettings(updatedSettings);
      setSuccess(t('settingsPage.saveSuccess'));
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Error saving settings:', err);
      setError(t('settingsPage.saveError'));
    } finally {
      setSaving(false);
    }
  };

  // Update a threshold value
  const updateThreshold = (key: keyof typeof settings.thresholds, value: number) => {
    setSettings({
      ...settings,
      thresholds: {
        ...settings.thresholds,
        [key]: value,
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {error && (
        <div className="alert alert-error shadow-lg mb-4">
          <div>
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}
      
      {success && (
        <div className="alert alert-success shadow-lg mb-4">
          <div>
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{success}</span>
          </div>
        </div>
      )}

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">{t('settingsPage.notifications.title')}</h2>
          <div className="form-control">
            <label className="label cursor-pointer">
              <span className="label-text">{t('settingsPage.notifications.enable')}</span>
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={settings.notifications}
                onChange={(e) => setSettings({ ...settings, notifications: e.target.checked })}
              />
            </label>
          </div>
          <div className="flex items-center gap-2 text-sm opacity-70">
            {settings.notifications ? (
              <>
                <Bell className="w-4 h-4" />
                <span>{t('settingsPage.notifications.enabled')}</span>
              </>
            ) : (
              <>
                <BellOff className="w-4 h-4" />
                <span>{t('settingsPage.notifications.disabled')}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">{t('settingsPage.thresholds.title')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text">{t('settingsPage.thresholds.co2')}</span>
              </label>
              <input
                type="number"
                className="input input-bordered"
                value={settings.thresholds.co2}
                onChange={(e) => updateThreshold('co2', Number(e.target.value))}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text">{t('settingsPage.thresholds.pm25')}</span>
              </label>
              <input
                type="number"
                className="input input-bordered"
                value={settings.thresholds.pm25}
                onChange={(e) => updateThreshold('pm25', Number(e.target.value))}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text">{t('settingsPage.thresholds.pm10')}</span>
              </label>
              <input
                type="number"
                className="input input-bordered"
                value={settings.thresholds.pm10}
                onChange={(e) => updateThreshold('pm10', Number(e.target.value))}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text">{t('settingsPage.thresholds.voc')}</span>
              </label>
              <input
                type="number"
                className="input input-bordered"
                value={settings.thresholds.voc}
                onChange={(e) => updateThreshold('voc', Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">{t('settingsPage.display.title')}</h2>
          <div className="form-control">
            <label className="label">
              <span className="label-text">{t('settingsPage.display.system')}</span>
            </label>
            <select
              className="select select-bordered w-full max-w-xs"
              value={settings.format}
              onChange={(e) => setSettings({ ...settings, format: e.target.value })}
            >
              <option value="metric">{t('settingsPage.display.metric')}</option>
              <option value="imperial">{t('settingsPage.display.imperial')}</option>
            </select>
          </div>
        </div>
      </div>
      
      <div className="flex justify-end mt-4">
        <button 
          className="btn btn-primary"
          onClick={saveSettings}
          disabled={saving}
        >
          {saving ? (
            <>
              <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
              {t('settingsPage.saving')}
            </>
          ) : (
            <>
              <Save className="h-5 w-5 mr-2" />
              {t('settingsPage.saveChanges')}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default Settings;
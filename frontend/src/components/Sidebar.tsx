import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, LineChart, Settings, Wind } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';

const Sidebar = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  
  return (
    <div className="h-screen w-64 bg-base-200 p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-8">
        <Wind className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Accumulator</h1>
          <p className="text-xs opacity-70">{t('airQualityStation')}</p>
        </div>
      </div>
      
      <nav className="flex flex-col gap-2">
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `flex items-center gap-2 p-3 rounded-lg transition-colors ${
              isActive ? 'bg-primary text-primary-content' : 'hover:bg-base-300'
            }`
          }
        >
          <LayoutDashboard className="w-5 h-5" />
          <span>{t('dashboard')}</span>
        </NavLink>
        
        <NavLink
          to="/analytics"
          className={({ isActive }) =>
            `flex items-center gap-2 p-3 rounded-lg transition-colors ${
              isActive ? 'bg-primary text-primary-content' : 'hover:bg-base-300'
            }`
          }
        >
          <LineChart className="w-5 h-5" />
          <span>{t('analytics')}</span>
        </NavLink>
        
        {/* Ayarlar menüsünü sadece giriş yapmış kullanıcılara göster */}
        {isAuthenticated && (
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2 p-3 rounded-lg transition-colors ${
                isActive ? 'bg-primary text-primary-content' : 'hover:bg-base-300'
              }`
            }
          >
            <Settings className="w-5 h-5" />
            <span>{t('settings')}</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
};

export default Sidebar;
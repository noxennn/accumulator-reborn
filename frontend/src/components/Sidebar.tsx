import { NavLink } from 'react-router-dom';
import { LayoutDashboard, LineChart, Settings, Wind, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';

const Sidebar = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  
  return (
    <div className="hidden lg:flex sticky top-0 h-screen w-64 bg-base-200 p-4 flex-col shrink-0 overflow-y-auto">
      <div className="flex items-center gap-2 mb-8">
        <Wind className="w-8 h-8 text-primary" />
        <h1 className="text-xl font-bold">{t('appTitle')}</h1>
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

        <NavLink
          to="/watch"
          className={({ isActive }) =>
            `flex items-center gap-2 p-3 rounded-lg transition-colors ${
              isActive ? 'bg-primary text-primary-content' : 'hover:bg-base-300'
            }`
          }
        >
          <Activity className="w-5 h-5" />
          <span>{t('watch.title')}</span>
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
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from './components/Sidebar';
import ThemeToggle from './components/ThemeToggle';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import Watch from './pages/Watch';
import Login from './pages/Login';
import Register from './pages/Register';
import { useAuth } from './hooks/useAuth';
import { LogOut, LogIn, UserPlus, LayoutDashboard, LineChart, Activity, Wind } from 'lucide-react';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const Navbar = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout, isAuthenticated } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="navbar sticky top-0 z-30 border-b border-base-300/80 bg-base-100/90 backdrop-blur supports-[backdrop-filter]:bg-base-100/75 px-3 sm:px-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0 lg:hidden">
          <Wind className="w-5 h-5 text-primary shrink-0" />
          <h1 className="text-sm sm:text-lg font-semibold truncate">{t('appTitle')}</h1>
        </div>
      </div>
      <div className="flex-none flex items-center gap-0.5 sm:gap-1">
        <ThemeToggle />
        
        {isAuthenticated ? (
          // Giriş yapmış kullanıcı için çıkış butonu
          <button 
            onClick={handleLogout}
              className="btn btn-ghost btn-circle btn-sm sm:btn-md"
            title={t('logout')}
          >
            <LogOut className="h-5 w-5" />
          </button>
        ) : (
          // Giriş yapmamış kullanıcı için giriş/kayıt butonları - yerlerini değiştirdim
          <>
            <button 
              onClick={() => navigate('/register')}
              className="btn btn-ghost btn-circle btn-sm sm:btn-md"
              title={t('register.submit')}
            >
              <UserPlus className="h-5 w-5" />
            </button>
            <button 
              onClick={() => navigate('/login')}
              className="btn btn-ghost btn-circle btn-sm sm:btn-md"
              title={t('login.submit')}
            >
              <LogIn className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'dashboard' },
  { to: '/analytics', icon: LineChart,       label: 'analytics' },
  { to: '/watch',     icon: Activity,        label: 'watch.title' },
] as const;

const MobileNav = () => {
  const { t } = useTranslation();

  return (
    <nav className="lg:hidden fixed left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 rounded-2xl border border-base-300/80 bg-base-200/90 shadow-[0_10px_35px_-12px_rgba(0,0,0,0.45)] backdrop-blur supports-[backdrop-filter]:bg-base-200/80">
      <div className="grid grid-cols-3 p-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center py-2 text-[11px] rounded-xl transition-all ${
                isActive ? 'text-primary font-semibold bg-base-100/90 shadow-sm' : 'opacity-70'
              }`
            }
          >
            <Icon className="h-4 w-4 mb-1" />
            <span>{t(label)}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
};

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex min-h-screen bg-base-100 overflow-x-clip">
      <Sidebar />
      <div className="flex-1 min-w-0">
        <Navbar />
        <main className="container mx-auto max-w-7xl px-3 sm:px-4 md:px-6 pt-3 md:pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-6">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
};

function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route path="/register" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Register />} />
        
        {/* Dashboard artık korumalı değil, herkes erişebilir */}
        <Route path="/dashboard" element={
          <MainLayout>
            <Dashboard />
          </MainLayout>
        } />
        
        {/* Analytics artık korumalı değil, herkes erişebilir */}
        <Route path="/analytics" element={
          <MainLayout>
            <Analytics />
          </MainLayout>
        } />
        
        {/* Watch — public, real-time live feed */}
        <Route path="/watch" element={
          <MainLayout>
            <Watch />
          </MainLayout>
        } />

        {/* Settings hala korumalı */}
        <Route path="/settings" element={
          <ProtectedRoute>
            <MainLayout>
              <Settings />
            </MainLayout>
          </ProtectedRoute>
        } />
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
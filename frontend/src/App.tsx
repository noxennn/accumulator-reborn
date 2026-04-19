import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from './components/Sidebar';
import ThemeToggle from './components/ThemeToggle';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Register from './pages/Register';
import { useAuth } from './hooks/useAuth';
import { LogOut, LogIn, UserPlus } from 'lucide-react';

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
    <div className="navbar bg-base-200">
      <div className="flex-1">
        <h1 className="text-xl font-semibold">{t('airQualityStation')}</h1>
      </div>
      <div className="flex-none gap-2">
        <ThemeToggle />
        
        {isAuthenticated ? (
          // Giriş yapmış kullanıcı için çıkış butonu
          <button 
            onClick={handleLogout}
            className="btn btn-ghost btn-circle"
            title={t('logout')}
          >
            <LogOut className="h-5 w-5" />
          </button>
        ) : (
          // Giriş yapmamış kullanıcı için giriş/kayıt butonları - yerlerini değiştirdim
          <>
            <button 
              onClick={() => navigate('/register')}
              className="btn btn-ghost btn-circle"
              title={t('register.submit')}
            >
              <UserPlus className="h-5 w-5" />
            </button>
            <button 
              onClick={() => navigate('/login')}
              className="btn btn-ghost btn-circle"
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

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex min-h-screen bg-base-100">
      <Sidebar />
      <div className="flex-1">
        <Navbar />
        <main className="container mx-auto">
          {children}
        </main>
      </div>
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
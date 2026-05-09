import { useState, useEffect } from 'react';
import { authApi } from '../lib/api';

interface User {
  id: number;
  email: string;
}

export const useAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // This effect checks if the user is authenticated when the app loads
  useEffect(() => {
    const checkAuth = async () => {
      setLoading(true);
      try {
        // Check if token exists and is valid by fetching user data
        if (authApi.isAuthenticated()) {
          const userData = await authApi.getCurrentUser();
          if (userData) {
            setUser(userData);
            setIsAuthenticated(true);
          } else {
            // If token is invalid, ensure we're logged out
            setIsAuthenticated(false);
            setUser(null);
          }
        } else {
          setIsAuthenticated(false);
          setUser(null);
        }
      } catch (err) {
        console.error('Auth check error:', err);
        setError(err instanceof Error ? err.message : 'Authentication error');
        setIsAuthenticated(false);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Setup an event listener for storage changes from other tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'access_token') {
        setIsAuthenticated(!!e.newValue);
        // Refresh user data if token changes
        if (e.newValue) {
          authApi.getCurrentUser().then(userData => {
            if (userData) setUser(userData);
          });
        } else {
          setUser(null);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const register = async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      // Register the user via API
      await authApi.register({ email, password });
      
      // After successful registration, log in
      const loginResponse = await authApi.login({ email, password });
      if (loginResponse.access_token) {
        const userData = await authApi.getCurrentUser();
        if (userData) {
          setUser(userData);
          setIsAuthenticated(true);
          return true;
        }
      }
      
      return false;
    } catch (err) {
      console.error('Registration error:', err);
      setError(err instanceof Error ? err.message : 'Registration failed');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      // Login via API
      const response = await authApi.login({ email, password });
      if (response.access_token) {
        const userData = await authApi.getCurrentUser();
        if (userData) {
          setUser(userData);
          setIsAuthenticated(true);
          return true;
        }
      }
      
      return false;
    } catch (err) {
      console.error('Login error:', err);
      setError(err instanceof Error ? err.message : 'Login failed');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    authApi.logout();
    setIsAuthenticated(false);
    setUser(null);
  };

  return { 
    isAuthenticated, 
    login, 
    logout, 
    register, 
    user, 
    loading, 
    error 
  };
};
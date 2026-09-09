import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setCSRF } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [csrf, setCsrfState]  = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/api/auth/me');
      setUser(data);
      setCSRF(data.csrf);
      setCsrfState(data.csrf);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    const onLogout = () => setUser(null);
    window.addEventListener('iqpanel:logout', onLogout);
    return () => window.removeEventListener('iqpanel:logout', onLogout);
  }, [refresh]);

  const login = useCallback(async (email, password, totp) => {
    const data = await api.post('/api/auth/login', { email, password, totp });
    setCSRF(data.csrf);
    setCsrfState(data.csrf);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout', {}); } catch {}
    setUser(null);
  }, []);

  const reauth = useCallback(async (password) => {
    await api.post('/api/auth/reauth', { password });
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, csrf, login, logout, reauth, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}

import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api, setToken, clearToken, getStoredUser, setStoredUser } from './utils/api';
import Login from './pages/Login';
import OSOverview from './pages/OSOverview';
import Agents from './pages/Agents';
import Intake from './pages/Intake';
import EmailAgent from './pages/EmailAgent';
import BusinessMemory from './pages/BusinessMemory';
import TeamHome from './pages/TeamHome';
import Dashboard from './pages/Dashboard';
import Issues from './pages/Issues';
import IssueDetail from './pages/IssueDetail';
import Properties from './pages/Properties';
import PropertyDetail from './pages/PropertyDetail';
import Tenants from './pages/Tenants';
import TenantDetail from './pages/TenantDetail';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import Contractors from './pages/Contractors';
import Compliance from './pages/Compliance';
import IssueTimeline from './pages/IssueTimeline';
import Utilities from './pages/Utilities';
import CheckIns from './pages/CheckIns';
import CheckOuts from './pages/CheckOuts';
import InspectionDetail from './pages/InspectionDetail';
import Finance from './pages/Finance';
import Layout from './components/Layout';

const AuthContext = createContext(null);
export function useAuth() { return useContext(AuthContext); }

function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const token = localStorage.getItem('psb_token');
    if (token) {
      api.me().then(res => { setUser(res.user); setStoredUser(res.user); }).catch(() => { setUser(null); clearToken(); }).finally(() => setLoading(false));
    } else setLoading(false);
  }, []);
  const login = async (email, password) => { const res = await api.login(email, password); setToken(res.token); setStoredUser(res.user); setUser(res.user); return res; };
  const logout = () => { clearToken(); setUser(null); localStorage.removeItem('psb_user'); };
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0f' }}><div className="loading-spinner" /></div>;
  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

function ProtectedRoute({ children }) { const { user } = useAuth(); if (!user) return <Navigate to="/login" replace />; return children; }

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<TeamHome />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="os" element={<OSOverview />} />
            <Route path="agents" element={<Agents />} />
            <Route path="intake" element={<Intake />} />
            <Route path="email-agent" element={<EmailAgent />} />
            <Route path="business-memory" element={<BusinessMemory />} />
            <Route path="issues" element={<Issues />} />
            <Route path="issues/:id" element={<IssueDetail />} />
            <Route path="timeline" element={<IssueTimeline />} />
            <Route path="properties" element={<Properties />} />
            <Route path="properties/:id" element={<PropertyDetail />} />
            <Route path="tenants" element={<Tenants />} />
            <Route path="tenants/:id" element={<TenantDetail />} />
            <Route path="contractors" element={<Contractors />} />
            <Route path="compliance" element={<Compliance />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="utilities" element={<Utilities />} />
            <Route path="check-ins" element={<CheckIns />} />
            <Route path="check-ins/:id" element={<InspectionDetail />} />
            <Route path="check-outs" element={<CheckOuts />} />
            <Route path="check-outs/:id" element={<InspectionDetail />} />
            <Route path="finance" element={<Finance />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

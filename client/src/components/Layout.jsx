import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../App';
import { LayoutDashboard, AlertCircle, Building2, Users, Settings, LogOut, Wrench, BarChart3, Menu, X } from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const handleLogout = () => { logout(); navigate('/login'); };
  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U';

  // Close mobile nav on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Prevent body scroll when mobile nav is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const navLinks = (
    <>
      <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}><LayoutDashboard size={18} /> Dashboard</NavLink>
      <NavLink to="/issues" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}><AlertCircle size={18} /> Issues</NavLink>
      <NavLink to="/properties" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}><Building2 size={18} /> Properties</NavLink>
      <NavLink to="/tenants" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}><Users size={18} /> Tenants</NavLink>
      <NavLink to="/analytics" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}><BarChart3 size={18} /> Analytics</NavLink>
      {user?.role === 'admin' && <NavLink to="/settings" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}><Settings size={18} /> Settings</NavLink>}
    </>
  );

  return (
    <div className="app-layout">
      {/* Desktop sidebar */}
      <aside className="sidebar sidebar-desktop">
        <div className="sidebar-brand">
          <h1><Wrench size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6, opacity: 0.6 }} />PSB Maintenance</h1>
          <span>Property Management Hub</span>
        </div>
        <nav className="sidebar-nav">{navLinks}</nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{initials}</div>
            <div className="sidebar-user-info"><div className="sidebar-user-name">{user?.name}</div><div className="sidebar-user-role">{user?.role}</div></div>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout} title="Log out"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="mobile-header">
        <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)}>
          <Menu size={22} />
        </button>
        <h1 className="mobile-header-title"><Wrench size={14} style={{ opacity: 0.6 }} /> PSB Maintenance</h1>
        <div className="sidebar-user-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{initials}</div>
      </div>

      {/* Mobile slide-out nav */}
      {mobileOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar sidebar-mobile ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1><Wrench size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6, opacity: 0.6 }} />PSB Maintenance</h1>
            <span>Property Management Hub</span>
          </div>
          <button className="mobile-menu-btn" onClick={() => setMobileOpen(false)}><X size={20} /></button>
        </div>
        <nav className="sidebar-nav">{navLinks}</nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{initials}</div>
            <div className="sidebar-user-info"><div className="sidebar-user-name">{user?.name}</div><div className="sidebar-user-role">{user?.role}</div></div>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout} title="Log out"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content"><Outlet /></main>
    </div>
  );
}

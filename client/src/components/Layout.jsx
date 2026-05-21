import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../App';
import { LayoutDashboard, AlertCircle, Building2, Users, Settings, LogOut, Wrench, BarChart3, Menu, X, HardHat, ShieldCheck, CalendarRange, Zap, Sparkles, ClipboardCheck, ClipboardList, Landmark, Workflow, Bot, Inbox, MailCheck, Database, BedDouble } from 'lucide-react';
import CopilotPanel from './CopilotPanel';

// Page-contextual placeholder suggestions that rotate
const PAGE_SUGGESTIONS = {
  '/': [
    'What needs attention today?',
    'Which replies are waiting?',
    'Show urgent maintenance',
    'What approvals need review?',
    'What is due today?',
  ],
  '/dashboard': [
    'How many open issues do we have?',
    'Total spend this month?',
    'Which property has the most issues?',
    'Are any compliance certs expiring?',
    'Show me overdue issues',
  ],
  '/os': [
    'What needs attention across the business?',
    'Which operating lane is weakest?',
    'What needs approval?',
    'Show me the biggest risk signals',
  ],
  '/agents': [
    'Run the compliance guardian',
    'Draft a contractor value check',
    'Preview a leasing revenue action',
    'What can Codex agents do today?',
  ],
  '/intake': [
    'Import the team WhatsApp chat',
    'What tasks were extracted?',
    'Which items need approval?',
    'Which agent should handle this?',
  ],
  '/email-agent': [
    'Sync admin inbox now',
    'What replies need approval?',
    'Generate today\'s team email brief',
    'Which email follow-ups are open?',
  ],
  '/short-lets': [
    'What are short-let bookings doing?',
    'Any check-ins or check-outs today?',
    'Show Guesty gap nights',
    'Run the Short-Let Operator',
  ],
  '/business-memory': [
    'Generate a business memory snapshot',
    'Show the latest property memory',
    'Which files should Codex read first?',
    'What changed in today\'s digest?',
  ],
  '/issues': [
    'Which issues are escalated?',
    'Most common issue category?',
    'List urgent issues',
    'How many issues resolved this week?',
    'Any issues open more than 48 hours?',
  ],
  '/properties': [
    'Which property costs us the most?',
    'How many tenants at 52 Old Elvet?',
    'Show spending by property',
    'Which property has the most open issues?',
  ],
  '/tenants': [
    'Which tenant has the most complaints?',
    'What flat is a tenant in?',
    'How many tenants do we have?',
    'List tenants at Claypath',
  ],
  '/contractors': [
    'Who is our plumber?',
    'Show Tony Finnan contact details',
    'List all active contractors',
    'Which contractor has the most quotes?',
  ],
  '/analytics': [
    'Average resolution time?',
    'How much have we spent this year?',
    'Break down costs by category',
    'What percentage does AI resolve?',
  ],
  '/utilities': [
    'Which property uses the most gas?',
    'Total utility spend this year?',
    'Compare electric usage across properties',
    'Any properties over fair usage limits?',
  ],
  '/compliance': [
    'Are any certificates expired?',
    'When does the gas safety cert expire?',
    'List all compliance documents',
    'Which properties need EPC renewal?',
  ],
  '/check-ins': [
    'How many check-ins are completed?',
    'Any check-ins pending signature?',
    'Show recent check-in inspections',
  ],
  '/check-outs': [
    'Total deposit deductions so far?',
    'Any check-outs in progress?',
    'Which check-out had highest deductions?',
  ],
  '/finance': [
    'How much did we spend this month?',
    'What is our biggest expense category?',
    'Show spending by property',
    'Total maintenance spend this year?',
    'Who do we pay the most?',
  ],
  '/settings': [
    'What LLM provider are we using?',
    'How many staff accounts are there?',
    'Is email sync enabled?',
  ],
};

const DEFAULT_SUGGESTIONS = [
  'Ask me anything about your properties...',
  'Search tenants, issues, contractors...',
  'How much did we spend last month?',
  'Who is our electrician?',
];

function SidebarLink({ to, icon: Icon, label, end = false }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
      <Icon size={17} />
      <span>{label}</span>
    </NavLink>
  );
}

function NavSection({ label, children }) {
  return (
    <div className="sidebar-section">
      <div className="sidebar-section-label">{label}</div>
      {children}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [fadeClass, setFadeClass] = useState('cph-in');
  const handleLogout = () => { logout(); navigate('/login'); };
  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U';

  // Get the base path for matching suggestions
  const basePath = useMemo(() => {
    const p = location.pathname;
    // Match /issues, /issues/123, etc. to '/issues'
    const match = Object.keys(PAGE_SUGGESTIONS).find(key =>
      key === '/' ? p === '/' : p.startsWith(key)
    );
    return match || '/';
  }, [location.pathname]);

  const suggestions = PAGE_SUGGESTIONS[basePath] || DEFAULT_SUGGESTIONS;

  // Rotate placeholder text with fade animation
  useEffect(() => {
    setPlaceholderIndex(0);
    setFadeClass('cph-in');
  }, [basePath]);

  useEffect(() => {
    const interval = setInterval(() => {
      setFadeClass('cph-out');
      setTimeout(() => {
        setPlaceholderIndex(prev => (prev + 1) % suggestions.length);
        setFadeClass('cph-in');
      }, 300);
    }, 4000);
    return () => clearInterval(interval);
  }, [suggestions]);

  // Close mobile nav on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Prevent body scroll when mobile nav is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const navLinks = (
    <>
      <NavSection label="Start Here">
        <SidebarLink to="/" end icon={LayoutDashboard} label="Today" />
        <SidebarLink to="/email-agent" icon={MailCheck} label="Email & Drafts" />
        <SidebarLink to="/issues" icon={AlertCircle} label="Maintenance" />
        <SidebarLink to="/agents" icon={Bot} label="Tasks & Approvals" />
      </NavSection>

      <NavSection label="People & Places">
        <SidebarLink to="/properties" icon={Building2} label="Properties" />
        <SidebarLink to="/tenants" icon={Users} label="Tenants" />
        <SidebarLink to="/contractors" icon={HardHat} label="Contractors" />
      </NavSection>

      <NavSection label="Business Control">
        <SidebarLink to="/short-lets" icon={BedDouble} label="Short Lets" />
        <SidebarLink to="/compliance" icon={ShieldCheck} label="Compliance" />
        <SidebarLink to="/finance" icon={Landmark} label="Finance" />
        <SidebarLink to="/utilities" icon={Zap} label="Utilities" />
      </NavSection>

      <NavSection label="More Tools">
        <SidebarLink to="/intake" icon={Inbox} label="WhatsApp Intake" />
        <SidebarLink to="/business-memory" icon={Database} label="Business Memory" />
        <SidebarLink to="/os" icon={Workflow} label="FFR OS" />
        <SidebarLink to="/dashboard" icon={BarChart3} label="Analytics" />
        <SidebarLink to="/check-ins" icon={ClipboardCheck} label="Check-In" />
        <SidebarLink to="/check-outs" icon={ClipboardList} label="Check-Out" />
        <SidebarLink to="/timeline" icon={CalendarRange} label="Timeline" />
        <SidebarLink to="/settings" icon={Settings} label="Settings" />
      </NavSection>
    </>
  );

  const sidebarBrand = (
    <div className="sidebar-brand">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'var(--gradient-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(99,102,241,0.3)', flexShrink: 0
        }}>
          <Wrench size={16} style={{ color: 'white' }} />
        </div>
        <div>
          <h1>FFR Property OS</h1>
          <span>Agentic Operations Hub</span>
        </div>
      </div>
    </div>
  );

  const userFooter = (
    <div className="sidebar-footer">
      <div className="sidebar-user">
        <div className="sidebar-user-avatar">{initials}</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">{user?.name}</div>
          <div className="sidebar-user-role">{user?.role}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleLogout} title="Log out" style={{ color: 'var(--text-muted)' }}>
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="app-layout">
      {/* Desktop sidebar */}
      <aside className="sidebar sidebar-desktop">
        {sidebarBrand}
        <nav className="sidebar-nav">{navLinks}</nav>
        {userFooter}
      </aside>

      {/* Mobile header */}
      <div className="mobile-header">
        <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)}>
          <Menu size={22} />
        </button>
        <h1 className="mobile-header-title">
          <div style={{
            width: 24, height: 24, borderRadius: 6,
            background: 'var(--gradient-accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginRight: 6, verticalAlign: 'middle'
          }}>
            <Wrench size={12} style={{ color: 'white' }} />
          </div>
          FFR Property OS
        </h1>
        <div className="sidebar-user-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{initials}</div>
      </div>

      {/* Mobile copilot search bar — always visible under header, contextual placeholders */}
      <div className="mobile-copilot-bar">
        <button className="mobile-copilot-trigger" onClick={() => setCopilotOpen(true)}>
          <Sparkles size={14} />
          <span className={`cph ${fadeClass}`}>{suggestions[placeholderIndex]}</span>
        </button>
      </div>

      {/* Mobile slide-out nav */}
      {mobileOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar sidebar-mobile ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--gradient-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0
            }}>
              <Wrench size={16} style={{ color: 'white' }} />
            </div>
            <div>
              <h1>FFR Property OS</h1>
              <span>Agentic Operations Hub</span>
            </div>
          </div>
          <button className="mobile-menu-btn" onClick={() => setMobileOpen(false)}><X size={20} /></button>
        </div>
        <nav className="sidebar-nav">{navLinks}</nav>
        {userFooter}
      </aside>

      <main className="main-content"><Outlet /></main>
      <CopilotPanel externalOpen={copilotOpen} onExternalClose={() => setCopilotOpen(false)} />
    </div>
  );
}

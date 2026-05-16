import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../App';
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  Bot,
  Building2,
  CalendarDays,
  CheckCircle,
  ClipboardList,
  Database,
  Inbox,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap
} from 'lucide-react';

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function countDrafts(summary) {
  return Number(summary?.counts?.email?.draft_replies || 0);
}

function desktopBridge() {
  return typeof window !== 'undefined' ? window.ffrDesktop : null;
}

function AttentionCard({ label, value, sub, tone = 'info', icon: Icon, to }) {
  const body = (
    <>
      <div className={`team-attention-icon ${tone}`}>{Icon ? <Icon size={18} /> : null}</div>
      <div className="team-attention-copy">
        <div className="team-attention-label">{label}</div>
        <div className="team-attention-value">{value}</div>
        <div className="team-attention-sub">{sub}</div>
      </div>
    </>
  );

  if (to) return <Link to={to} className={`team-attention ${tone}`}>{body}</Link>;
  return <div className={`team-attention ${tone}`}>{body}</div>;
}

function EmptyLine({ children = 'Nothing urgent here.' }) {
  return <div className="team-empty-line">{children}</div>;
}

export default function TeamHome() {
  const { user } = useAuth();
  const location = useLocation();
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const isDesktop = !!desktopBridge()?.isDesktop;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setToday(await api.getToday());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('calendar') === 'connected') setNotice('Google Calendar connected.');
    if (params.get('calendar') === 'error') setError(params.get('msg') || 'Google Calendar connection failed.');
  }, [location.search]);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.notify || !today) return;
    const critical = Number(today.desktop_notifications?.critical_count || 0);
    const reminders = Number(today.desktop_notifications?.reminder_count || 0);
    if (!critical && !reminders) return;

    const key = `ffr-desktop-notified-${new Date().toISOString().slice(0, 10)}-${critical}-${reminders}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    bridge.notify({
      title: critical ? 'FFR Property OS needs attention' : 'FFR Property OS reminders',
      body: critical ? `${critical} critical item${critical === 1 ? '' : 's'} need review.` : `${reminders} reminder${reminders === 1 ? '' : 's'} for today.`
    });
  }, [today]);

  const runAction = async (key, fn, success) => {
    setWorking(key);
    setNotice('');
    setError('');
    try {
      await fn();
      setNotice(success);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking('');
    }
  };

  const connectCalendar = async () => {
    setWorking('calendar');
    setError('');
    try {
      const { url } = await api.getGoogleCalendarAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err.message);
      setWorking('');
    }
  };

  const enableDesktopNotification = async () => {
    const bridge = desktopBridge();
    if (!bridge?.notify) return;
    await bridge.notify({ title: 'FFR Property OS', body: 'Desktop reminders are ready.' });
    setNotice('Desktop reminders enabled.');
  };

  const focus = today?.focus || [];
  const calendarEvents = today?.calendar?.events || [];
  const topIssues = today?.open_issues || [];
  const tasks = today?.tasks || [];
  const drafts = today?.email_drafts || [];
  const propertyPulse = today?.property_pulse || [];

  const name = useMemo(() => user?.name?.split(' ')[0] || 'team', [user]);

  if (loading && !today) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;
  }

  return (
    <div className="team-home fade-in">
      <div className="team-hero">
        <div>
          <div className="team-date">{formatDate(today?.date)}</div>
          <h2>{greeting()}, {name}</h2>
          <p>Today’s work across email, WhatsApp, maintenance, approvals, compliance and calendar.</p>
        </div>
        <div className="team-hero-actions">
          {isDesktop && <button className="btn btn-secondary" onClick={enableDesktopNotification}><Bell size={15} /> Desktop reminders</button>}
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {(notice || error) && (
        <div className={`team-notice ${error ? 'danger' : 'success'}`}>
          {error ? <AlertCircle size={15} /> : <CheckCircle size={15} />}
          {error || notice}
        </div>
      )}

      <div className="team-attention-grid">
        <AttentionCard
          label="Open Issues"
          value={today?.counts?.issues?.open || 0}
          sub={`${today?.counts?.issues?.urgent || 0} urgent, ${today?.counts?.issues?.today || 0} new today`}
          tone={(today?.counts?.issues?.urgent || today?.counts?.issues?.escalated) ? 'danger' : 'info'}
          icon={Wrench}
          to="/issues"
        />
        <AttentionCard
          label="Email Replies"
          value={countDrafts(today)}
          sub={`${today?.counts?.email?.needs_reply || 0} need reply`}
          tone={countDrafts(today) ? 'warning' : 'success'}
          icon={MailCheck}
          to="/email-agent"
        />
        <AttentionCard
          label="Approvals"
          value={today?.counts?.approvals?.pending || 0}
          sub={`${today?.counts?.approvals?.high_risk || 0} high risk`}
          tone={today?.counts?.approvals?.high_risk ? 'danger' : (today?.counts?.approvals?.pending ? 'warning' : 'success')}
          icon={Bot}
          to="/agents"
        />
        <AttentionCard
          label="Due Today"
          value={today?.counts?.tasks?.due_today || 0}
          sub={`${today?.counts?.tasks?.due_soon || 0} due this week`}
          tone={today?.counts?.tasks?.due_today ? 'warning' : 'info'}
          icon={ClipboardList}
          to="/agents"
        />
      </div>

      <div className="team-action-bar">
        <button className="btn btn-primary" disabled={working === 'email'} onClick={() => runAction('email', api.runEmailAgent, 'Email agent refreshed.')}>
          <MailCheck size={15} /> {working === 'email' ? 'Refreshing' : 'Run email agent'}
        </button>
        <Link className="btn btn-secondary" to="/intake"><Inbox size={15} /> WhatsApp intake</Link>
        <button className="btn btn-secondary" disabled={working === 'memory'} onClick={() => runAction('memory', api.snapshotBusinessMemory, 'Business Memory snapshot generated.')}>
          <Database size={15} /> {working === 'memory' ? 'Generating' : 'Refresh memory'}
        </button>
        <Link className="btn btn-secondary" to="/agents"><Sparkles size={15} /> Agent tasks</Link>
      </div>

      <div className="team-grid-main">
        <section className="card">
          <div className="card-header">
            <h3>Needs Attention</h3>
            <Link to="/agents" className="btn btn-ghost btn-sm">Review <ArrowUpRight size={12} /></Link>
          </div>
          <div className="card-body team-list">
            {focus.length === 0 ? <EmptyLine>Clear start. No critical signals right now.</EmptyLine> : focus.map((item, index) => (
              <Link key={`${item.title}-${index}`} to={item.href} className={`team-row ${item.tone}`}>
                <span className="team-row-dot" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Calendar & Reminders</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {today?.calendar?.connected
                ? <button className="btn btn-ghost btn-sm" disabled={working === 'sync-calendar'} onClick={() => runAction('sync-calendar', api.syncCalendars, 'Calendar synced.')}>
                    <RefreshCw size={12} /> Sync
                  </button>
                : user?.role === 'admin' ? <button className="btn btn-ghost btn-sm" disabled={working === 'calendar'} onClick={connectCalendar}>
                    <CalendarDays size={12} /> Connect
                  </button> : <span className="badge badge-open">Not connected</span>}
            </div>
          </div>
          <div className="card-body team-list">
            {calendarEvents.length === 0 ? <EmptyLine>No calendar events synced yet.</EmptyLine> : calendarEvents.map(event => (
              <div className="team-row neutral" key={event.id}>
                <CalendarDays size={15} />
                <span>
                  <strong>{event.summary || 'Calendar event'}</strong>
                  <small>{formatTime(event.start_at)}{event.location ? ` · ${event.location}` : ''}</small>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Email Drafts</h3>
            <Link to="/email-agent" className="btn btn-ghost btn-sm">Open <ArrowUpRight size={12} /></Link>
          </div>
          <div className="card-body team-list">
            {drafts.length === 0 ? <EmptyLine>No draft replies waiting.</EmptyLine> : drafts.map(draft => (
              <Link to="/email-agent" key={draft.id} className={`team-row ${draft.priority || 'neutral'}`}>
                <MailCheck size={15} />
                <span>
                  <strong>{draft.subject}</strong>
                  <small>{draft.to_address}{draft.summary ? ` · ${draft.summary}` : ''}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Priority Issues</h3>
            <Link to="/issues" className="btn btn-ghost btn-sm">Open <ArrowUpRight size={12} /></Link>
          </div>
          <div className="card-body team-list">
            {topIssues.length === 0 ? <EmptyLine>No open maintenance issues.</EmptyLine> : topIssues.map(issue => (
              <Link to={`/issues/${issue.id}`} key={issue.id} className={`team-row ${issue.priority || 'neutral'}`}>
                <Wrench size={15} />
                <span>
                  <strong>{issue.title}</strong>
                  <small>{issue.property_name || 'No property'}{issue.tenant_name ? ` · ${issue.tenant_name}` : ''}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="team-grid-secondary">
        <section className="card">
          <div className="card-header">
            <h3>Tasks</h3>
            <Link to="/agents" className="btn btn-ghost btn-sm">Manage <ArrowUpRight size={12} /></Link>
          </div>
          <div className="card-body team-list compact">
            {tasks.length === 0 ? <EmptyLine>No open agent tasks.</EmptyLine> : tasks.map(task => (
              <div key={task.id} className={`team-row ${task.priority || 'neutral'}`}>
                <ClipboardList size={15} />
                <span>
                  <strong>{task.title}</strong>
                  <small>{task.property_name || task.domain || 'operations'}{task.due_date ? ` · due ${task.due_date}` : ''}</small>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>WhatsApp & Intake</h3>
            <Link to="/intake" className="btn btn-ghost btn-sm">Open <ArrowUpRight size={12} /></Link>
          </div>
          <div className="card-body team-list compact">
            {(today?.intake || []).length === 0 ? <EmptyLine>No recent intake extractions.</EmptyLine> : today.intake.map(item => (
              <div key={item.id} className={`team-row ${item.priority || 'neutral'}`}>
                <Inbox size={15} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.sender || item.source_name || item.domain}</small>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Property Pulse</h3>
            <Link to="/properties" className="btn btn-ghost btn-sm">Open <ArrowUpRight size={12} /></Link>
          </div>
          <div className="card-body team-list compact">
            {propertyPulse.length === 0 ? <EmptyLine>No property records.</EmptyLine> : propertyPulse.map(property => (
              <Link to={`/properties/${property.id}`} key={property.id} className="team-row neutral">
                <Building2 size={15} />
                <span>
                  <strong>{property.name}</strong>
                  <small>{property.open_issues || 0} open issue{Number(property.open_issues) === 1 ? '' : 's'}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="team-tool-strip">
        <Link to="/compliance"><ShieldCheck size={16} /> Compliance</Link>
        <Link to="/utilities"><Zap size={16} /> Utilities</Link>
        <Link to="/contractors"><Wrench size={16} /> Contractors</Link>
        <Link to="/business-memory"><Database size={16} /> Business Memory</Link>
        <Link to="/dashboard"><AlertCircle size={16} /> Analytics Dashboard</Link>
      </div>
    </div>
  );
}

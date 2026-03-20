import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { AlertCircle, Clock, CheckCircle, AlertTriangle, Zap, TrendingUp, ShieldCheck, XCircle, ArrowUpRight, Activity, Timer, Bot, Flame, PoundSterling, Wallet, PieChart, CalendarRange, Image } from 'lucide-react';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

const statusColors = {
  open: { bg: 'rgba(99,102,241,0.12)', color: 'var(--accent-light)', dot: '#6366f1' },
  in_progress: { bg: 'rgba(251,191,36,0.12)', color: 'var(--warning)', dot: '#fbbf24' },
  escalated: { bg: 'rgba(248,113,113,0.12)', color: 'var(--danger)', dot: '#f87171' },
  resolved: { bg: 'rgba(52,211,153,0.12)', color: 'var(--success)', dot: '#34d399' },
  closed: { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', dot: '#94a3b8' },
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [sla, setSla] = useState(null);
  const [budgets, setBudgets] = useState(null);
  const [compliance, setCompliance] = useState(null);
  useEffect(() => {
    api.getIssueStats().then(setStats);
    api.getSlaMetrics().then(setSla).catch(() => {});
    api.getBudgets().then(setBudgets).catch(() => {});
    api.getComplianceSummary().then(setCompliance).catch(() => {});
  }, []);
  if (!stats) return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;

  const aiResRate = sla && (sla.total_resolved + sla.issues_needing_staff) > 0
    ? Math.round((sla.issues_resolved_by_ai / (sla.total_resolved + sla.issues_needing_staff)) * 100) : 0;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Overview of maintenance operations</p>
      </div>

      {/* Alert Banners */}
      {compliance && (compliance.expired > 0 || compliance.expiring_soon > 0) && (
        <div className="alert-banner" style={{
          background: compliance.expired > 0
            ? 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.03) 100%)'
            : 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.03) 100%)',
          border: `1px solid ${compliance.expired > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)'
        }}>
          {compliance.expired > 0
            ? <XCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />
            : <AlertTriangle size={18} style={{ color: '#f59e0b', flexShrink: 0 }} />}
          <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
            {compliance.expired > 0 && <strong>{compliance.expired} expired certificate{compliance.expired > 1 ? 's' : ''}</strong>}
            {compliance.expired > 0 && compliance.expiring_soon > 0 && ' and '}
            {compliance.expiring_soon > 0 && <span>{compliance.expiring_soon} certificate{compliance.expiring_soon > 1 ? 's' : ''} expiring within 30 days</span>}
          </span>
          <Link to="/compliance" className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
            View <ArrowUpRight size={12} />
          </Link>
        </div>
      )}

      {sla?.open_over_48h > 0 && (
        <div className="alert-banner" style={{
          background: 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.03) 100%)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)'
        }}>
          <Flame size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
            <strong>{sla.open_over_48h}</strong> issue{sla.open_over_48h > 1 ? 's' : ''} open for more than 48 hours
          </span>
          <Link to="/issues?status=open" className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
            View <ArrowUpRight size={12} />
          </Link>
        </div>
      )}

      {/* Main Stats Grid - More compact */}
      <div className="stats-grid" style={{ gap: 10, marginBottom: 12 }}>
        <div className="stat-card accent" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-card-label">Open Issues</div>
              <div className="stat-card-value">{stats.open}</div>
              <div className="stat-card-sub">{stats.today} reported today</div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle size={18} style={{ color: 'var(--accent-light)' }} />
            </div>
          </div>
        </div>

        <div className="stat-card warning" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-card-label">In Progress</div>
              <div className="stat-card-value">{stats.in_progress}</div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(251,191,36,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={18} style={{ color: 'var(--warning)' }} />
            </div>
          </div>
        </div>

        <div className="stat-card danger" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-card-label">Escalated</div>
              <div className="stat-card-value">{stats.escalated}</div>
              <div className="stat-card-sub">{stats.urgent} urgent</div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(248,113,113,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />
            </div>
          </div>
        </div>

        <div className="stat-card success" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-card-label">Resolved</div>
              <div className="stat-card-value">{stats.resolved}</div>
              <div className="stat-card-sub">{stats.this_week} this week</div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(52,211,153,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle size={18} style={{ color: 'var(--success)' }} />
            </div>
          </div>
        </div>

        <div className="stat-card" style={{ borderLeft: '3px solid #a855f7', padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-card-label">Est. Total Cost</div>
              <div className="stat-card-value">&pound;{(stats.total_estimated_cost || 0).toFixed(0)}</div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(168,85,247,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PoundSterling size={18} style={{ color: '#a855f7' }} />
            </div>
          </div>
        </div>

        <div className="stat-card" style={{ borderLeft: '3px solid #22d3ee', padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-card-label">Actual Spend</div>
              <div className="stat-card-value">&pound;{(stats.total_final_cost || 0).toFixed(0)}</div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(34,211,238,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wallet size={18} style={{ color: '#22d3ee' }} />
            </div>
          </div>
        </div>

        {budgets?.totals?.budget > 0 && (() => {
          const pct = Math.round((budgets.totals.spend / budgets.totals.budget) * 100);
          const c = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)';
          return (
            <div className="stat-card" style={{ borderLeft: `3px solid ${c}`, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="stat-card-label">Budget Used</div>
                  <div className="stat-card-value" style={{ color: c }}>{pct}%</div>
                  <div className="stat-card-sub">&pound;{budgets.totals.spend.toFixed(0)} / &pound;{budgets.totals.budget.toFixed(0)}</div>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PieChart size={18} style={{ color: c }} />
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Performance Metrics - side by side with Recent Issues */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* Performance Metrics */}
        {sla && (
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-header" style={{ padding: '12px 16px' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <Activity size={15} style={{ color: 'var(--accent-light)' }} />
                Performance Metrics
              </h3>
            </div>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                <div style={{
                  textAlign: 'center',
                  padding: '14px 8px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(99,102,241,0.06)',
                  border: '1px solid rgba(99,102,241,0.1)'
                }}>
                  <Timer size={16} style={{ color: 'var(--accent-light)', marginBottom: 6 }} />
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-light)', letterSpacing: '-0.03em' }}>
                    {sla.avg_first_response_mins < 1 ? '< 1' : Math.round(sla.avg_first_response_mins)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontWeight: 500 }}>min response</div>
                </div>

                <div style={{
                  textAlign: 'center',
                  padding: '14px 8px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(52,211,153,0.06)',
                  border: '1px solid rgba(52,211,153,0.1)'
                }}>
                  <CheckCircle size={16} style={{ color: 'var(--success)', marginBottom: 6 }} />
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--success)', letterSpacing: '-0.03em' }}>
                    {sla.avg_resolution_hours?.toFixed(1) || '0'}h
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontWeight: 500 }}>avg resolution</div>
                </div>

                <div style={{
                  textAlign: 'center',
                  padding: '14px 8px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(168,85,247,0.06)',
                  border: '1px solid rgba(168,85,247,0.1)'
                }}>
                  <Bot size={16} style={{ color: '#a855f7', marginBottom: 6 }} />
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#a855f7', letterSpacing: '-0.03em' }}>
                    {aiResRate}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontWeight: 500 }}>AI resolved</div>
                </div>

                <div style={{
                  textAlign: 'center',
                  padding: '14px 8px',
                  borderRadius: 'var(--radius-md)',
                  background: sla.open_over_48h > 0 ? 'rgba(248,113,113,0.06)' : 'rgba(52,211,153,0.06)',
                  border: `1px solid ${sla.open_over_48h > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(52,211,153,0.1)'}`
                }}>
                  <Flame size={16} style={{ color: sla.open_over_48h > 0 ? 'var(--danger)' : 'var(--success)', marginBottom: 6 }} />
                  <div style={{ fontSize: 24, fontWeight: 800, color: sla.open_over_48h > 0 ? 'var(--danger)' : 'var(--success)', letterSpacing: '-0.03em' }}>
                    {sla.open_over_48h}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontWeight: 500 }}>overdue (48h+)</div>
                </div>

                <div style={{
                  textAlign: 'center',
                  padding: '14px 8px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(251,191,36,0.06)',
                  border: '1px solid rgba(251,191,36,0.1)'
                }}>
                  <TrendingUp size={16} style={{ color: 'var(--warning)', marginBottom: 6 }} />
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--warning)', letterSpacing: '-0.03em' }}>
                    {sla.total_escalated}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontWeight: 500 }}>escalated</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recent Issues */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-header" style={{ padding: '12px 16px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <CalendarRange size={15} style={{ color: 'var(--accent-light)' }} />
              Recent Issues
            </h3>
            <Link to="/issues" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>
              View All <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="card-body" style={{ padding: '10px 16px' }}>
            {stats.recent_issues?.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {stats.recent_issues.map(issue => {
                  const sc = statusColors[issue.status] || statusColors.open;
                  return (
                    <Link
                      to={`/issues/${issue.id}`}
                      key={issue.id}
                      style={{
                        display: 'flex',
                        gap: 10,
                        padding: '10px 12px',
                        background: 'var(--bg-secondary)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-light)',
                        textDecoration: 'none',
                        color: 'inherit',
                        transition: 'border-color 0.2s, background 0.2s',
                        cursor: 'pointer',
                        alignItems: 'center',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-light)'; e.currentTarget.style.background = 'rgba(99,102,241,0.04)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                    >
                      {/* Thumbnail */}
                      <div style={{
                        width: 48, height: 48, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
                        background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {issue.thumbnail ? (
                          <img
                            src={issue.thumbnail}
                            alt=""
                            style={{ width: 48, height: 48, objectFit: 'cover', display: 'block' }}
                            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                          />
                        ) : null}
                        <div style={{
                          display: issue.thumbnail ? 'none' : 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          width: 48, height: 48
                        }}>
                          <Image size={18} style={{ opacity: 0.3 }} />
                        </div>
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          marginBottom: 3
                        }}>
                          {issue.title}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 11, padding: '1px 6px', borderRadius: 10,
                            background: sc.bg, color: sc.color, fontWeight: 500
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc.dot, display: 'inline-block' }} />
                            {(issue.status || '').replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeAgo(issue.created_at)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {issue.tenant_name}{issue.property_name ? ` \u00B7 ${issue.property_name}` : ''}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>No issues yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Category & Property Breakdown */}
      <div className="chart-grid-2">
        <div className="card">
          <div className="card-header"><h3>By Category</h3></div>
          <div className="card-body">
            {stats.by_category?.length ? stats.by_category.map((c, i) => {
              const maxCount = Math.max(...stats.by_category.map(x => x.count));
              const pct = maxCount > 0 ? (c.count / maxCount) * 100 : 0;
              return (
                <div key={c.category} style={{ marginBottom: i < stats.by_category.length - 1 ? 12 : 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, textTransform: 'capitalize', color: 'var(--text-primary)', fontWeight: 450 }}>
                      {(c.category || 'uncategorised').replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-light)' }}>{c.count}</span>
                  </div>
                  <div style={{ height: 6, background: 'rgba(99,102,241,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: 'var(--gradient-accent)',
                      borderRadius: 3,
                      transition: 'width 0.5s ease'
                    }} />
                  </div>
                </div>
              );
            }) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No active issues</p>}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>By Property</h3></div>
          <div className="card-body">
            {stats.by_property?.length ? stats.by_property.map((p, i) => {
              const maxCount = Math.max(...stats.by_property.map(x => x.count));
              const pct = maxCount > 0 ? (p.count / maxCount) * 100 : 0;
              return (
                <div key={p.name} style={{ marginBottom: i < stats.by_property.length - 1 ? 12 : 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 450 }}>
                      {p.name || 'Unassigned'}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>{p.count}</span>
                  </div>
                  <div style={{ height: 6, background: 'rgba(52,211,153,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: 'var(--gradient-success)',
                      borderRadius: 3,
                      transition: 'width 0.5s ease'
                    }} />
                  </div>
                </div>
              );
            }) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No active issues</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

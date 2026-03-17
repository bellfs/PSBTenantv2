import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { AlertCircle, Clock, CheckCircle, AlertTriangle, Zap, TrendingUp, ShieldCheck, XCircle, ArrowUpRight, Activity, Timer, Bot, Flame, PoundSterling, Wallet, PieChart } from 'lucide-react';

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
          padding: '14px 18px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
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
          padding: '14px 18px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
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

      {/* Main Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card accent">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
            <div>
              <div className="stat-card-label">Open Issues</div>
              <div className="stat-card-value">{stats.open}</div>
              <div className="stat-card-sub">{stats.today} reported today</div>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle size={20} style={{ color: 'var(--accent-light)' }} />
            </div>
          </div>
        </div>

        <div className="stat-card warning">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
            <div>
              <div className="stat-card-label">In Progress</div>
              <div className="stat-card-value">{stats.in_progress}</div>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(251,191,36,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={20} style={{ color: 'var(--warning)' }} />
            </div>
          </div>
        </div>

        <div className="stat-card danger">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
            <div>
              <div className="stat-card-label">Escalated</div>
              <div className="stat-card-value">{stats.escalated}</div>
              <div className="stat-card-sub">{stats.urgent} urgent</div>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(248,113,113,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={20} style={{ color: 'var(--danger)' }} />
            </div>
          </div>
        </div>

        <div className="stat-card success">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
            <div>
              <div className="stat-card-label">Resolved</div>
              <div className="stat-card-value">{stats.resolved}</div>
              <div className="stat-card-sub">{stats.this_week} this week</div>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(52,211,153,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle size={20} style={{ color: 'var(--success)' }} />
            </div>
          </div>
        </div>

        <div className="stat-card" style={{ borderLeft: '3px solid #a855f7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
            <div>
              <div className="stat-card-label">Est. Total Cost</div>
              <div className="stat-card-value">&pound;{(stats.total_estimated_cost || 0).toFixed(0)}</div>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(168,85,247,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PoundSterling size={20} style={{ color: '#a855f7' }} />
            </div>
          </div>
        </div>

        <div className="stat-card" style={{ borderLeft: '3px solid #22d3ee' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
            <div>
              <div className="stat-card-label">Actual Spend</div>
              <div className="stat-card-value">&pound;{(stats.total_final_cost || 0).toFixed(0)}</div>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(34,211,238,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wallet size={20} style={{ color: '#22d3ee' }} />
            </div>
          </div>
        </div>

        {budgets?.totals?.budget > 0 && (() => {
          const pct = Math.round((budgets.totals.spend / budgets.totals.budget) * 100);
          const c = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)';
          return (
            <div className="stat-card" style={{ borderLeft: `3px solid ${c}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
                <div>
                  <div className="stat-card-label">Budget Used</div>
                  <div className="stat-card-value" style={{ color: c }}>{pct}%</div>
                  <div className="stat-card-sub">&pound;{budgets.totals.spend.toFixed(0)} / &pound;{budgets.totals.budget.toFixed(0)}</div>
                </div>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PieChart size={20} style={{ color: c }} />
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Performance Metrics */}
      {sla && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={16} style={{ color: 'var(--accent-light)' }} />
              Performance Metrics
            </h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <div className="metric-tile" style={{
                textAlign: 'center',
                padding: '20px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(99,102,241,0.06)',
                border: '1px solid rgba(99,102,241,0.1)'
              }}>
                <Timer size={18} style={{ color: 'var(--accent-light)', marginBottom: 8 }} />
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-light)', letterSpacing: '-0.03em' }}>
                  {sla.avg_first_response_mins < 1 ? '< 1' : Math.round(sla.avg_first_response_mins)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontWeight: 500 }}>min response</div>
              </div>

              <div className="metric-tile" style={{
                textAlign: 'center',
                padding: '20px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(52,211,153,0.06)',
                border: '1px solid rgba(52,211,153,0.1)'
              }}>
                <CheckCircle size={18} style={{ color: 'var(--success)', marginBottom: 8 }} />
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--success)', letterSpacing: '-0.03em' }}>
                  {sla.avg_resolution_hours?.toFixed(1) || '0'}h
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontWeight: 500 }}>avg resolution</div>
              </div>

              <div className="metric-tile" style={{
                textAlign: 'center',
                padding: '20px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(168,85,247,0.06)',
                border: '1px solid rgba(168,85,247,0.1)'
              }}>
                <Bot size={18} style={{ color: '#a855f7', marginBottom: 8 }} />
                <div style={{ fontSize: 28, fontWeight: 800, color: '#a855f7', letterSpacing: '-0.03em' }}>
                  {aiResRate}%
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontWeight: 500 }}>AI resolved</div>
              </div>

              <div className="metric-tile" style={{
                textAlign: 'center',
                padding: '20px 12px',
                borderRadius: 'var(--radius-md)',
                background: sla.open_over_48h > 0 ? 'rgba(248,113,113,0.06)' : 'rgba(52,211,153,0.06)',
                border: `1px solid ${sla.open_over_48h > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(52,211,153,0.1)'}`
              }}>
                <Flame size={18} style={{ color: sla.open_over_48h > 0 ? 'var(--danger)' : 'var(--success)', marginBottom: 8 }} />
                <div style={{ fontSize: 28, fontWeight: 800, color: sla.open_over_48h > 0 ? 'var(--danger)' : 'var(--success)', letterSpacing: '-0.03em' }}>
                  {sla.open_over_48h}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontWeight: 500 }}>overdue (48h+)</div>
              </div>

              <div className="metric-tile" style={{
                textAlign: 'center',
                padding: '20px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(251,191,36,0.06)',
                border: '1px solid rgba(251,191,36,0.1)'
              }}>
                <TrendingUp size={18} style={{ color: 'var(--warning)', marginBottom: 8 }} />
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--warning)', letterSpacing: '-0.03em' }}>
                  {sla.total_escalated}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontWeight: 500 }}>escalated</div>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Recent Escalations */}
      {stats.recent_escalations?.length > 0 && (
        <div className="card" style={{ marginTop: 4 }}>
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />
              Recent Escalations
            </h3>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Ref</th><th>Issue</th><th>Tenant</th><th>Property</th><th>When</th></tr>
              </thead>
              <tbody>
                {stats.recent_escalations.map(i => (
                  <tr key={i.id}>
                    <td><Link to={`/issues/${i.id}`} className="issue-ref">{i.uuid}</Link></td>
                    <td>{i.title}</td>
                    <td>{i.tenant_name}</td>
                    <td>{i.property_name}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {i.escalated_at ? new Date(i.escalated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { Activity, AlertTriangle, ArrowUpRight, Bot, Building2, CheckCircle, CircleDashed, Layers3, Lightbulb, ShieldCheck, Workflow, Zap } from 'lucide-react';

const statusTone = {
  live: { color: 'var(--success)', label: 'Live' },
  partial: { color: 'var(--warning)', label: 'Partial' },
  'codex-ready': { color: 'var(--accent-light)', label: 'Codex ready' },
  'codex-missing': { color: 'var(--danger)', label: 'Codex missing' },
};

const severityTone = {
  high: 'badge-urgent',
  medium: 'badge-medium',
  low: 'badge-low',
};

export default function OSOverview() {
  const [data, setData] = useState(null);
  useEffect(() => { api.getOSOverview().then(setData); }, []);

  if (!data) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;
  }

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h2>{data.name}</h2>
          <p>{data.subtitle}</p>
        </div>
        <Link to="/agents" className="btn btn-primary">
          <Bot size={15} /> Agents <ArrowUpRight size={13} />
        </Link>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card accent">
          <div className="stat-card-label">Codex</div>
          <div className="stat-card-value" style={{ fontSize: 24 }}>{data.codex.available ? 'Ready' : 'Missing'}</div>
          <div className="stat-card-sub">{data.codex.mode} · {data.codex.sandbox}</div>
        </div>
        <div className="stat-card success">
          <div className="stat-card-label">Open Tasks</div>
          <div className="stat-card-value">{data.task_summary.open}</div>
          <div className="stat-card-sub">{data.task_summary.urgent} urgent</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-card-label">Due Soon</div>
          <div className="stat-card-value">{data.task_summary.due_soon}</div>
          <div className="stat-card-sub">next 7 days</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '3px solid #a855f7' }}>
          <div className="stat-card-label">Approvals</div>
          <div className="stat-card-value">{data.task_summary.pending_approvals}</div>
          <div className="stat-card-sub">pending human review</div>
        </div>
      </div>

      {data.senior_review && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Lightbulb size={15} /> Senior Product Review</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>{data.senior_review.verdict}</p>
            </div>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 16 }}>
            <div className="chart-grid-2" style={{ marginBottom: 0 }}>
              <div>
                <div className="stat-card-label" style={{ marginBottom: 8 }}>Simplifications</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {data.senior_review.simplifications.map(item => (
                    <div key={item} className="team-row neutral" style={{ minHeight: 44 }}>
                      <Layers3 size={14} />
                      <span><strong>{item}</strong></span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="stat-card-label" style={{ marginBottom: 8 }}>Operating Principles</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {data.senior_review.operating_principles.map(item => (
                    <div key={item} className="team-row neutral" style={{ minHeight: 44 }}>
                      <ShieldCheck size={14} />
                      <span><strong>{item}</strong></span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="stat-card-label" style={{ marginBottom: 8 }}>Build Roadmap</div>
              <div className="team-lanes">
                {data.senior_review.feature_priorities.map(item => (
                  <div key={`${item.horizon}-${item.title}`} className="team-lane">
                    <div className="team-lane-top">
                      <strong>{item.title}</strong>
                      <span style={{ fontSize: 11 }}>{item.horizon}</span>
                    </div>
                    <p>{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            {data.senior_review.current_constraints.length > 0 && (
              <div>
                <div className="stat-card-label" style={{ marginBottom: 8 }}>Constraints</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {data.senior_review.current_constraints.map(item => (
                    <div key={item} className="team-row warning" style={{ minHeight: 44 }}>
                      <AlertTriangle size={14} />
                      <span><strong>{item}</strong></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="chart-grid-2">
        <div className="card">
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Building2 size={15} /> Operating Modules</h3>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            {data.modules.map(module => {
              const tone = statusTone[module.status] || { color: 'var(--text-secondary)', label: module.status };
              return (
                <div key={module.key} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 10,
                  padding: 14,
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.025)'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{module.name}</span>
                      <span className="badge" style={{ color: tone.color, borderColor: `${tone.color}33`, background: `${tone.color}16` }}>{tone.label}</span>
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>{module.detail}</p>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', textAlign: 'right' }}>{module.count}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={15} /> Risk Signals</h3>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            {data.risk_signals.map(signal => (
              <div key={signal.title} style={{ padding: 14, borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.025)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>{signal.title}</strong>
                  <span className={`badge ${severityTone[signal.severity] || 'badge-medium'}`}>{signal.severity}</span>
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>{signal.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Workflow size={15} /> Operating Lanes</h3>
        </div>
        <div className="table-container">
          <table>
            <thead><tr><th>Lane</th><th>Agents</th><th>Next Build Step</th></tr></thead>
            <tbody>
              {data.lanes.map(lane => (
                <tr key={lane.name}>
                  <td style={{ fontWeight: 700 }}>{lane.name}</td>
                  <td>{lane.agents.map(agent => <span key={agent} className="badge badge-open" style={{ marginRight: 6 }}>{agent.replace(/_/g, ' ')}</span>)}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{lane.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="chart-grid-3">
        <div className="card">
          <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <ShieldCheck size={22} style={{ color: 'var(--success)' }} />
            <div><strong>Approval Layer</strong><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>payments, legal, access, pricing</div></div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Zap size={22} style={{ color: 'var(--warning)' }} />
            <div><strong>Dry Run Default</strong><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Codex actions are previewed first</div></div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {data.codex.available ? <CheckCircle size={22} style={{ color: 'var(--success)' }} /> : <CircleDashed size={22} style={{ color: 'var(--danger)' }} />}
            <div><strong>{data.codex.version || 'Codex unavailable'}</strong><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>local agent runtime</div></div>
          </div>
        </div>
      </div>

      {data.recent_events.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Activity size={15} /> Recent Events</h3></div>
          <div className="table-container">
            <table>
              <thead><tr><th>Event</th><th>Domain</th><th>Source</th><th>Actor</th><th>Created</th></tr></thead>
              <tbody>{data.recent_events.map(event => (
                <tr key={event.id}><td>{event.event_type.replace(/_/g, ' ')}</td><td>{event.domain}</td><td>{event.source}</td><td>{event.actor}</td><td>{event.created_at}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

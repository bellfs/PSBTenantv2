import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { Bot, CheckCircle, Clock, Play, ShieldAlert, Sparkles, XCircle } from 'lucide-react';

const domainColor = {
  operations: '#60a5fa',
  maintenance: '#f59e0b',
  compliance: '#34d399',
  leasing: '#a855f7',
  turnaround: '#fb923c',
  contractors: '#22d3ee',
  finance: '#f87171',
  utilities: '#14b8a6',
  short_lets: '#c084fc',
  development: '#818cf8',
};

const riskBadge = {
  low: 'badge-low',
  medium: 'badge-medium',
  high: 'badge-urgent',
};

function RunPanel({ agent, onRunComplete }) {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const response = await api.runAgent(agent.key, {
        mode: 'dry_run',
        trigger_type: 'manual',
        input: { request: input || `Run a ${agent.name} operating check.` },
        context: { source: 'agent_console' }
      });
      setResult(response.result);
      onRunComplete?.();
    } catch (error) {
      setResult({ status: 'failed', output: error.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={3}
        placeholder={`Ask ${agent.name} to review a specific property, issue, supplier, booking, or decision...`}
        style={{
          width: '100%',
          resize: 'vertical',
          minHeight: 82,
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          color: 'var(--text-primary)',
          padding: 12,
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          lineHeight: 1.5
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Dry run · Codex read-only</span>
        <button className="btn btn-primary btn-sm" onClick={run} disabled={running}>
          {running ? <Clock size={14} /> : <Play size={14} />} {running ? 'Preparing' : 'Preview Run'}
        </button>
      </div>
      {result && (
        <div style={{
          border: '1px solid rgba(255,255,255,0.06)',
          background: result.status === 'failed' ? 'var(--danger-subtle)' : 'rgba(255,255,255,0.025)',
          borderRadius: 10,
          padding: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {result.status === 'failed' ? <XCircle size={15} style={{ color: 'var(--danger)' }} /> : <CheckCircle size={15} style={{ color: 'var(--success)' }} />}
            <strong style={{ fontSize: 13 }}>{result.status.replace(/_/g, ' ')}</strong>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>{result.output}</p>
        </div>
      )}
    </div>
  );
}

export default function Agents() {
  const [data, setData] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);

  const load = () => {
    api.getAgents().then((res) => {
      setData(res);
      setSelectedKey(current => current || res.agents?.[0]?.key || null);
    });
    api.getAgentTasks({ status: 'open' }).then(setTasks).catch(() => {});
    api.getAgentRuns(20).then(setRuns).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const selected = useMemo(() => data?.agents?.find(agent => agent.key === selectedKey), [data, selectedKey]);

  if (!data) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;
  }

  const groupedTasks = tasks.reduce((acc, task) => {
    acc[task.domain] = (acc[task.domain] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h2>Agents</h2>
          <p>Codex-backed operators for FFR Property OS</p>
        </div>
        <div className="badge badge-open" style={{ padding: '8px 10px' }}>
          <Sparkles size={13} /> {data.codex.mode} · {data.codex.sandbox}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card accent"><div className="stat-card-label">Agents</div><div className="stat-card-value">{data.agents.length}</div></div>
        <div className="stat-card success"><div className="stat-card-label">Open Tasks</div><div className="stat-card-value">{tasks.length}</div></div>
        <div className="stat-card warning"><div className="stat-card-label">Recent Runs</div><div className="stat-card-value">{runs.length}</div></div>
        <div className="stat-card" style={{ borderLeft: '3px solid #22d3ee' }}><div className="stat-card-label">Domains</div><div className="stat-card-value">{Object.keys(groupedTasks).length}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }} className="agents-layout-grid">
        <div className="card">
          <div className="card-header"><h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bot size={15} /> Registry</h3></div>
          <div className="card-body" style={{ display: 'grid', gap: 8 }}>
            {data.agents.map(agent => {
              const active = agent.key === selectedKey;
              return (
                <button
                  key={agent.key}
                  onClick={() => setSelectedKey(agent.key)}
                  style={{
                    textAlign: 'left',
                    border: `1px solid ${active ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.06)'}`,
                    background: active ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.025)',
                    borderRadius: 10,
                    padding: 12,
                    color: 'var(--text-primary)',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <strong style={{ fontSize: 13 }}>{agent.name}</strong>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: domainColor[agent.domain] || 'var(--accent-light)', marginTop: 5, flexShrink: 0 }} />
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'capitalize' }}>{agent.domain.replace(/_/g, ' ')} · {agent.mode.replace(/_/g, ' ')}</div>
                </button>
              );
            })}
          </div>
        </div>

        {selected && (
          <div className="card">
            <div className="card-header" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bot size={15} /> {selected.name}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>{selected.description}</p>
              </div>
              <span className={`badge ${riskBadge[selected.risk_level] || 'badge-medium'}`}><ShieldAlert size={12} /> {selected.risk_level}</span>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: 18 }}>
              <div className="chart-grid-2" style={{ marginBottom: 0 }}>
                <div>
                  <div className="stat-card-label" style={{ marginBottom: 8 }}>Triggers</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {selected.triggers.map(trigger => <span key={trigger} className="badge badge-open">{trigger}</span>)}
                  </div>
                </div>
                <div>
                  <div className="stat-card-label" style={{ marginBottom: 8 }}>Guardrails</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {selected.guardrails.map(guardrail => <span key={guardrail} className="badge badge-medium">{guardrail}</span>)}
                  </div>
                </div>
              </div>
              <RunPanel agent={selected} onRunComplete={load} />
            </div>
          </div>
        )}
      </div>

      <div className="chart-grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-header"><h3>Open Agent Tasks</h3></div>
          {tasks.length === 0 ? (
            <div className="empty-state"><Bot /><h3>No open tasks</h3><p>Agent tasks will appear here as workflows are connected.</p></div>
          ) : (
            <div className="table-container"><table><thead><tr><th>Task</th><th>Domain</th><th>Priority</th><th>Due</th></tr></thead><tbody>
              {tasks.slice(0, 8).map(task => (
                <tr key={task.id}>
                  <td style={{ fontWeight: 600 }}>{task.title}</td>
                  <td>{task.domain}</td>
                  <td><span className={`badge badge-${task.priority}`}>{task.priority}</span></td>
                  <td>{task.due_date || ''}</td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </div>

        <div className="card">
          <div className="card-header"><h3>Recent Runs</h3></div>
          {runs.length === 0 ? (
            <div className="empty-state"><Bot /><h3>No runs yet</h3><p>Dry-run previews are logged here.</p></div>
          ) : (
            <div className="table-container"><table><thead><tr><th>Agent</th><th>Status</th><th>Mode</th><th>Created</th></tr></thead><tbody>
              {runs.map(run => (
                <tr key={run.id}>
                  <td style={{ fontWeight: 600 }}>{run.agent_name}</td>
                  <td><span className={`badge ${run.status === 'completed' ? 'badge-resolved' : run.status === 'failed' ? 'badge-escalated' : 'badge-open'}`}>{run.status.replace(/_/g, ' ')}</span></td>
                  <td>{run.mode}</td>
                  <td>{run.created_at}</td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </div>
      </div>
    </div>
  );
}

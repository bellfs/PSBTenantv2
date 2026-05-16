import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { AlertTriangle, Bot, CheckCircle, FileText, Inbox, Play, Upload } from 'lucide-react';

const riskBadge = {
  high: 'badge-urgent',
  medium: 'badge-medium',
  low: 'badge-low',
};

export default function Intake() {
  const [summary, setSummary] = useState(null);
  const [extractions, setExtractions] = useState([]);
  const [sourceName, setSourceName] = useState('team_whatsapp_export');
  const [text, setText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [agentRun, setAgentRun] = useState(null);

  const load = () => {
    api.getIntakeSummary().then(setSummary).catch(() => {});
    api.getIntakeExtractions(80).then(setExtractions).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const processExport = async () => {
    setProcessing(true);
    setResult(null);
    try {
      const response = await api.processWhatsAppExport({ text, source_name: sourceName });
      setResult(response);
      setText('');
      load();
    } catch (error) {
      setResult({ error: error.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSourceName(file.name.replace(/\.txt$/i, '') || 'team_whatsapp_export');
    setText(await file.text());
  };

  const runSuggestedAgent = async (extraction) => {
    setAgentRun({ loading: true, extraction_id: extraction.id });
    try {
      const response = await api.runAgent(extraction.agent_key, {
        mode: 'dry_run',
        trigger_type: 'intake_suggestion',
        input: {
          request: extraction.summary,
          title: extraction.title,
          priority: extraction.priority
        },
        context: {
          source: 'intake',
          intake_item_id: extraction.intake_item_id,
          extraction_id: extraction.id,
          sender: extraction.sender,
          occurred_at: extraction.occurred_at,
          domain: extraction.domain
        }
      });
      setAgentRun({ loading: false, extraction_id: extraction.id, result: response.result });
      load();
    } catch (error) {
      setAgentRun({ loading: false, extraction_id: extraction.id, error: error.message });
    }
  };

  const visibleExtractions = useMemo(() => extractions.filter(e => e.extraction_type !== 'context').slice(0, 40), [extractions]);

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2>Intake</h2>
        <p>Turn WhatsApp exports, forwards and future connectors into tasks, approvals and agent triggers.</p>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card accent"><div className="stat-card-label">Messages Processed</div><div className="stat-card-value">{summary?.total_items || 0}</div></div>
        <div className="stat-card success"><div className="stat-card-label">Tasks Extracted</div><div className="stat-card-value">{summary?.extracted_tasks || 0}</div></div>
        <div className="stat-card warning"><div className="stat-card-label">Approvals</div><div className="stat-card-value">{summary?.pending_approvals || 0}</div></div>
        <div className="stat-card" style={{ borderLeft: '3px solid #22d3ee' }}><div className="stat-card-label">Suggested Agents</div><div className="stat-card-value">{summary?.by_agent?.length || 0}</div></div>
      </div>

      <div className="chart-grid-2">
        <div className="card">
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Upload size={15} /> WhatsApp Export Import</h3>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
              <input
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="Source name"
                style={{
                  background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
                  borderRadius: 10, padding: '10px 12px', fontSize: 13
                }}
              />
              <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                <FileText size={14} /> Choose .txt
                <input type="file" accept=".txt,text/plain" onChange={handleFile} style={{ display: 'none' }} />
              </label>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="[15/05/2026, 12:41:27] Team Member: Please can someone chase this invoice..."
              style={{
                width: '100%',
                resize: 'vertical',
                minHeight: 220,
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                color: 'var(--text-primary)',
                padding: 12,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.5
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Creates tasks and approval prompts. It does not send messages.</span>
              <button className="btn btn-primary" disabled={!text || processing} onClick={processExport}>
                {processing ? <Inbox size={15} /> : <Upload size={15} />} {processing ? 'Processing' : 'Process Export'}
              </button>
            </div>
            {result && (
              <div style={{
                border: `1px solid ${result.error ? 'rgba(248,113,113,0.25)' : 'rgba(52,211,153,0.2)'}`,
                background: result.error ? 'var(--danger-subtle)' : 'var(--success-subtle)',
                borderRadius: 10,
                padding: 12,
                color: 'var(--text-primary)',
                fontSize: 13
              }}>
                {result.error ? (
                  <><AlertTriangle size={14} /> {result.error}</>
                ) : (
                  <>Imported {result.imported_messages} messages, created {result.created_tasks} tasks and {result.created_approvals} approval prompts.</>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Agent Mix</h3></div>
          <div className="card-body" style={{ display: 'grid', gap: 14 }}>
            {(summary?.by_agent || []).length === 0 ? (
              <div className="empty-state" style={{ padding: 30 }}><Bot /><h3>No intake yet</h3><p>Import an export to see suggested agents.</p></div>
            ) : (
              summary.by_agent.map(row => (
                <div key={row.agent_key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <strong style={{ fontSize: 13 }}>{row.agent_key.replace(/_/g, ' ')}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{row.count}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, row.count * 8)}%`, background: 'var(--gradient-accent)' }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Extracted Tasks & Agent Triggers</h3></div>
        {visibleExtractions.length === 0 ? (
          <div className="empty-state"><Inbox /><h3>No extracted tasks</h3><p>Actionable messages will appear here after import.</p></div>
        ) : (
          <div className="table-container">
            <table>
              <thead><tr><th>Task</th><th>Domain</th><th>Priority</th><th>Risk</th><th>Agent</th><th>Action</th></tr></thead>
              <tbody>
                {visibleExtractions.map(extraction => {
                  const activeRun = agentRun?.extraction_id === extraction.id ? agentRun : null;
                  return (
                    <tr key={extraction.id}>
                      <td>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{extraction.title}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{extraction.occurred_at || ''}</div>
                        {activeRun?.result && <div style={{ color: 'var(--success)', fontSize: 12, marginTop: 6 }}><CheckCircle size={12} /> {activeRun.result.status.replace(/_/g, ' ')}</div>}
                        {activeRun?.error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{activeRun.error}</div>}
                      </td>
                      <td>{extraction.domain}</td>
                      <td><span className={`badge badge-${extraction.priority}`}>{extraction.priority}</span></td>
                      <td><span className={`badge ${riskBadge[extraction.risk_level] || 'badge-medium'}`}>{extraction.risk_level}</span></td>
                      <td>{extraction.agent_key?.replace(/_/g, ' ')}</td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => runSuggestedAgent(extraction)} disabled={activeRun?.loading || !extraction.agent_key}>
                          <Play size={13} /> {activeRun?.loading ? 'Running' : 'Preview Agent'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

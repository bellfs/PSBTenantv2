import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { CheckCircle, Clock, FileText, MailCheck, Play, RefreshCw, Send, ShieldAlert } from 'lucide-react';

const statusBadge = {
  draft: 'badge-medium',
  approved: 'badge-open',
  sent: 'badge-resolved',
  failed: 'badge-urgent'
};

function Stat({ label, value, tone = 'accent' }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value ?? 0}</div>
    </div>
  );
}

export default function EmailAgent() {
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [reports, setReports] = useState([]);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [dailyReport, setDailyReport] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const [summaryRes, itemsRes, draftsRes, reportsRes] = await Promise.all([
      api.getEmailAgentSummary(),
      api.getEmailAgentItems(50),
      api.getEmailAgentDrafts('all', 50),
      api.getEmailAgentReports(10)
    ]);
    setSummary(summaryRes);
    setItems(itemsRes);
    setDrafts(draftsRes);
    setReports(reportsRes);
    setSelectedDraft(current => current || draftsRes.find(d => d.status !== 'sent') || draftsRes[0] || null);
  };

  useEffect(() => {
    load().catch(err => setError(err.message));
  }, []);

  const draftCounts = useMemo(() => {
    return drafts.reduce((acc, draft) => {
      acc[draft.status] = (acc[draft.status] || 0) + 1;
      return acc;
    }, {});
  }, [drafts]);

  const runAgent = async () => {
    setLoading('run');
    setError('');
    try {
      await api.runEmailAgent();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading('');
    }
  };

  const previewReport = async () => {
    setLoading('report');
    setError('');
    try {
      const report = await api.previewEmailDailyReport();
      setDailyReport(report);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading('');
    }
  };

  const sendReport = async () => {
    if (!window.confirm('Send today\'s email brief to the team recipients?')) return;
    setLoading('send-report');
    setError('');
    try {
      const result = await api.sendEmailDailyReport(dailyReport?.report_date);
      setDailyReport(result.report);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading('');
    }
  };

  const saveDraft = async () => {
    if (!selectedDraft) return;
    setLoading(`save-${selectedDraft.id}`);
    setError('');
    try {
      const updated = await api.updateEmailAgentDraft(selectedDraft.id, {
        subject: selectedDraft.subject,
        body_text: selectedDraft.body_text,
        status: selectedDraft.status
      });
      setSelectedDraft(updated);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading('');
    }
  };

  const approveDraft = async () => {
    if (!selectedDraft) return;
    setLoading(`approve-${selectedDraft.id}`);
    setError('');
    try {
      const approved = await api.approveEmailAgentDraft(selectedDraft.id);
      setSelectedDraft(approved);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading('');
    }
  };

  const sendDraft = async () => {
    if (!selectedDraft || !window.confirm(`Send this reply to ${selectedDraft.to_address}?`)) return;
    setLoading(`send-${selectedDraft.id}`);
    setError('');
    try {
      await api.sendEmailAgentDraft(selectedDraft.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading('');
    }
  };

  if (!summary) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;
  }

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div>
          <h2>Email Agent</h2>
          <p>admin@52oldelvet.com inbox, reply drafts, reminders and team brief</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={runAgent} disabled={loading === 'run'}>
            {loading === 'run' ? <Clock size={14} /> : <Play size={14} />} Sync & Analyse
          </button>
        </div>
      </div>

      {error && <div className="alert-banner" style={{ marginBottom: 14, color: 'var(--danger)' }}>{error}</div>}

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <Stat label="Inbox Items" value={summary.totals?.items || 0} />
        <Stat label="Today" value={summary.totals?.today || 0} tone="success" />
        <Stat label="Needs Reply" value={summary.totals?.needs_reply || 0} tone="warning" />
        <Stat label="Follow-Ups" value={summary.totals?.needs_followup || 0} />
        <Stat label="Drafts" value={draftCounts.draft || 0} tone="warning" />
        <Stat label="Approved" value={draftCounts.approved || 0} tone="success" />
      </div>

      <div className="chart-grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><MailCheck size={15} /> Reply Drafts</h3>
          </div>
          {drafts.length === 0 ? (
            <div className="empty-state"><MailCheck /><h3>No drafts</h3><p>New inbox items will create reply drafts when a response is likely needed.</p></div>
          ) : (
            <div className="table-container">
              <table>
                <thead><tr><th>To</th><th>Subject</th><th>Status</th></tr></thead>
                <tbody>
                  {drafts.slice(0, 12).map(draft => (
                    <tr key={draft.id} onClick={() => setSelectedDraft(draft)} style={{ cursor: 'pointer', background: selectedDraft?.id === draft.id ? 'rgba(99,102,241,0.08)' : undefined }}>
                      <td style={{ fontWeight: 600 }}>{draft.to_address}</td>
                      <td>{draft.subject}</td>
                      <td><span className={`badge ${statusBadge[draft.status] || 'badge-medium'}`}>{draft.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileText size={15} /> Draft Review</h3>
            {selectedDraft && <span className={`badge ${statusBadge[selectedDraft.status] || 'badge-medium'}`}>{selectedDraft.status}</span>}
          </div>
          {!selectedDraft ? (
            <div className="empty-state"><FileText /><h3>No draft selected</h3><p>Select a draft to review it.</p></div>
          ) : (
            <div className="card-body" style={{ display: 'grid', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">To</label>
                <input className="form-input" value={selectedDraft.to_address} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input className="form-input" value={selectedDraft.subject} onChange={e => setSelectedDraft(d => ({ ...d, subject: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Body</label>
                <textarea
                  className="form-input"
                  rows={10}
                  value={selectedDraft.body_text}
                  onChange={e => setSelectedDraft(d => ({ ...d, body_text: e.target.value }))}
                  style={{ resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={saveDraft} disabled={loading === `save-${selectedDraft.id}`}><FileText size={14} /> Save</button>
                <button className="btn btn-primary btn-sm" onClick={approveDraft} disabled={selectedDraft.status === 'approved' || selectedDraft.status === 'sent' || loading === `approve-${selectedDraft.id}`}><CheckCircle size={14} /> Approve</button>
                <button className="btn btn-primary btn-sm" onClick={sendDraft} disabled={selectedDraft.status !== 'approved' || loading === `send-${selectedDraft.id}`}><Send size={14} /> Send</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="chart-grid-2" style={{ alignItems: 'start', marginTop: 16 }}>
        <div className="card">
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ShieldAlert size={15} /> Recent Email Items</h3>
          </div>
          {items.length === 0 ? (
            <div className="empty-state"><ShieldAlert /><h3>No items yet</h3><p>Run the agent after connecting admin@52oldelvet.com in Settings.</p></div>
          ) : (
            <div className="table-container">
              <table>
                <thead><tr><th>Email</th><th>Domain</th><th>Priority</th><th>Owner</th></tr></thead>
                <tbody>
                  {items.slice(0, 12).map(item => (
                    <tr key={item.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.subject || item.from_address}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{item.from_address}</div>
                      </td>
                      <td>{item.domain?.replace(/_/g, ' ')}</td>
                      <td><span className={`badge badge-${item.priority}`}>{item.priority}</span></td>
                      <td>{item.suggested_owner}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileText size={15} /> Daily Team Brief</h3>
            {summary.latest_report && <span className={`badge ${statusBadge[summary.latest_report.status] || 'badge-medium'}`}>{summary.latest_report.status}</span>}
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={previewReport} disabled={loading === 'report'}><FileText size={14} /> Preview Today</button>
              <button className="btn btn-primary btn-sm" onClick={sendReport} disabled={loading === 'send-report'}><Send size={14} /> Send Brief</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {summary.team_recipients?.map(email => <span key={email} className="badge badge-open">{email}</span>)}
            </div>
            {(dailyReport || summary.latest_report) && (
              <pre style={{
                whiteSpace: 'pre-wrap',
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 10,
                padding: 12,
                color: 'var(--text-secondary)',
                fontSize: 12,
                lineHeight: 1.5,
                maxHeight: 360,
                overflow: 'auto'
              }}>{(dailyReport || summary.latest_report).body_text}</pre>
            )}
            {reports.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                {reports.slice(0, 5).map(report => (
                  <div key={report.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span>{report.report_date}</span>
                    <span className={`badge ${statusBadge[report.status] || 'badge-medium'}`}>{report.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

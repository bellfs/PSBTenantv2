import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { AlertTriangle, CheckCircle, Database, FileText, FolderTree, RefreshCw, Search } from 'lucide-react';

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB');
}

function fileLabel(path) {
  return path.split('/').pop();
}

function kindForPath(path) {
  if (path === 'INDEX.json') return 'Index';
  if (path === 'AGENTS.md') return 'Agent Rules';
  if (path.startsWith('wiki/context')) return 'Context';
  if (path.startsWith('wiki/entities/properties')) return 'Property';
  if (path.startsWith('wiki/entities/tenants')) return 'Tenant';
  if (path.startsWith('wiki/entities/contractors')) return 'Contractor';
  if (path.startsWith('wiki/operations/issues')) return 'Issue';
  if (path.startsWith('wiki/operations')) return 'Operations';
  if (path.startsWith('wiki/comms')) return 'Comms';
  if (path.startsWith('raw')) return 'Raw Map';
  if (path.startsWith('agents')) return 'Agent Log';
  if (path.startsWith('daily')) return 'Daily';
  if (path.startsWith('notes')) return 'Notes';
  return 'Memory';
}

export default function BusinessMemory() {
  const [summary, setSummary] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [preview, setPreview] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadFile = async (path) => {
    if (!path) return;
    setSelectedPath(path);
    try {
      setPreview(await api.getBusinessMemoryFile(path));
    } catch (err) {
      setPreview({ path, content: err.message, error: true });
    }
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryRes, filesRes] = await Promise.all([
        api.getBusinessMemorySummary(),
        api.getBusinessMemoryFiles()
      ]);
      setSummary(summaryRes);
      setFiles(filesRes);
      const defaultFile = filesRes.find(file => file.path === 'wiki/index.md')
        || filesRes.find(file => file.path === 'README.md')
        || filesRes[0];
      if (defaultFile) await loadFile(selectedPath || defaultFile.path);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const generate = async () => {
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const result = await api.snapshotBusinessMemory();
      setNotice(`Snapshot complete: ${result.file_count} files, ${formatBytes(result.bytes_written)}.`);
      setSelectedPath('wiki/index.md');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files;
    return files.filter(file => file.path.toLowerCase().includes(needle));
  }, [files, query]);

  const sourceRows = useMemo(() => {
    return (summary?.source_counts || []).filter(row => row.count > 0).sort((a, b) => b.count - a.count);
  }, [summary]);

  if (loading && !summary) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;
  }

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h2>Business Memory</h2>
          <p>Generated Markdown, JSON and deep operating context for Codex-backed property operations.</p>
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={generating}>
          <RefreshCw size={15} className={generating ? 'spin' : ''} /> {generating ? 'Generating' : 'Generate Snapshot'}
        </button>
      </div>

      {(error || notice) && (
        <div style={{
          marginBottom: 16,
          border: `1px solid ${error ? 'rgba(248,113,113,0.25)' : 'rgba(52,211,153,0.25)'}`,
          background: error ? 'var(--danger-subtle)' : 'var(--success-subtle)',
          borderRadius: 10,
          padding: 12,
          color: 'var(--text-primary)',
          fontSize: 13,
          display: 'flex',
          gap: 8,
          alignItems: 'center'
        }}>
          {error ? <AlertTriangle size={15} style={{ color: 'var(--danger)' }} /> : <CheckCircle size={15} style={{ color: 'var(--success)' }} />}
          {error || notice}
        </div>
      )}

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card accent"><div className="stat-card-label">Memory Files</div><div className="stat-card-value">{summary?.file_count || 0}</div><div className="stat-card-sub">{formatBytes(summary?.bytes)}</div></div>
        <div className="stat-card success"><div className="stat-card-label">Source Rows</div><div className="stat-card-value">{(summary?.source_counts || []).reduce((sum, row) => sum + Number(row.count || 0), 0)}</div><div className="stat-card-sub">SQLite-backed</div></div>
        <div className="stat-card warning"><div className="stat-card-label">Intake Items</div><div className="stat-card-value">{summary?.intake_items || 0}</div><div className="stat-card-sub">WhatsApp and imports</div></div>
        <div className="stat-card" style={{ borderLeft: '3px solid #22d3ee' }}><div className="stat-card-label">Latest Snapshot</div><div className="stat-card-value" style={{ fontSize: 18 }}>{summary?.latest_snapshot?.status || 'none'}</div><div className="stat-card-sub">{formatDate(summary?.latest_snapshot?.created_at)}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="business-memory-grid">
        <div className="card">
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FolderTree size={15} /> Filesystem</h3>
            <span className="badge badge-open">{filteredFiles.length}</span>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--text-muted)' }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search files"
                style={{
                  width: '100%',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 10,
                  padding: '9px 12px 9px 32px',
                  fontSize: 13
                }}
              />
            </div>

            <div style={{ display: 'grid', gap: 6, maxHeight: 560, overflow: 'auto', paddingRight: 2 }}>
              {filteredFiles.length === 0 ? (
                <div className="empty-state" style={{ padding: 28 }}><Database /><h3>No files yet</h3><p>Generate a snapshot to create memory files.</p></div>
              ) : filteredFiles.map(file => {
                const active = file.path === selectedPath;
                return (
                  <button
                    key={file.path}
                    onClick={() => loadFile(file.path)}
                    style={{
                      textAlign: 'left',
                      border: `1px solid ${active ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.06)'}`,
                      background: active ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.025)',
                      borderRadius: 8,
                      padding: 10,
                      color: 'var(--text-primary)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <FileText size={13} style={{ color: active ? 'var(--accent-bright)' : 'var(--text-muted)' }} />
                      <strong style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{fileLabel(file.path)}</strong>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span>{kindForPath(file.path)}</span>
                      <span>{formatBytes(file.size)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileText size={15} /> {preview?.path || 'Preview'}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>{summary?.root_path}</p>
            </div>
            {preview?.size != null && <span className="badge badge-open">{formatBytes(preview.size)}</span>}
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <pre style={{
              margin: 0,
              minHeight: 620,
              maxHeight: 720,
              overflow: 'auto',
              padding: 18,
              background: 'rgba(4,4,12,0.5)',
              color: preview?.error ? 'var(--danger)' : 'var(--text-secondary)',
              fontSize: 12,
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontFamily: 'var(--font-mono)'
            }}>{preview?.content || 'Generate a snapshot to preview the Business Memory filesystem.'}</pre>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header"><h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Database size={15} /> Source Mix</h3></div>
        <div className="table-container">
          <table>
            <thead><tr><th>Source</th><th>Rows</th></tr></thead>
            <tbody>
              {sourceRows.map(row => (
                <tr key={row.table}><td style={{ fontWeight: 600 }}>{row.table}</td><td>{row.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

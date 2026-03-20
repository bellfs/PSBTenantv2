import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { Search, AlertCircle, Mail, X, ExternalLink, CheckCircle2, Loader2 } from 'lucide-react';

export default function Issues() {
  const [data, setData] = useState({ issues: [], pagination: {} });
  const [filters, setFilters] = useState({ status: 'all', priority: 'all', search: '', page: 1 });
  const [properties, setProperties] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState('');

  useEffect(() => { api.getProperties().then(setProperties).catch(() => {}); }, []);
  useEffect(() => { api.getIssues(filters).then(setData).catch(() => {}); }, [filters]);
  const update = (k, v) => setFilters(f => ({ ...f, [k]: v, page: 1 }));
  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

  const scanInbox = async () => {
    setScanning(true); setScanError(''); setScanResult(null);
    try {
      const result = await api.scanInboxForComplaints();
      setScanResult(result);
      // Refresh the issues list if any were created
      if (result.issues > 0) api.getIssues(filters).then(setData).catch(() => {});
    } catch (e) {
      setScanError(e.message);
    }
    setScanning(false);
  };

  return (
    <div className="fade-in">
      <div className="page-header" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div><h2>Issues</h2><p>{data.pagination.total || 0} total issues</p></div>
        <button className="btn btn-primary" onClick={scanInbox} disabled={scanning} style={{gap:8,whiteSpace:'nowrap'}}>
          {scanning ? <Loader2 size={15} className="spin"/> : <Mail size={15}/>}
          {scanning ? 'Scanning Inbox...' : 'Scan Email for Complaints'}
        </button>
      </div>

      {/* Scan Results Panel */}
      {(scanResult || scanError) && (
        <div className="card" style={{marginBottom:16,border: scanError ? '1px solid var(--danger)' : scanResult?.issues > 0 ? '1px solid var(--success)' : '1px solid rgba(255,255,255,0.08)'}}>
          <div className="card-body" style={{padding:'16px 20px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom: scanResult?.recentLogs?.length > 0 ? 12 : 0}}>
              <div>
                {scanError ? (
                  <div style={{color:'var(--danger)',fontSize:13}}><AlertCircle size={14} style={{verticalAlign:'middle',marginRight:6}}/>Scan failed: {scanError}</div>
                ) : scanResult?.accounts === 0 ? (
                  <div style={{color:'var(--warning)',fontSize:13}}><AlertCircle size={14} style={{verticalAlign:'middle',marginRight:6}}/>No email accounts connected. <Link to="/settings?tab=email" style={{color:'var(--accent-light)'}}>Connect Gmail in Settings</Link></div>
                ) : (
                  <div style={{display:'flex',gap:20,alignItems:'center'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:'var(--text-primary)'}}>
                      <CheckCircle2 size={15} style={{color:'var(--success)'}}/> Inbox scanned
                    </div>
                    <div style={{fontSize:12,color:'var(--text-secondary)'}}>
                      {scanResult.processed} email{scanResult.processed !== 1 ? 's' : ''} checked
                    </div>
                    <div style={{fontSize:12,color:'var(--text-secondary)'}}>
                      {scanResult.matched} matched to tenants
                    </div>
                    <div style={{fontSize:12,fontWeight:600,color: scanResult.issues > 0 ? 'var(--success)' : 'var(--text-muted)'}}>
                      {scanResult.issues} new issue{scanResult.issues !== 1 ? 's' : ''} created
                    </div>
                  </div>
                )}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { setScanResult(null); setScanError(''); }} style={{padding:4}}><X size={14}/></button>
            </div>

            {/* Show recently created issues from email */}
            {scanResult?.recentLogs?.filter(l => l.status === 'issue_created').length > 0 && (
              <div style={{marginTop:8}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8}}>Issues Created from Email</div>
                {scanResult.recentLogs.filter(l => l.status === 'issue_created').slice(0, 10).map(l => (
                  <Link to={`/issues/${l.issue_id}`} key={l.id} style={{
                    display:'flex',alignItems:'center',gap:12,padding:'10px 12px',
                    background:'rgba(34,197,94,0.06)',border:'1px solid rgba(34,197,94,0.15)',
                    borderRadius:8,marginBottom:6,textDecoration:'none',color:'inherit'
                  }}>
                    <Mail size={14} style={{color:'var(--success)',flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>{l.issue_title || l.subject}</div>
                      <div style={{fontSize:11,color:'var(--text-secondary)'}}>
                        {l.from_address} {l.tenant_name ? `\u2192 ${l.tenant_name}` : ''} {l.property_name ? `\u00B7 ${l.property_name}` : ''} {l.flat_number ? `\u00B7 ${l.flat_number}` : ''}
                      </div>
                    </div>
                    {l.issue_priority && <span className={`badge badge-${l.issue_priority}`} style={{fontSize:10}}>{l.issue_priority}</span>}
                    <span className="badge badge-open" style={{fontSize:10}}>New</span>
                    <ExternalLink size={12} style={{color:'var(--text-muted)',flexShrink:0}}/>
                  </Link>
                ))}
              </div>
            )}

            {/* Show scanned but no issues */}
            {scanResult && scanResult.processed > 0 && scanResult.issues === 0 && (
              <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>No new maintenance complaints found in recent emails.</div>
            )}

            {/* Show any account errors */}
            {scanResult?.results?.filter(r => r.error).map((r, i) => (
              <div key={i} style={{fontSize:12,color:'var(--danger)',marginTop:6}}>{r.account}: {r.error}</div>
            ))}
          </div>
        </div>
      )}

      <div className="filters-bar">
        <div className="search-input-wrapper"><Search size={15} /><input className="form-input" placeholder="Search issues..." value={filters.search} onChange={e => update('search', e.target.value)} /></div>
        <select className="form-select" value={filters.status} onChange={e => update('status', e.target.value)}>
          <option value="all">All Status</option><option value="open">Open</option><option value="in_progress">In Progress</option><option value="escalated">Escalated</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
        </select>
        <select className="form-select" value={filters.priority} onChange={e => update('priority', e.target.value)}>
          <option value="all">All Priority</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      </div>
      <div className="issue-list">
        {data.issues.map(i => (
          <Link to={`/issues/${i.id}`} key={i.id} className="issue-row">
            <span className="issue-ref">{i.uuid}</span>
            <div><div className="issue-title">{i.title}</div><div className="issue-title-sub">{i.tenant_name} · {i.property_name}{i.tenant_flat ? ' · ' + i.tenant_flat : ''}</div></div>
            <span className="issue-meta">{i.estimated_cost ? '£' + Number(i.estimated_cost).toFixed(0) : ''}{i.estimated_hours ? ' · ' + Number(i.estimated_hours).toFixed(1) + 'h' : ''}</span>
            <span className={`badge badge-${i.status}`}>{i.status?.replace(/_/g, ' ')}</span>
            <span className={`badge badge-${i.priority}`}>{i.priority}</span>
            <span className="issue-meta">{fmt(i.created_at)}</span>
          </Link>
        ))}
        {data.issues.length === 0 && <div className="empty-state"><AlertCircle size={40} /><h3>No issues found</h3></div>}
      </div>
      {data.pagination.pages > 1 && (
        <div className="pagination">
          <button disabled={filters.page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>Prev</button>
          <span>{filters.page} of {data.pagination.pages}</span>
          <button disabled={filters.page >= data.pagination.pages} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>Next</button>
        </div>
      )}
    </div>
  );
}

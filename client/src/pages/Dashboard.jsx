import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { AlertCircle, Clock, CheckCircle, AlertTriangle, Zap, Users } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [sla, setSla] = useState(null);
  useEffect(() => {
    api.getIssueStats().then(setStats);
    api.getSlaMetrics().then(setSla).catch(() => {});
  }, []);
  if (!stats) return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;

  const aiResRate = sla && (sla.total_resolved + sla.issues_needing_staff) > 0
    ? Math.round((sla.issues_resolved_by_ai / (sla.total_resolved + sla.issues_needing_staff)) * 100) : 0;

  return (
    <div className="fade-in">
      <div className="page-header"><h2>Dashboard</h2><p>Overview of maintenance operations</p></div>
      <div className="stats-grid">
        <div className="stat-card accent"><div className="stat-card-label">Open Issues</div><div className="stat-card-value">{stats.open}</div><div className="stat-card-sub">{stats.today} reported today</div></div>
        <div className="stat-card warning"><div className="stat-card-label">In Progress</div><div className="stat-card-value">{stats.in_progress}</div></div>
        <div className="stat-card danger"><div className="stat-card-label">Escalated</div><div className="stat-card-value">{stats.escalated}</div><div className="stat-card-sub">{stats.urgent} urgent</div></div>
        <div className="stat-card success"><div className="stat-card-label">Resolved</div><div className="stat-card-value">{stats.resolved}</div><div className="stat-card-sub">{stats.this_week} this week</div></div>
        <div className="stat-card" style={{ borderLeft: '3px solid #a855f7' }}><div className="stat-card-label">Est. Total Cost</div><div className="stat-card-value">&pound;{(stats.total_estimated_cost || 0).toFixed(0)}</div></div>
        <div className="stat-card" style={{ borderLeft: '3px solid #22d3ee' }}><div className="stat-card-label">Actual Spend</div><div className="stat-card-value">&pound;{(stats.total_final_cost || 0).toFixed(0)}</div></div>
      </div>

      {/* SLA Performance */}
      {sla && (
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h3><Zap size={14} style={{display:'inline',verticalAlign:'middle',marginRight:6}}/>Performance Metrics</h3></div>
          <div className="card-body">
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))',gap:16}}>
              <div style={{textAlign:'center',padding:'12px 0'}}>
                <div style={{fontSize:24,fontWeight:700,color:'var(--accent-light)'}}>{sla.avg_first_response_mins < 1 ? '< 1' : Math.round(sla.avg_first_response_mins)} min</div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>Avg First Response</div>
              </div>
              <div style={{textAlign:'center',padding:'12px 0'}}>
                <div style={{fontSize:24,fontWeight:700,color:'var(--success)'}}>{sla.avg_resolution_hours?.toFixed(1) || '0'}h</div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>Avg Resolution Time</div>
              </div>
              <div style={{textAlign:'center',padding:'12px 0'}}>
                <div style={{fontSize:24,fontWeight:700,color:'#a855f7'}}>{aiResRate}%</div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>Resolved by AI</div>
              </div>
              <div style={{textAlign:'center',padding:'12px 0'}}>
                <div style={{fontSize:24,fontWeight:700,color:sla.open_over_48h > 0 ? 'var(--danger)' : 'var(--success)'}}>{sla.open_over_48h}</div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>Overdue (48h+)</div>
              </div>
              <div style={{textAlign:'center',padding:'12px 0'}}>
                <div style={{fontSize:24,fontWeight:700,color:'var(--warning)'}}>{sla.total_escalated}</div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>Total Escalated</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overdue warning */}
      {sla?.open_over_48h > 0 && (
        <div style={{background:'var(--danger-subtle)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:8,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:10}}>
          <AlertTriangle size={18} style={{color:'var(--danger)',flexShrink:0}}/>
          <span style={{fontSize:13,color:'var(--text-primary)'}}>{sla.open_over_48h} issue{sla.open_over_48h > 1 ? 's' : ''} open for more than 48 hours and need{sla.open_over_48h === 1 ? 's' : ''} attention</span>
          <Link to="/issues?status=open" style={{marginLeft:'auto',fontSize:12,color:'var(--accent-light)'}}>View</Link>
        </div>
      )}

      <div className="chart-grid-2">
        <div className="card">
          <div className="card-header"><h3>By Category</h3></div>
          <div className="card-body">
            {stats.by_category?.length ? stats.by_category.map(c => (
              <div key={c.category} className="detail-field"><span className="detail-field-label" style={{ textTransform: 'capitalize' }}>{(c.category || 'uncategorised').replace(/_/g, ' ')}</span><span className="badge badge-medium">{c.count}</span></div>
            )) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No active issues</p>}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>By Property</h3></div>
          <div className="card-body">
            {stats.by_property?.length ? stats.by_property.map(p => (
              <div key={p.name} className="detail-field"><span className="detail-field-label">{p.name || 'Unassigned'}</span><span className="badge badge-open">{p.count}</span></div>
            )) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No active issues</p>}
          </div>
        </div>
      </div>

      {stats.recent_escalations?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><h3>Recent Escalations</h3></div>
          <div className="table-container"><table><thead><tr><th>Ref</th><th>Issue</th><th>Tenant</th><th>Property</th><th>When</th></tr></thead><tbody>
            {stats.recent_escalations.map(i => (
              <tr key={i.id}><td><Link to={`/issues/${i.id}`} className="issue-ref">{i.uuid}</Link></td><td>{i.title}</td><td>{i.tenant_name}</td><td>{i.property_name}</td><td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{i.escalated_at ? new Date(i.escalated_at).toLocaleDateString() : ''}</td></tr>
            ))}
          </tbody></table></div>
        </div>
      )}
    </div>
  );
}

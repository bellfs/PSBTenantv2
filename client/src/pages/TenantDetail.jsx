import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../App';
import { ArrowLeft, Download, Mail, Phone, MessageCircle, GraduationCap, Calendar, Building2, Edit3, Save, X } from 'lucide-react';

export default function TenantDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => { api.getTenantIssues(id).then(setData); }, [id]);

  if (!data) return <div style={{padding:40,textAlign:'center'}}><div className="loading-spinner" style={{margin:'0 auto'}}/></div>;
  const { tenant, issues, tenancies } = data;
  const fmt = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '';

  const startEdit = () => {
    setForm({ name: tenant.name, email: tenant.email || '', phone: tenant.phone || '', student_id: tenant.student_id || '' });
    setEditing(true);
  };
  const saveEdit = async () => {
    await api.updateTenant(id, { ...form, property_id: tenant.property_id, flat_number: tenant.flat_number });
    setEditing(false);
    api.getTenantIssues(id).then(setData);
  };

  // Format phone for display: 447XXXXXXXXX → +44 7XXX XXXXXX
  const displayPhone = (p) => {
    if (!p) return '';
    if (p.startsWith('44') && p.length === 12) return `+44 ${p.slice(2,6)} ${p.slice(6)}`;
    return p;
  };

  return (
    <div className="fade-in">
      <div style={{marginBottom:20}}><Link to="/tenants" className="btn btn-ghost btn-sm"><ArrowLeft size={15}/> Back</Link></div>

      {/* Profile Card */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-body" style={{padding:24}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:16}}>
            <div style={{flex:1,minWidth:280}}>
              {editing ? (
                <div style={{display:'flex',flexDirection:'column',gap:12}}>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="form-label">Name</label>
                    <input className="form-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
                  </div>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="form-label">Email</label>
                    <input className="form-input" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/>
                  </div>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="form-label">Phone</label>
                    <input className="form-input" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))}/>
                  </div>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="form-label">Student ID</label>
                    <input className="form-input" value={form.student_id} onChange={e=>setForm(f=>({...f,student_id:e.target.value}))}/>
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-primary btn-sm" onClick={saveEdit}><Save size={14}/> Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(false)}><X size={14}/> Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
                    <div style={{width:48,height:48,borderRadius:'50%',background:'var(--accent)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:600,color:'#fff'}}>
                      {tenant.name?.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)}
                    </div>
                    <div>
                      <h2 style={{margin:0,fontSize:22}}>{tenant.name}</h2>
                      <span style={{fontSize:13,color:'var(--text-muted)'}}>
                        {tenant.property_name || 'No property'}{tenant.flat_number ? ` \u00b7 ${tenant.flat_number}` : ''}
                      </span>
                    </div>
                  </div>

                  <div style={{display:'flex',flexDirection:'column',gap:10}}>
                    {tenant.email && (
                      <a href={`mailto:${tenant.email}`} style={{display:'flex',alignItems:'center',gap:8,color:'var(--accent-light)',textDecoration:'none',fontSize:14}}>
                        <Mail size={16}/> {tenant.email}
                      </a>
                    )}
                    {tenant.phone && (
                      <div style={{display:'flex',gap:12}}>
                        <a href={`tel:+${tenant.phone}`} style={{display:'flex',alignItems:'center',gap:8,color:'var(--accent-light)',textDecoration:'none',fontSize:14}}>
                          <Phone size={16}/> {displayPhone(tenant.phone)}
                        </a>
                        <a href={`https://wa.me/${tenant.phone}`} target="_blank" rel="noopener noreferrer" style={{display:'flex',alignItems:'center',gap:4,color:'#25d366',textDecoration:'none',fontSize:13}}>
                          <MessageCircle size={14}/> WhatsApp
                        </a>
                      </div>
                    )}
                    {tenant.student_id && (
                      <div style={{display:'flex',alignItems:'center',gap:8,color:'var(--text-secondary)',fontSize:14}}>
                        <GraduationCap size={16}/> Student ID: {tenant.student_id}
                      </div>
                    )}
                    {tenant.academic_year && (
                      <div style={{display:'flex',alignItems:'center',gap:8,color:'var(--text-secondary)',fontSize:14}}>
                        <Calendar size={16}/> {tenant.academic_year}
                        {tenant.tenancy_start && tenant.tenancy_end && (
                          <span style={{fontSize:12,color:'var(--text-muted)'}}> ({fmt(tenant.tenancy_start)} \u2013 {fmt(tenant.tenancy_end)})</span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div style={{display:'flex',gap:8,flexShrink:0}}>
              {user?.role === 'admin' && !editing && (
                <button className="btn btn-secondary btn-sm" onClick={startEdit}><Edit3 size={14}/> Edit</button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => api.exportTenantIssues(id)}><Download size={15}/> Export CSV</button>
            </div>
          </div>
        </div>
      </div>

      {/* Tenancy History */}
      {tenancies && tenancies.length > 0 && (
        <div className="card" style={{marginBottom:20}}>
          <div className="card-header"><h3>Tenancy History</h3></div>
          <div className="table-container"><table><thead><tr>
            <th>Academic Year</th><th>Property</th><th>Apartment/Flat</th><th>Start</th><th>End</th><th>Rent (Monthly)</th><th>Status</th>
          </tr></thead><tbody>
            {tenancies.map((tn,i) => (
              <tr key={i}>
                <td style={{fontWeight:500}}>{tn.academic_year}</td>
                <td><Link to={`/properties/${tn.property_id}`} style={{color:'var(--accent-light)',textDecoration:'none'}}>{tn.property_name}</Link></td>
                <td>{tn.flat_number || '\u2013'}</td>
                <td style={{fontSize:12,color:'var(--text-secondary)'}}>{fmt(tn.tenancy_start)}</td>
                <td style={{fontSize:12,color:'var(--text-secondary)'}}>{fmt(tn.tenancy_end)}</td>
                <td>{tn.rent_monthly ? `\u00a3${Number(tn.rent_monthly).toFixed(0)}` : '\u2013'}</td>
                <td>{tn.active ? <span className="badge badge-resolved">Active</span> : <span className="badge badge-closed">Ended</span>}</td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      )}

      {/* Issues */}
      <div className="card"><div className="card-header"><h3>All Issues ({issues.length})</h3></div>
        <div className="table-container"><table><thead><tr><th>Ref</th><th>Issue</th><th>Property</th><th>Category</th><th>Status</th><th>Priority</th><th>Est. Cost</th><th>Final Cost</th><th>Reported</th><th>Resolved</th></tr></thead><tbody>
          {issues.map(i => (
            <tr key={i.id}>
              <td><Link to={`/issues/${i.id}`} className="issue-ref">{i.uuid}</Link></td>
              <td style={{maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{i.title}</td>
              <td>{i.property_name}</td>
              <td style={{textTransform:'capitalize',fontSize:12}}>{(i.category||'').replace(/_/g,' ')}</td>
              <td><span className={`badge badge-${i.status}`}>{i.status?.replace(/_/g,' ')}</span></td>
              <td><span className={`badge badge-${i.priority}`}>{i.priority}</span></td>
              <td>{i.estimated_cost ? '\u00a3'+Number(i.estimated_cost).toFixed(0) : ''}</td>
              <td style={{fontWeight:i.final_cost?600:'normal'}}>{i.final_cost ? '\u00a3'+Number(i.final_cost).toFixed(2) : ''}</td>
              <td style={{fontSize:12,color:'var(--text-secondary)'}}>{fmt(i.created_at)}</td>
              <td style={{fontSize:12,color:'var(--text-secondary)'}}>{fmt(i.resolved_at)}</td>
            </tr>
          ))}
          {issues.length === 0 && <tr><td colSpan={10} style={{textAlign:'center',color:'var(--text-muted)',padding:40}}>No issues reported by this tenant</td></tr>}
        </tbody></table></div>
      </div>
    </div>
  );
}

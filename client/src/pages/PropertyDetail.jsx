import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { ArrowLeft, Download, Home, User, Mail, Phone, ShieldCheck, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { useAuth } from '../App';

export default function PropertyDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [budget, setBudget] = useState(null);
  const [editBudget, setEditBudget] = useState(false);
  const [budgetVal, setBudgetVal] = useState('');
  const [apartments, setApartments] = useState([]);
  const [certs, setCerts] = useState([]);
  const year = new Date().getFullYear();

  useEffect(() => {
    api.getPropertyIssues(id).then(setData);
    api.getPropertyApartments(id).then(setApartments).catch(() => {});
    api.getCertificates({ property_id: id }).then(setCerts).catch(() => {});
    api.getBudgets(year).then(b => {
      const pb = b.budgets.find(x => x.property_id === parseInt(id));
      setBudget(pb || { annual_budget: 0, actual_spend: 0 });
      setBudgetVal(pb?.annual_budget || '');
    }).catch(() => {});
  }, [id]);

  const saveBudget = async () => {
    await api.setBudget({ property_id: parseInt(id), year, annual_budget: parseFloat(budgetVal) || 0 });
    const b = await api.getBudgets(year);
    const pb = b.budgets.find(x => x.property_id === parseInt(id));
    setBudget(pb || { annual_budget: 0, actual_spend: 0 });
    setEditBudget(false);
  };

  if (!data) return <div style={{padding:40,textAlign:'center'}}><div className="loading-spinner" style={{margin:'0 auto'}}/></div>;
  const { property, issues } = data;
  const fmt = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '';
  const bgt = budget?.annual_budget || 0;
  const spend = budget?.actual_spend || 0;
  const pct = bgt > 0 ? Math.round((spend / bgt) * 100) : 0;
  const barColor = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)';

  return (
    <div className="fade-in">
      <div style={{marginBottom:20}}><Link to="/properties" className="btn btn-ghost btn-sm"><ArrowLeft size={15}/> Back</Link></div>
      <div className="page-header" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div><h2>{property.name}</h2><p>{property.address} · {property.postcode} · {property.num_units} units</p></div>
        <button className="btn btn-secondary" onClick={() => api.exportPropertyIssues(id)}><Download size={15}/> Export CSV</button>
      </div>

      {/* Budget Widget */}
      {budget && (
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h3>{year} Maintenance Budget</h3>
            {user?.role === 'admin' && !editBudget && <button className="btn btn-ghost btn-sm" onClick={()=>setEditBudget(true)}>Set Budget</button>}
          </div>
          <div className="card-body">
            {editBudget ? (
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontSize:13}}>Annual Budget:</span>
                <input className="form-input" type="number" step="100" value={budgetVal} onChange={e=>setBudgetVal(e.target.value)} style={{width:120}}/>
                <button className="btn btn-primary btn-sm" onClick={saveBudget}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>setEditBudget(false)}>Cancel</button>
              </div>
            ) : (
              <div>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                  <span style={{fontSize:13,color:'var(--text-secondary)'}}>Spent: {'\u00A3'}{spend.toFixed(0)} {bgt > 0 ? `of \u00A3${bgt.toFixed(0)}` : '(no budget set)'}</span>
                  {bgt > 0 && <span style={{fontSize:13,fontWeight:600,color:barColor}}>{pct}% used</span>}
                </div>
                {bgt > 0 && (
                  <div style={{height:10,background:'var(--bg-input)',borderRadius:5,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${Math.min(pct,100)}%`,background:barColor,borderRadius:5,transition:'width 0.3s'}}/>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Apartment Grid (for multi-unit properties like 52 Old Elvet) */}
      {apartments.length > 0 && (() => {
        // Group tenants by apartment
        const aptMap = {};
        const APT_ORDER = ['The Villiers','The Barrington','The Egerton','The Wolsey','The Tunstall','The Montague','The Morton','The Gray','The Langley','The Kirkham','The Fordham','The Talbot Penthouse'];
        apartments.forEach(a => {
          if (!aptMap[a.apartment]) aptMap[a.apartment] = [];
          aptMap[a.apartment].push(a);
        });
        // Order apartments: known order first, then alphabetical
        const allApts = [...new Set([...APT_ORDER.filter(a => aptMap[a]), ...Object.keys(aptMap).filter(a => !APT_ORDER.includes(a))])];
        // Add known empty apartments
        APT_ORDER.forEach(a => { if (!aptMap[a] && property.name === '52 Old Elvet') allApts.push(a); });

        return (
          <div className="card" style={{marginBottom:16}}>
            <div className="card-header"><h3><Home size={16} style={{verticalAlign:'middle',marginRight:6}}/>Apartments ({allApts.length})</h3></div>
            <div className="card-body">
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
                {[...new Set(allApts)].map(apt => {
                  const tenants = aptMap[apt] || [];
                  const vacant = tenants.length === 0;
                  return (
                    <div key={apt} style={{border:'1px solid var(--border)',borderRadius:8,padding:14,background: vacant ? 'var(--bg-input)' : 'var(--bg-card)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                        <span style={{fontWeight:600,fontSize:14}}>{apt}</span>
                        {vacant ? <span className="badge badge-closed">Vacant</span> : <span className="badge badge-resolved">Occupied</span>}
                      </div>
                      {tenants.map((t,i) => (
                        <div key={i} style={{marginBottom: i < tenants.length-1 ? 8 : 0}}>
                          <Link to={`/tenants/${t.tenant_id}`} style={{color:'var(--accent-light)',textDecoration:'none',fontWeight:500,fontSize:13}}>
                            <User size={12} style={{verticalAlign:'middle',marginRight:4}}/>{t.tenant_name}
                          </Link>
                          <div style={{display:'flex',gap:8,marginTop:4}}>
                            {t.tenant_email && <a href={`mailto:${t.tenant_email}`} title={t.tenant_email} style={{color:'var(--text-muted)'}}><Mail size={12}/></a>}
                            {t.tenant_phone && <a href={`tel:+${t.tenant_phone}`} title={t.tenant_phone} style={{color:'var(--text-muted)'}}><Phone size={12}/></a>}
                          </div>
                        </div>
                      ))}
                      {vacant && <span style={{fontSize:12,color:'var(--text-muted)'}}>No current tenant</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Compliance Certificates */}
      {certs.length > 0 && (
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h3><ShieldCheck size={16} style={{verticalAlign:'middle',marginRight:6}}/>Compliance Certificates ({certs.length})</h3></div>
          <div className="card-body">
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:10}}>
              {certs.map(c => {
                const days = c.expiry_date ? Math.ceil((new Date(c.expiry_date) - Date.now()) / 86400000) : null;
                const icon = days === null ? <CheckCircle size={14} color="var(--text-muted)"/> : days < 0 ? <XCircle size={14} color="#ef4444"/> : days <= 30 ? <AlertTriangle size={14} color="#f59e0b"/> : <CheckCircle size={14} color="#10b981"/>;
                return (
                  <div key={c.id} style={{padding:10,borderRadius:6,border:'1px solid var(--border-light)',background:'var(--bg-secondary)'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      {icon}
                      <span style={{fontWeight:500,fontSize:13}}>{c.cert_type === 'gas_safety' ? 'Gas Safety' : c.cert_type === 'epc' ? 'EPC' : c.cert_type === 'eicr' ? 'EICR' : c.cert_type.replace(/_/g,' ')}</span>
                    </div>
                    <div style={{fontSize:11,color:'var(--text-muted)'}}>
                      {c.expiry_date ? `Expires: ${fmt(c.expiry_date)}` : 'No expiry set'}
                      {c.provider && ` \u00b7 ${c.provider}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="card"><div className="card-header"><h3>All Issues ({issues.length})</h3></div>
        <div className="table-container"><table><thead><tr><th>Ref</th><th>Issue</th><th>Tenant</th><th>Flat</th><th>Category</th><th>Status</th><th>Priority</th><th>Est. Cost</th><th>Final Cost</th><th>Reported</th><th>Resolved</th></tr></thead><tbody>
          {issues.map(i => (
            <tr key={i.id}>
              <td><Link to={`/issues/${i.id}`} className="issue-ref">{i.uuid}</Link></td>
              <td style={{maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{i.title}</td>
              <td>{i.tenant_name}</td><td>{i.tenant_flat||i.flat_number}</td>
              <td style={{textTransform:'capitalize',fontSize:12}}>{(i.category||'').replace(/_/g,' ')}</td>
              <td><span className={`badge badge-${i.status}`}>{i.status?.replace(/_/g,' ')}</span></td>
              <td><span className={`badge badge-${i.priority}`}>{i.priority}</span></td>
              <td>{i.estimated_cost ? '£'+Number(i.estimated_cost).toFixed(0) : ''}</td>
              <td style={{fontWeight:i.final_cost?600:'normal'}}>{i.final_cost ? '£'+Number(i.final_cost).toFixed(2) : ''}</td>
              <td style={{fontSize:12,color:'var(--text-secondary)'}}>{fmt(i.created_at)}</td>
              <td style={{fontSize:12,color:'var(--text-secondary)'}}>{fmt(i.resolved_at)}</td>
            </tr>
          ))}
          {issues.length === 0 && <tr><td colSpan={11} style={{textAlign:'center',color:'var(--text-muted)',padding:40}}>No issues reported for this property</td></tr>}
        </tbody></table></div>
      </div>
    </div>
  );
}

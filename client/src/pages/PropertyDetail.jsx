import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { ArrowLeft, Download } from 'lucide-react';
import { useAuth } from '../App';

export default function PropertyDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [budget, setBudget] = useState(null);
  const [editBudget, setEditBudget] = useState(false);
  const [budgetVal, setBudgetVal] = useState('');
  const year = new Date().getFullYear();

  useEffect(() => {
    api.getPropertyIssues(id).then(setData);
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

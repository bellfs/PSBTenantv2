import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { Building2 } from 'lucide-react';

export default function Properties() {
  const [properties, setProperties] = useState([]);
  useEffect(() => { api.getProperties().then(setProperties); }, []);
  return (
    <div className="fade-in">
      <div className="page-header"><h2>Properties</h2><p>{properties.length} properties in portfolio</p></div>
      <div className="card"><div className="table-container"><table><thead><tr><th>Property</th><th>Address</th><th>Units</th><th>Tenants</th><th>Open Issues</th><th>Total Issues</th><th>Budget</th><th>Spend vs Budget</th></tr></thead><tbody>
        {properties.map(p => {
          const budget = p.annual_budget || 0;
          const spend = p.year_spend || 0;
          const pct = budget > 0 ? Math.round((spend / budget) * 100) : 0;
          const barColor = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)';
          return (
            <tr key={p.id}>
              <td><Link to={`/properties/${p.id}`} style={{color:'var(--accent-light)',textDecoration:'none',fontWeight:500}}>{p.name}</Link></td>
              <td style={{color:'var(--text-secondary)',fontSize:13}}>{p.address}</td>
              <td>{p.num_units}</td>
              <td>{p.tenant_count}</td>
              <td>{p.open_issues > 0 ? <span className="badge badge-open">{p.open_issues}</span> : <span style={{color:'var(--text-muted)'}}>0</span>}</td>
              <td>{p.total_issues || 0}</td>
              <td>{budget > 0 ? `\u00A3${budget.toFixed(0)}` : <span style={{color:'var(--text-muted)'}}>Not set</span>}</td>
              <td style={{minWidth:140}}>
                {budget > 0 ? (
                  <div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
                      <span>{'\u00A3'}{spend.toFixed(0)}</span>
                      <span style={{color: barColor}}>{pct}%</span>
                    </div>
                    <div style={{height:6,background:'var(--bg-input)',borderRadius:3,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${Math.min(pct,100)}%`,background:barColor,borderRadius:3,transition:'width 0.3s'}}/>
                    </div>
                  </div>
                ) : <span style={{color:'var(--text-muted)',fontSize:12}}>-</span>}
              </td>
            </tr>
          );
        })}
      </tbody></table></div></div>
    </div>
  );
}

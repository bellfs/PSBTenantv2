import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { Search, Mail, Phone, MessageCircle } from 'lucide-react';

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');
  const [filtered, setFiltered] = useState([]);

  useEffect(() => {
    api.getTenants(year || undefined).then(setTenants);
  }, [year]);

  useEffect(() => {
    if (!search.trim()) { setFiltered(tenants); return; }
    const q = search.toLowerCase();
    setFiltered(tenants.filter(t =>
      t.name?.toLowerCase().includes(q) ||
      t.email?.toLowerCase().includes(q) ||
      t.phone?.includes(q) ||
      t.property_name?.toLowerCase().includes(q)
    ));
  }, [search, tenants]);

  const displayPhone = (p) => {
    if (!p) return '';
    if (p.startsWith('44') && p.length === 12) return `+44 ${p.slice(2,6)} ${p.slice(6)}`;
    return p;
  };

  return (
    <div className="fade-in">
      <div className="page-header"><h2>Tenants</h2><p>{filtered.length} registered tenants</p></div>

      {/* Filters */}
      <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{position:'relative',flex:1,minWidth:200,maxWidth:400}}>
          <Search size={16} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'var(--text-muted)'}}/>
          <input className="form-input" style={{paddingLeft:36}} placeholder="Search by name, email, phone, property..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <select className="form-input" style={{width:'auto',minWidth:160}} value={year} onChange={e=>setYear(e.target.value)}>
          <option value="">All Academic Years</option>
          <option value="2025-2026">2025-2026</option>
          <option value="2026-2027">2026-2027</option>
        </select>
      </div>

      <div className="card"><div className="table-container"><table><thead><tr>
        <th>Name</th><th>Property</th><th>Flat</th><th>Contact</th><th>Year</th><th>Open</th><th>Total</th><th>Spend</th>
      </tr></thead><tbody>
        {filtered.map(t => (
          <tr key={t.id}>
            <td>
              <Link to={`/tenants/${t.id}`} style={{color:'var(--accent-light)',textDecoration:'none',fontWeight:500}}>{t.name}</Link>
              {t.active === 0 && <span className="badge badge-closed" style={{marginLeft:6,fontSize:10}}>Inactive</span>}
            </td>
            <td style={{color:'var(--text-secondary)',fontSize:13}}>{t.property_name || 'Not assigned'}</td>
            <td style={{fontSize:13}}>{t.flat_number || ''}</td>
            <td>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                {t.email && <a href={`mailto:${t.email}`} title={t.email} style={{color:'var(--accent-light)'}}><Mail size={14}/></a>}
                {t.phone && <a href={`tel:+${t.phone}`} title={displayPhone(t.phone)} style={{color:'var(--accent-light)'}}><Phone size={14}/></a>}
                {t.phone && <a href={`https://wa.me/${t.phone}`} target="_blank" rel="noopener noreferrer" title="WhatsApp" style={{color:'#25d366'}}><MessageCircle size={14}/></a>}
              </div>
            </td>
            <td style={{fontSize:12,color:'var(--text-muted)'}}>{t.academic_year || ''}</td>
            <td>{t.open_issues > 0 ? <span className="badge badge-open">{t.open_issues}</span> : <span style={{color:'var(--text-muted)'}}>0</span>}</td>
            <td>{t.total_issues || 0}</td>
            <td>{t.total_spend ? '\u00a3'+Number(t.total_spend).toFixed(0) : '\u00a30'}</td>
          </tr>
        ))}
        {filtered.length === 0 && <tr><td colSpan={8} style={{textAlign:'center',color:'var(--text-muted)',padding:40}}>No tenants found</td></tr>}
      </tbody></table></div></div>
    </div>
  );
}

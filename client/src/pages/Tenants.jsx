import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { Search, Mail, Phone, MessageCircle, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');
  const [filtered, setFiltered] = useState([]);
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

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

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va = '', vb = '';
      switch (sortCol) {
        case 'name': va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); break;
        case 'property': va = (a.property_name || '').toLowerCase(); vb = (b.property_name || '').toLowerCase(); break;
        case 'flat': va = (a.flat_number || '').toLowerCase(); vb = (b.flat_number || '').toLowerCase(); break;
        case 'year': va = a.academic_year || ''; vb = b.academic_year || ''; break;
        case 'open': va = a.open_issues || 0; vb = b.open_issues || 0; return (va - vb) * dir;
        case 'total': va = a.total_issues || 0; vb = b.total_issues || 0; return (va - vb) * dir;
        case 'spend': va = Number(a.total_spend || 0); vb = Number(b.total_spend || 0); return (va - vb) * dir;
        default: va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase();
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  }, [filtered, sortCol, sortDir]);

  const toggleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <ChevronsUpDown size={12} style={{opacity:0.3,marginLeft:4,verticalAlign:'middle'}}/>;
    return sortDir === 'asc'
      ? <ChevronUp size={12} style={{marginLeft:4,verticalAlign:'middle',color:'var(--accent-light)'}}/>
      : <ChevronDown size={12} style={{marginLeft:4,verticalAlign:'middle',color:'var(--accent-light)'}}/>;
  };

  const thStyle = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };

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
        <th style={thStyle} onClick={()=>toggleSort('name')}>Name <SortIcon col="name"/></th>
        <th style={thStyle} onClick={()=>toggleSort('property')}>Property <SortIcon col="property"/></th>
        <th style={thStyle} onClick={()=>toggleSort('flat')}>Flat <SortIcon col="flat"/></th>
        <th>Contact</th>
        <th style={thStyle} onClick={()=>toggleSort('year')}>Year <SortIcon col="year"/></th>
        <th style={thStyle} onClick={()=>toggleSort('open')}>Open <SortIcon col="open"/></th>
        <th style={thStyle} onClick={()=>toggleSort('total')}>Total <SortIcon col="total"/></th>
        <th style={thStyle} onClick={()=>toggleSort('spend')}>Spend <SortIcon col="spend"/></th>
      </tr></thead><tbody>
        {sorted.map(t => (
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
        {sorted.length === 0 && <tr><td colSpan={8} style={{textAlign:'center',color:'var(--text-muted)',padding:40}}>No tenants found</td></tr>}
      </tbody></table></div></div>
    </div>
  );
}

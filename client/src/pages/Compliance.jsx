import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { ShieldCheck, AlertTriangle, XCircle, CheckCircle, Plus, Trash2, Upload, FileText, Calendar, Building2, ChevronDown, ChevronUp, Eye } from 'lucide-react';

const CERT_TYPES = {
  gas_safety: { label: 'Gas Safety (CP12)', color: '#ef4444' },
  epc: { label: 'EPC', color: '#f59e0b' },
  eicr: { label: 'EICR', color: '#3b82f6' },
  fire_safety: { label: 'Fire Safety', color: '#ef4444' },
  pat_testing: { label: 'PAT Testing', color: '#8b5cf6' },
  legionella: { label: 'Legionella Risk', color: '#06b6d4' },
  insurance: { label: 'Insurance', color: '#10b981' },
  right_to_rent: { label: 'Right to Rent', color: '#ec4899' },
  other: { label: 'Other', color: '#6b7280' },
};

const DOC_CATEGORIES = [
  { value: 'certificate', label: 'Certificate' },
  { value: 'tenancy_agreement', label: 'Tenancy Agreement' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'insurance', label: 'Insurance Document' },
  { value: 'inspection', label: 'Inspection Report' },
  { value: 'manual', label: 'Manual / Guide' },
  { value: 'receipt', label: 'Receipt / Invoice' },
  { value: 'other', label: 'Other' },
];

export default function Compliance() {
  const [tab, setTab] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [properties, setProperties] = useState([]);
  const [filterProp, setFilterProp] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showAddCert, setShowAddCert] = useState(false);
  const [showUploadDoc, setShowUploadDoc] = useState(false);
  const [certForm, setCertForm] = useState({ property_id: '', cert_type: 'gas_safety', certificate_number: '', issued_date: '', expiry_date: '', provider: '', notes: '' });
  const [docForm, setDocForm] = useState({ property_id: '', category: 'certificate', name: '', notes: '' });
  const [docFile, setDocFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expandedProp, setExpandedProp] = useState(null);

  const load = () => {
    api.getComplianceSummary().then(setSummary).catch(() => {});
    api.getCertificates({ property_id: filterProp || undefined, status: filterStatus || undefined }).then(setCertificates).catch(() => {});
    api.getDocuments({ property_id: filterProp || undefined }).then(setDocuments).catch(() => {});
    api.getProperties().then(setProperties).catch(() => {});
  };
  useEffect(() => { load(); }, [filterProp, filterStatus]);

  const saveCert = async () => {
    if (!certForm.property_id || !certForm.cert_type) return;
    setSaving(true);
    try {
      await api.createCertificate(certForm);
      setShowAddCert(false);
      setCertForm({ property_id: '', cert_type: 'gas_safety', certificate_number: '', issued_date: '', expiry_date: '', provider: '', notes: '' });
      load();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const uploadDoc = async () => {
    if (!docFile || !docForm.category) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', docFile);
      fd.append('category', docForm.category);
      if (docForm.property_id) fd.append('property_id', docForm.property_id);
      if (docForm.name) fd.append('name', docForm.name);
      if (docForm.notes) fd.append('notes', docForm.notes);
      await api.uploadDocument(fd);
      setShowUploadDoc(false);
      setDocForm({ property_id: '', category: 'certificate', name: '', notes: '' });
      setDocFile(null);
      load();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const deleteCert = async (id) => {
    if (!confirm('Delete this certificate?')) return;
    await api.deleteCertificate(id);
    load();
  };

  const deleteDoc = async (id) => {
    if (!confirm('Delete this document?')) return;
    await api.deleteDocument(id);
    load();
  };

  const daysUntilExpiry = (date) => {
    if (!date) return null;
    return Math.ceil((new Date(date) - Date.now()) / 86400000);
  };

  const expiryBadge = (date) => {
    const days = daysUntilExpiry(date);
    if (days === null) return <span className="badge" style={{background:'var(--bg-input)',color:'var(--text-muted)'}}>No expiry</span>;
    if (days < 0) return <span className="badge badge-closed"><XCircle size={10} style={{marginRight:3}}/> Expired {Math.abs(days)}d ago</span>;
    if (days <= 30) return <span className="badge" style={{background:'rgba(245,158,11,0.15)',color:'#f59e0b'}}><AlertTriangle size={10} style={{marginRight:3}}/> {days}d left</span>;
    return <span className="badge badge-resolved"><CheckCircle size={10} style={{marginRight:3}}/> Valid ({days}d)</span>;
  };

  const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
  const fileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + 'KB';
    return (bytes / 1048576).toFixed(1) + 'MB';
  };

  return (
    <div className="fade-in">
      <div className="page-header" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
        <div><h2><ShieldCheck size={22} style={{verticalAlign:'middle',marginRight:8}}/>Compliance & Documents</h2><p>Track certificates, safety checks, and property documents</p></div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-secondary" onClick={()=>setShowUploadDoc(true)}><Upload size={14}/> Upload Document</button>
          <button className="btn btn-primary" onClick={()=>setShowAddCert(true)}><Plus size={14}/> Add Certificate</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{marginBottom:16}}>
        <button className={`tab ${tab==='overview'?'active':''}`} onClick={()=>setTab('overview')}>Overview</button>
        <button className={`tab ${tab==='certificates'?'active':''}`} onClick={()=>setTab('certificates')}>Certificates ({certificates.length})</button>
        <button className={`tab ${tab==='documents'?'active':''}`} onClick={()=>setTab('documents')}>Documents ({documents.length})</button>
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && summary && (
        <div>
          {/* Summary Cards */}
          <div className="stats-grid" style={{marginBottom:20}}>
            <div className="stat-card accent">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',position:'relative'}}>
                <div>
                  <div className="stat-card-label">Total Certificates</div>
                  <div className="stat-card-value">{summary.total}</div>
                </div>
                <div style={{width:40,height:40,borderRadius:10,background:'rgba(99,102,241,0.12)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <ShieldCheck size={20} style={{color:'var(--accent-light)'}}/>
                </div>
              </div>
            </div>
            <div className="stat-card" style={{borderLeft:'3px solid #10b981'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',position:'relative'}}>
                <div>
                  <div className="stat-card-label">Valid</div>
                  <div className="stat-card-value" style={{color:'#10b981'}}>{summary.valid}</div>
                </div>
                <div style={{width:40,height:40,borderRadius:10,background:'rgba(16,185,129,0.12)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <CheckCircle size={20} style={{color:'#10b981'}}/>
                </div>
              </div>
            </div>
            <div className="stat-card" style={{borderLeft:'3px solid #f59e0b'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',position:'relative'}}>
                <div>
                  <div className="stat-card-label">Expiring Soon</div>
                  <div className="stat-card-value" style={{color:'#f59e0b'}}>{summary.expiring_soon}</div>
                </div>
                <div style={{width:40,height:40,borderRadius:10,background:'rgba(245,158,11,0.12)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <AlertTriangle size={20} style={{color:'#f59e0b'}}/>
                </div>
              </div>
            </div>
            <div className="stat-card" style={{borderLeft:'3px solid #ef4444'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',position:'relative'}}>
                <div>
                  <div className="stat-card-label">Expired</div>
                  <div className="stat-card-value" style={{color:'#ef4444'}}>{summary.expired}</div>
                </div>
                <div style={{width:40,height:40,borderRadius:10,background:'rgba(239,68,68,0.12)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <XCircle size={20} style={{color:'#ef4444'}}/>
                </div>
              </div>
            </div>
          </div>

          {/* Upcoming Expirations */}
          {summary.expiring_list?.length > 0 && (
            <div className="card" style={{marginBottom:16}}>
              <div className="card-header"><h3><AlertTriangle size={16} style={{verticalAlign:'middle',marginRight:6,color:'#f59e0b'}}/>Upcoming Expirations</h3></div>
              <div className="table-container"><table><thead><tr><th>Certificate</th><th>Property</th><th>Expiry</th><th>Status</th></tr></thead><tbody>
                {summary.expiring_list.map(c => (
                  <tr key={c.id}>
                    <td style={{fontWeight:500}}>{CERT_TYPES[c.cert_type]?.label || c.cert_type}</td>
                    <td style={{color:'var(--text-secondary)',fontSize:13}}>{c.property_name}</td>
                    <td style={{fontSize:13}}>{fmt(c.expiry_date)}</td>
                    <td>{expiryBadge(c.expiry_date)}</td>
                  </tr>
                ))}
              </tbody></table></div>
            </div>
          )}

          {/* Property Coverage */}
          <div className="card">
            <div className="card-header"><h3><Building2 size={16} style={{verticalAlign:'middle',marginRight:6}}/>Property Compliance Coverage</h3></div>
            <div className="card-body">
              {summary.coverage?.map(p => {
                const allGood = p.missing.length === 0 && p.expired.length === 0;
                const isExpanded = expandedProp === p.property_id;
                return (
                  <div key={p.property_id} style={{padding:'12px 0',borderBottom:'1px solid var(--border-light)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setExpandedProp(isExpanded ? null : p.property_id)}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        {allGood ? <CheckCircle size={16} color="#10b981"/> : <AlertTriangle size={16} color="#f59e0b"/>}
                        <span style={{fontWeight:500,fontSize:14}}>{p.property_name}</span>
                        <span style={{fontSize:12,color:'var(--text-muted)'}}>{p.total} cert{p.total !== 1 ? 's' : ''}</span>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        {p.missing.length > 0 && <span style={{fontSize:11,color:'#f59e0b'}}>{p.missing.length} missing</span>}
                        {p.expired.length > 0 && <span style={{fontSize:11,color:'#ef4444'}}>{p.expired.length} expired</span>}
                        {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{marginTop:8,paddingLeft:24,fontSize:12}}>
                        {p.missing.length > 0 && (
                          <div style={{marginBottom:4}}>
                            <span style={{color:'#f59e0b',fontWeight:500}}>Missing:</span>{' '}
                            {p.missing.map(t => CERT_TYPES[t]?.label || t).join(', ')}
                          </div>
                        )}
                        {p.expired.length > 0 && (
                          <div>
                            <span style={{color:'#ef4444',fontWeight:500}}>Expired:</span>{' '}
                            {p.expired.map(t => CERT_TYPES[t]?.label || t).join(', ')}
                          </div>
                        )}
                        {allGood && <div style={{color:'#10b981'}}>All required certificates up to date</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Certificates Tab */}
      {tab === 'certificates' && (
        <div>
          <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
            <select className="form-input" style={{width:'auto',minWidth:160}} value={filterProp} onChange={e=>setFilterProp(e.target.value)}>
              <option value="">All Properties</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="form-input" style={{width:'auto',minWidth:140}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="valid">Valid</option>
              <option value="expiring">Expiring Soon</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div className="card"><div className="table-container"><table><thead><tr>
            <th>Type</th><th>Property</th><th>Cert No.</th><th>Provider</th><th>Issued</th><th>Expires</th><th>Status</th><th>Doc</th><th></th>
          </tr></thead><tbody>
            {certificates.map(c => (
              <tr key={c.id}>
                <td>
                  <span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:CERT_TYPES[c.cert_type]?.color||'#6b7280',marginRight:6}}/>
                  {CERT_TYPES[c.cert_type]?.label || c.cert_type}
                </td>
                <td style={{fontSize:13,color:'var(--text-secondary)'}}>{c.property_name}</td>
                <td style={{fontSize:12,fontFamily:'monospace'}}>{c.certificate_number || '-'}</td>
                <td style={{fontSize:13}}>{c.provider || '-'}</td>
                <td style={{fontSize:12}}>{fmt(c.issued_date)}</td>
                <td style={{fontSize:12}}>{fmt(c.expiry_date)}</td>
                <td>{expiryBadge(c.expiry_date)}</td>
                <td>
                  {c.document_path && (
                    <a href={c.document_path} target="_blank" rel="noopener noreferrer" title={c.document_name} style={{color:'var(--accent-light)'}}>
                      <Eye size={14}/>
                    </a>
                  )}
                </td>
                <td><button className="btn btn-ghost btn-sm" onClick={()=>deleteCert(c.id)} style={{padding:4}}><Trash2 size={13} color="#ef4444"/></button></td>
              </tr>
            ))}
            {certificates.length === 0 && <tr><td colSpan={9} style={{textAlign:'center',color:'var(--text-muted)',padding:40}}>No certificates found. Add your first certificate above.</td></tr>}
          </tbody></table></div></div>
        </div>
      )}

      {/* Documents Tab */}
      {tab === 'documents' && (
        <div>
          <div style={{display:'flex',gap:12,marginBottom:16}}>
            <select className="form-input" style={{width:'auto',minWidth:160}} value={filterProp} onChange={e=>setFilterProp(e.target.value)}>
              <option value="">All Properties</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
            {documents.map(d => (
              <div key={d.id} className="card" style={{margin:0}}>
                <div className="card-body" style={{padding:14}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <FileText size={20} style={{color:'var(--accent-light)',flexShrink:0}}/>
                      <div>
                        <div style={{fontWeight:500,fontSize:13,wordBreak:'break-word'}}>{d.name}</div>
                        <div style={{fontSize:11,color:'var(--text-muted)'}}>{d.category.replace(/_/g,' ')} {d.file_size ? `\u00b7 ${fileSize(d.file_size)}` : ''}</div>
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={()=>deleteDoc(d.id)} style={{padding:4,flexShrink:0}}><Trash2 size={12} color="#ef4444"/></button>
                  </div>
                  {d.property_name && <div style={{fontSize:11,color:'var(--text-secondary)',marginBottom:4}}><Building2 size={10} style={{verticalAlign:'middle',marginRight:3}}/>{d.property_name}</div>}
                  {d.notes && <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:4}}>{d.notes}</div>}
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}>
                    <span style={{fontSize:10,color:'var(--text-muted)'}}>{d.uploaded_by} \u00b7 {new Date(d.created_at).toLocaleDateString('en-GB')}</span>
                    <a href={d.file_path} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{fontSize:11,padding:'2px 8px'}}>
                      <Eye size={12} style={{marginRight:3}}/> View
                    </a>
                  </div>
                </div>
              </div>
            ))}
            {documents.length === 0 && (
              <div style={{gridColumn:'1/-1',textAlign:'center',padding:40,color:'var(--text-muted)'}}>
                <FileText size={32} style={{opacity:0.3,marginBottom:8}}/><br/>
                No documents uploaded yet
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Certificate Modal */}
      {showAddCert && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowAddCert(false)}>
          <div style={{background:'var(--gradient-card)',backdropFilter:'var(--glass-blur)',WebkitBackdropFilter:'var(--glass-blur)',borderRadius:'var(--radius-lg)',padding:28,maxWidth:500,width:'90%',border:'var(--glass-border)',maxHeight:'90vh',overflowY:'auto',boxShadow:'var(--shadow-lg)'}} onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:'0 0 16px'}}>Add Compliance Certificate</h3>
            <div className="form-group">
              <label className="form-label">Property *</label>
              <select className="form-select" value={certForm.property_id} onChange={e=>setCertForm(p=>({...p,property_id:e.target.value}))}>
                <option value="">Select property...</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Certificate Type *</label>
              <select className="form-select" value={certForm.cert_type} onChange={e=>setCertForm(p=>({...p,cert_type:e.target.value}))}>
                {Object.entries(CERT_TYPES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div className="form-group">
                <label className="form-label">Certificate Number</label>
                <input className="form-input" placeholder="e.g. GAS-2025-001" value={certForm.certificate_number} onChange={e=>setCertForm(p=>({...p,certificate_number:e.target.value}))}/>
              </div>
              <div className="form-group">
                <label className="form-label">Provider / Contractor</label>
                <input className="form-input" placeholder="e.g. British Gas" value={certForm.provider} onChange={e=>setCertForm(p=>({...p,provider:e.target.value}))}/>
              </div>
              <div className="form-group">
                <label className="form-label">Issue Date</label>
                <input className="form-input" type="date" value={certForm.issued_date} onChange={e=>setCertForm(p=>({...p,issued_date:e.target.value}))}/>
              </div>
              <div className="form-group">
                <label className="form-label">Expiry Date</label>
                <input className="form-input" type="date" value={certForm.expiry_date} onChange={e=>setCertForm(p=>({...p,expiry_date:e.target.value}))}/>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={2} placeholder="Any additional notes..." value={certForm.notes} onChange={e=>setCertForm(p=>({...p,notes:e.target.value}))}/>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
              <button className="btn btn-ghost" onClick={()=>setShowAddCert(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCert} disabled={saving || !certForm.property_id}>{saving ? 'Saving...' : 'Add Certificate'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Document Modal */}
      {showUploadDoc && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowUploadDoc(false)}>
          <div style={{background:'var(--gradient-card)',backdropFilter:'var(--glass-blur)',WebkitBackdropFilter:'var(--glass-blur)',borderRadius:'var(--radius-lg)',padding:28,maxWidth:500,width:'90%',border:'var(--glass-border)',maxHeight:'90vh',overflowY:'auto',boxShadow:'var(--shadow-lg)'}} onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:'0 0 16px'}}>Upload Document</h3>
            <div className="form-group">
              <label className="form-label">File *</label>
              <input type="file" className="form-input" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" onChange={e=>setDocFile(e.target.files[0])} style={{padding:8}}/>
              <p style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>PDF, images, Word and Excel files. Max 25MB.</p>
            </div>
            <div className="form-group">
              <label className="form-label">Category *</label>
              <select className="form-select" value={docForm.category} onChange={e=>setDocForm(p=>({...p,category:e.target.value}))}>
                {DOC_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Property (optional)</label>
              <select className="form-select" value={docForm.property_id} onChange={e=>setDocForm(p=>({...p,property_id:e.target.value}))}>
                <option value="">No property</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Document Name</label>
              <input className="form-input" placeholder="e.g. Gas Safety Certificate 2025" value={docForm.name} onChange={e=>setDocForm(p=>({...p,name:e.target.value}))}/>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={2} placeholder="Any notes about this document..." value={docForm.notes} onChange={e=>setDocForm(p=>({...p,notes:e.target.value}))}/>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
              <button className="btn btn-ghost" onClick={()=>setShowUploadDoc(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={uploadDoc} disabled={saving || !docFile}>{saving ? 'Uploading...' : 'Upload'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

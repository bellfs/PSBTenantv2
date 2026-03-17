import React, { useState, useEffect } from 'react';
import { useAuth } from '../App';
import { api } from '../utils/api';
import { HardHat, Plus, Phone, Mail, X, Wrench, Zap, Droplets, Home } from 'lucide-react';

const TRADES = ['plumbing', 'electrical', 'joinery', 'roofing', 'general', 'heating', 'painting', 'locksmith'];
const TRADE_ICONS = { plumbing: Droplets, electrical: Zap, joinery: Wrench, roofing: Home };

export default function Contractors() {
  const { user } = useAuth();
  const [contractors, setContractors] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', trade: 'plumbing', phone: '', email: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = () => api.getContractors().then(setContractors);
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) await api.updateContractor(editing, form);
      else await api.createContractor(form);
      setShowForm(false);
      setEditing(null);
      setForm({ name: '', trade: 'plumbing', phone: '', email: '', notes: '' });
      await load();
    } catch (err) { alert(err.message); }
    setSaving(false);
  };

  const startEdit = (c) => {
    setEditing(c.id);
    setForm({ name: c.name, trade: c.trade, phone: c.phone || '', email: c.email || '', notes: c.notes || '' });
    setShowForm(true);
  };

  if (!contractors) return <div style={{padding:40,textAlign:'center'}}><div className="loading-spinner" style={{margin:'0 auto'}}/></div>;

  return (
    <div className="fade-in">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div className="page-header" style={{marginBottom:0}}>
          <h2>Contractors</h2>
          <p>Manage your contractor network and view their job history</p>
        </div>
        {user?.role === 'admin' && (
          <button className="btn btn-primary" onClick={() => { setEditing(null); setForm({ name:'', trade:'plumbing', phone:'', email:'', notes:'' }); setShowForm(true); }}>
            <Plus size={15}/> Add Contractor
          </button>
        )}
      </div>

      <div className="stats-grid" style={{marginBottom:20}}>
        <div className="stat-card accent">
          <div className="stat-card-label">Total Contractors</div>
          <div className="stat-card-value">{contractors.length}</div>
        </div>
        <div className="stat-card success">
          <div className="stat-card-label">Completed Jobs</div>
          <div className="stat-card-value">{contractors.reduce((s, c) => s + (c.completed_jobs || 0), 0)}</div>
        </div>
        <div className="stat-card" style={{borderLeft:'3px solid #a855f7'}}>
          <div className="stat-card-label">Total Spend</div>
          <div className="stat-card-value">{'\u00A3'}{contractors.reduce((s, c) => s + (c.total_spend || 0), 0).toFixed(0)}</div>
        </div>
      </div>

      {showForm && (
        <div className="card" style={{marginBottom:20}}>
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h3>{editing ? 'Edit Contractor' : 'Add Contractor'}</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setEditing(null); }}><X size={15}/></button>
          </div>
          <div className="card-body">
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Tony the Plumber"/>
              </div>
              <div className="form-group">
                <label className="form-label">Trade</label>
                <select className="form-select" value={form.trade} onChange={e => setForm(f => ({...f, trade: e.target.value}))}>
                  {TRADES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="07..."/>
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="email@example.com"/>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Any notes about this contractor..."/>
            </div>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name}>{saving ? 'Saving...' : editing ? 'Update' : 'Add Contractor'}</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Contractor</th>
                <th>Trade</th>
                <th>Contact</th>
                <th>Quotes</th>
                <th>Completed</th>
                <th>Total Spend</th>
                {user?.role === 'admin' && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {contractors.length === 0 ? (
                <tr><td colSpan={7} style={{textAlign:'center',padding:40,color:'var(--text-muted)'}}>No contractors yet</td></tr>
              ) : contractors.map(c => {
                const Icon = TRADE_ICONS[c.trade] || Wrench;
                return (
                  <tr key={c.id} style={{opacity: c.active ? 1 : 0.5}}>
                    <td>
                      <div style={{fontWeight:500}}>{c.name}</div>
                      {c.notes && <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>{c.notes}</div>}
                    </td>
                    <td><span className="badge" style={{background:'var(--accent-subtle)',color:'var(--accent-light)'}}><Icon size={11} style={{marginRight:4}}/>{c.trade}</span></td>
                    <td>
                      {c.phone && <div style={{fontSize:12,display:'flex',alignItems:'center',gap:4}}><Phone size={11}/>{c.phone}</div>}
                      {c.email && <div style={{fontSize:12,display:'flex',alignItems:'center',gap:4,marginTop:2}}><Mail size={11}/>{c.email}</div>}
                    </td>
                    <td>{c.total_quotes || 0}</td>
                    <td>{c.completed_jobs || 0}</td>
                    <td>{'\u00A3'}{(c.total_spend || 0).toFixed(0)}</td>
                    {user?.role === 'admin' && (
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => startEdit(c)}>Edit</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

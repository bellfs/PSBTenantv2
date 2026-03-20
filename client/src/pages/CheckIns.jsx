import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { ClipboardCheck, Plus, Building2, User, Calendar, ChevronRight, CheckCircle, Clock, FileEdit, Search, Trash2 } from 'lucide-react';

const statusLabels = { draft: 'Draft', in_progress: 'In Progress', pending_signature: 'Pending Signature', completed: 'Completed' };
const statusColors = {
  draft: { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8' },
  in_progress: { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24' },
  pending_signature: { bg: 'rgba(168,85,247,0.12)', color: '#c084fc' },
  completed: { bg: 'rgba(52,211,153,0.12)', color: '#34d399' },
};

export default function CheckIns() {
  const navigate = useNavigate();
  const [inspections, setInspections] = useState([]);
  const [properties, setProperties] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Create form
  const [form, setForm] = useState({ property_id: '', flat_number: '', tenant_id: '', inspection_date: new Date().toISOString().split('T')[0] });

  useEffect(() => {
    Promise.all([
      api.getInspections({ type: 'check_in' }),
      api.getProperties(),
      api.getTenants()
    ]).then(([insp, props, tens]) => {
      setInspections(insp);
      setProperties(props);
      setTenants(tens);
    }).finally(() => setLoading(false));
  }, []);

  const handleDelete = async (e, inspId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this check-in inspection? This cannot be undone.')) return;
    try {
      await api.deleteInspection(inspId);
      setInspections(prev => prev.filter(i => i.id !== inspId));
    } catch (err) { alert('Error: ' + err.message); }
  };

  const handleCreate = async () => {
    if (!form.property_id || !form.inspection_date) return;
    try {
      const { id } = await api.createInspection({ type: 'check_in', ...form });
      navigate(`/check-ins/${id}`);
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const filtered = inspections.filter(i => {
    if (filter !== 'all' && i.status !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (i.property_name || '').toLowerCase().includes(s) ||
             (i.tenant_name || '').toLowerCase().includes(s) ||
             (i.flat_number || '').toLowerCase().includes(s);
    }
    return true;
  });

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Tenant Check-In</h2>
          <p>Onboarding inspections & condition reports</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> New Check-In
        </button>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <div className="search-input-wrapper">
          <Search size={15} />
          <input className="form-input" placeholder="Search by property or tenant..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-select" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="in_progress">In Progress</option>
          <option value="pending_signature">Pending Signature</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <ClipboardCheck size={48} />
          <h3>No check-in inspections yet</h3>
          <p>Create your first check-in inspection to get started</p>
        </div>
      ) : (
        <div className="issue-list">
          {filtered.map(insp => {
            const sc = statusColors[insp.status] || statusColors.draft;
            return (
              <Link to={`/check-ins/${insp.id}`} key={insp.id} className="issue-row" style={{ gridTemplateColumns: '1fr', display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <ClipboardCheck size={18} style={{ color: 'var(--accent-light)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
                    {insp.property_name}{insp.flat_number ? ` — ${insp.flat_number}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {insp.tenant_name && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><User size={11} /> {insp.tenant_name}</span>}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={11} /> {new Date(insp.inspection_date).toLocaleDateString('en-GB')}</span>
                  </div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>
                  {insp.status === 'completed' ? <CheckCircle size={12} /> : insp.status === 'pending_signature' ? <FileEdit size={12} /> : <Clock size={12} />}
                  {statusLabels[insp.status]}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={(e) => handleDelete(e, insp.id)} title="Delete inspection" style={{ color: 'var(--text-muted)', padding: 6, flexShrink: 0 }}>
                  <Trash2 size={14} />
                </button>
                <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </Link>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700 }}>New Check-In Inspection</h3>
            <div className="form-group">
              <label className="form-label">Property *</label>
              <select className="form-select" value={form.property_id} onChange={e => setForm({ ...form, property_id: e.target.value })}>
                <option value="">Select property...</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Flat / Unit</label>
              <input className="form-input" placeholder="e.g. Flat 3" value={form.flat_number} onChange={e => setForm({ ...form, flat_number: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Tenant</label>
              <select className="form-select" value={form.tenant_id} onChange={e => setForm({ ...form, tenant_id: e.target.value })}>
                <option value="">Select tenant (optional)...</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name} — {t.property_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Inspection Date *</label>
              <input className="form-input" type="date" value={form.inspection_date} onChange={e => setForm({ ...form, inspection_date: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!form.property_id}>Create Inspection</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

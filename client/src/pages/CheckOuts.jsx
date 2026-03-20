import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { ClipboardList, Plus, User, Calendar, ChevronRight, CheckCircle, Clock, FileEdit, Search, PoundSterling } from 'lucide-react';

const statusLabels = { draft: 'Draft', in_progress: 'In Progress', pending_signature: 'Pending Signature', completed: 'Completed' };
const statusColors = {
  draft: { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8' },
  in_progress: { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24' },
  pending_signature: { bg: 'rgba(168,85,247,0.12)', color: '#c084fc' },
  completed: { bg: 'rgba(52,211,153,0.12)', color: '#34d399' },
};

export default function CheckOuts() {
  const navigate = useNavigate();
  const [inspections, setInspections] = useState([]);
  const [properties, setProperties] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [form, setForm] = useState({ property_id: '', flat_number: '', tenant_id: '', inspection_date: new Date().toISOString().split('T')[0], deposit_amount: '', linked_checkin_id: '' });

  useEffect(() => {
    Promise.all([
      api.getInspections({ type: 'check_out' }),
      api.getProperties(),
      api.getTenants()
    ]).then(([insp, props, tens]) => {
      setInspections(insp);
      setProperties(props);
      setTenants(tens);
    }).finally(() => setLoading(false));
  }, []);

  // Load check-ins when property changes
  useEffect(() => {
    if (form.property_id) {
      api.getPropertyCheckins(form.property_id).then(setCheckins).catch(() => setCheckins([]));
    } else {
      setCheckins([]);
    }
  }, [form.property_id]);

  const handleCreate = async () => {
    if (!form.property_id || !form.inspection_date) return;
    try {
      const { id } = await api.createInspection({
        type: 'check_out',
        property_id: form.property_id,
        flat_number: form.flat_number,
        tenant_id: form.tenant_id || null,
        inspection_date: form.inspection_date,
        deposit_amount: parseFloat(form.deposit_amount) || 0,
        linked_checkin_id: form.linked_checkin_id || null
      });
      navigate(`/check-outs/${id}`);
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
          <h2>Tenant Check-Out</h2>
          <p>End-of-tenancy inspections & deposit assessments</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> New Check-Out
        </button>
      </div>

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

      {filtered.length === 0 ? (
        <div className="empty-state">
          <ClipboardList size={48} />
          <h3>No check-out inspections yet</h3>
          <p>Create a check-out inspection to assess property condition before deposit return</p>
        </div>
      ) : (
        <div className="issue-list">
          {filtered.map(insp => {
            const sc = statusColors[insp.status] || statusColors.draft;
            return (
              <Link to={`/check-outs/${insp.id}`} key={insp.id} className="issue-row" style={{ gridTemplateColumns: '1fr', display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(248,113,113,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <ClipboardList size={18} style={{ color: 'var(--danger)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
                    {insp.property_name}{insp.flat_number ? ` — ${insp.flat_number}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {insp.tenant_name && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><User size={11} /> {insp.tenant_name}</span>}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={11} /> {new Date(insp.inspection_date).toLocaleDateString('en-GB')}</span>
                    {insp.total_deductions > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--danger)' }}>
                        <PoundSterling size={11} /> £{insp.total_deductions.toFixed(0)} deductions
                      </span>
                    )}
                  </div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>
                  {insp.status === 'completed' ? <CheckCircle size={12} /> : insp.status === 'pending_signature' ? <FileEdit size={12} /> : <Clock size={12} />}
                  {statusLabels[insp.status]}
                </span>
                <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700 }}>New Check-Out Inspection</h3>
            <div className="form-group">
              <label className="form-label">Property *</label>
              <select className="form-select" value={form.property_id} onChange={e => setForm({ ...form, property_id: e.target.value, linked_checkin_id: '' })}>
                <option value="">Select property...</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {checkins.length > 0 && (
              <div className="form-group">
                <label className="form-label">Link to Check-In (recommended)</label>
                <select className="form-select" value={form.linked_checkin_id} onChange={e => {
                  const ci = checkins.find(c => c.id == e.target.value);
                  setForm({ ...form, linked_checkin_id: e.target.value, flat_number: ci?.flat_number || form.flat_number });
                }}>
                  <option value="">No linked check-in</option>
                  {checkins.map(ci => (
                    <option key={ci.id} value={ci.id}>
                      {ci.tenant_name || 'Unknown'} — {ci.flat_number || 'N/A'} ({new Date(ci.inspection_date).toLocaleDateString('en-GB')})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Flat / Unit</label>
              <input className="form-input" placeholder="e.g. Flat 3" value={form.flat_number} onChange={e => setForm({ ...form, flat_number: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Tenant</label>
              <select className="form-select" value={form.tenant_id} onChange={e => setForm({ ...form, tenant_id: e.target.value })}>
                <option value="">Select tenant...</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name} — {t.property_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Inspection Date *</label>
              <input className="form-input" type="date" value={form.inspection_date} onChange={e => setForm({ ...form, inspection_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Deposit Amount (£)</label>
              <input className="form-input" type="number" step="0.01" placeholder="e.g. 500" value={form.deposit_amount} onChange={e => setForm({ ...form, deposit_amount: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!form.property_id}>Create Check-Out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { ArrowLeft, Camera, Plus, Save, CheckCircle, FileText, Trash2, PenTool, X, ChevronDown, ChevronUp, Upload, Loader2, Download } from 'lucide-react';

const CONDITIONS = ['excellent', 'good', 'fair', 'poor', 'damaged'];
const CONDITION_COLORS = { excellent: '#34d399', good: '#60a5fa', fair: '#fbbf24', poor: '#f87171', damaged: '#ef4444' };

export default function InspectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedRooms, setExpandedRooms] = useState({});
  const [showSignModal, setShowSignModal] = useState(null); // 'tenant' | 'staff'
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [showAddDeduction, setShowAddDeduction] = useState(false);
  const [deductionForm, setDeductionForm] = useState({ description: '', cost: '', category: 'damage', item_id: '' });
  const [showReport, setShowReport] = useState(false);
  const [reportHtml, setReportHtml] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.getInspection(id);
      setData(d);
      // Expand all rooms by default
      const exp = {};
      d.rooms.forEach(r => { exp[r.id] = true; });
      setExpandedRooms(exp);
    } catch (e) {
      alert('Error loading inspection: ' + e.message);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateItem = async (itemId, updates) => {
    try {
      await api.updateInspectionItem(itemId, updates);
      load();
    } catch (e) { alert('Error: ' + e.message); }
  };

  const handlePhotoUpload = async (inspectionId, roomId, itemId, files) => {
    for (const file of files) {
      const formData = new FormData();
      formData.append('photo', file);
      if (roomId) formData.append('room_id', roomId);
      if (itemId) formData.append('item_id', itemId);
      formData.append('photo_type', 'condition');
      await api.uploadInspectionPhoto(inspectionId, formData);
    }
    load();
  };

  const handleDeletePhoto = async (photoId) => {
    if (!confirm('Delete this photo?')) return;
    await api.deleteInspectionPhoto(photoId);
    load();
  };

  const handleAddRoom = async () => {
    if (!newRoomName.trim()) return;
    await api.addInspectionRoom(id, newRoomName.trim());
    setNewRoomName('');
    setShowAddRoom(false);
    load();
  };

  const handleAddDeduction = async () => {
    if (!deductionForm.description || !deductionForm.cost) return;
    await api.addDeduction(id, { ...deductionForm, cost: parseFloat(deductionForm.cost) });
    setDeductionForm({ description: '', cost: '', category: 'damage', item_id: '' });
    setShowAddDeduction(false);
    load();
  };

  const handleDeleteDeduction = async (dedId) => {
    if (!confirm('Remove this deduction?')) return;
    await api.deleteDeduction(dedId);
    load();
  };

  const handleUpdateInspection = async (updates) => {
    setSaving(true);
    try {
      await api.updateInspection(id, updates);
      load();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleGenerateReport = async () => {
    try {
      const report = await api.getInspectionReport(id);
      setReportHtml(report.html);
      setShowReport(true);
    } catch (e) { alert('Error: ' + e.message); }
  };

  const printReport = () => {
    const w = window.open('', '_blank');
    w.document.write(reportHtml);
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;
  if (!data) return <div style={{ padding: 40 }}>Inspection not found</div>;

  const { inspection, rooms, photos, deductions, checkinData } = data;
  const isCheckOut = inspection.type === 'check_out';
  const isCompleted = inspection.status === 'completed';
  const backPath = isCheckOut ? '/check-outs' : '/check-ins';

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Link to={backPath} className="btn btn-ghost btn-sm"><ArrowLeft size={16} /></Link>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>
            {isCheckOut ? 'Check-Out' : 'Check-In'}: {inspection.property_name}
            {inspection.flat_number ? ` — ${inspection.flat_number}` : ''}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {new Date(inspection.inspection_date).toLocaleDateString('en-GB')} • {inspection.performed_by}
            {inspection.tenant_name ? ` • ${inspection.tenant_name}` : ''}
          </p>
        </div>
        <span className={`badge badge-${inspection.status === 'completed' ? 'resolved' : inspection.status === 'pending_signature' ? 'awaiting_tenant' : 'in_progress'}`}>
          {inspection.status?.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="detail-grid">
        <div>
          {/* Meter Readings & Keys */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><h3>Meter Readings & Keys</h3></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Gas Meter</label>
                  <input className="form-input" placeholder="Reading" defaultValue={inspection.meter_gas || ''} onBlur={e => handleUpdateInspection({ meter_gas: e.target.value })} disabled={isCompleted} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Electric Meter</label>
                  <input className="form-input" placeholder="Reading" defaultValue={inspection.meter_electric || ''} onBlur={e => handleUpdateInspection({ meter_electric: e.target.value })} disabled={isCompleted} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Water Meter</label>
                  <input className="form-input" placeholder="Reading" defaultValue={inspection.meter_water || ''} onBlur={e => handleUpdateInspection({ meter_water: e.target.value })} disabled={isCompleted} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginTop: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Key Count</label>
                  <input className="form-input" type="number" placeholder="0" defaultValue={inspection.key_count || ''} onBlur={e => handleUpdateInspection({ key_count: parseInt(e.target.value) || null })} disabled={isCompleted} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Key Notes</label>
                  <input className="form-input" placeholder="e.g. 2 sets provided" defaultValue={inspection.key_notes || ''} onBlur={e => handleUpdateInspection({ key_notes: e.target.value })} disabled={isCompleted} />
                </div>
              </div>
            </div>
          </div>

          {/* Room-by-Room */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Room-by-Room Inspection</h3>
            {!isCompleted && (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAddRoom(true)}>
                <Plus size={13} /> Add Room
              </button>
            )}
          </div>

          {rooms.map(room => (
            <div key={room.id} className="checkinout-room-card">
              <h4 onClick={() => setExpandedRooms(prev => ({ ...prev, [room.id]: !prev[room.id] }))} style={{ cursor: 'pointer' }}>
                {expandedRooms[room.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {room.room_name}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                  {room.items.length} items • {room.photos.length} photos
                </span>
              </h4>

              {expandedRooms[room.id] && (
                <>
                  {/* Items */}
                  {room.items.map(item => (
                    <div key={item.id} className="checkinout-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 500 }}>{item.item_name}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {CONDITIONS.map(c => (
                            <button
                              key={c}
                              onClick={() => !isCompleted && updateItem(item.id, { condition: c, is_damaged: c === 'damaged' || c === 'poor' ? 1 : 0 })}
                              className="checkinout-condition"
                              style={{
                                background: item.condition === c ? `${CONDITION_COLORS[c]}22` : 'transparent',
                                color: item.condition === c ? CONDITION_COLORS[c] : 'var(--text-muted)',
                                border: item.condition === c ? `1px solid ${CONDITION_COLORS[c]}44` : '1px solid transparent',
                                cursor: isCompleted ? 'default' : 'pointer',
                                fontSize: 10, padding: '2px 8px',
                                textTransform: 'capitalize',
                              }}
                              disabled={isCompleted}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </div>
                      {isCheckOut && item.checkin_condition && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Check-in: <span style={{ color: CONDITION_COLORS[item.checkin_condition], fontWeight: 600 }}>{item.checkin_condition}</span>
                          {item.checkin_condition !== item.condition && item.condition && (
                            <span style={{ color: 'var(--danger)', marginLeft: 8 }}>⚠ Changed</span>
                          )}
                        </div>
                      )}
                      {!isCompleted && (
                        <input
                          className="form-input"
                          style={{ fontSize: 12, padding: '6px 10px' }}
                          placeholder="Add notes..."
                          defaultValue={item.description || ''}
                          onBlur={e => updateItem(item.id, { description: e.target.value })}
                        />
                      )}
                      {isCheckOut && !isCompleted && (item.condition === 'poor' || item.condition === 'damaged') && (
                        <input
                          className="form-input"
                          style={{ fontSize: 12, padding: '6px 10px' }}
                          placeholder="Repair cost (£)"
                          type="number"
                          step="0.01"
                          defaultValue={item.repair_cost || ''}
                          onBlur={e => updateItem(item.id, { repair_cost: parseFloat(e.target.value) || 0 })}
                        />
                      )}
                      {item.description && isCompleted && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.description}</div>
                      )}
                    </div>
                  ))}

                  {/* Photos for this room */}
                  {room.photos.length > 0 && (
                    <div className="checkinout-photo-grid" style={{ marginTop: 8 }}>
                      {room.photos.map(photo => (
                        <div key={photo.id} style={{ position: 'relative' }}>
                          <img src={photo.file_path} alt={photo.caption || ''} className="checkinout-photo" />
                          {!isCompleted && (
                            <button
                              onClick={() => handleDeletePhoto(photo.id)}
                              style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload photos for room */}
                  {!isCompleted && (
                    <label className="photo-upload-zone" style={{ marginTop: 8 }}>
                      <Camera size={18} style={{ marginBottom: 4 }} />
                      <div>Upload photos for {room.room_name}</div>
                      <input type="file" accept="image/*" multiple hidden onChange={e => handlePhotoUpload(id, room.id, null, e.target.files)} />
                    </label>
                  )}
                </>
              )}
            </div>
          ))}

          {/* Notes */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header"><h3>Additional Notes</h3></div>
            <div className="card-body">
              <textarea
                className="form-textarea"
                rows={3}
                placeholder="Any additional notes about the inspection..."
                defaultValue={inspection.notes || ''}
                onBlur={e => handleUpdateInspection({ notes: e.target.value })}
                disabled={isCompleted}
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="detail-sidebar">
          {/* Actions */}
          <div className="card">
            <div className="card-header"><h3>Actions</h3></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!isCompleted && (
                <>
                  <button className="btn btn-primary" onClick={() => setShowSignModal('tenant')} style={{ width: '100%', justifyContent: 'center' }}>
                    <PenTool size={14} /> Tenant Signature
                  </button>
                  <button className="btn btn-secondary" onClick={() => setShowSignModal('staff')} style={{ width: '100%', justifyContent: 'center' }}>
                    <PenTool size={14} /> Staff Signature
                  </button>
                </>
              )}
              <button className="btn btn-secondary" onClick={handleGenerateReport} style={{ width: '100%', justifyContent: 'center' }}>
                <FileText size={14} /> {isCheckOut ? 'Generate Deposit Report' : 'Generate Report'}
              </button>
              {isCompleted && (
                <div style={{ textAlign: 'center', padding: 12, color: 'var(--success)', fontSize: 13, fontWeight: 600 }}>
                  <CheckCircle size={16} style={{ marginRight: 6 }} />
                  Inspection Complete
                </div>
              )}
            </div>
          </div>

          {/* Signatures Status */}
          <div className="card">
            <div className="card-header"><h3>Signatures</h3></div>
            <div className="card-body">
              <div className="detail-field">
                <span className="detail-field-label">Tenant</span>
                {inspection.tenant_signature ? (
                  <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 12 }}>
                    <CheckCircle size={12} style={{ marginRight: 4 }} />
                    Signed {inspection.tenant_signed_at ? new Date(inspection.tenant_signed_at).toLocaleDateString('en-GB') : ''}
                  </span>
                ) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Pending</span>}
              </div>
              <div className="detail-field">
                <span className="detail-field-label">Staff</span>
                {inspection.staff_signature ? (
                  <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 12 }}>
                    <CheckCircle size={12} style={{ marginRight: 4 }} />
                    Signed {inspection.staff_signed_at ? new Date(inspection.staff_signed_at).toLocaleDateString('en-GB') : ''}
                  </span>
                ) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Pending</span>}
              </div>
            </div>
          </div>

          {/* Deposit section (check-out only) */}
          {isCheckOut && (
            <>
              <div className="card">
                <div className="card-header">
                  <h3>Deposit & Deductions</h3>
                  {!isCompleted && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowAddDeduction(true)}>
                      <Plus size={12} /> Add
                    </button>
                  )}
                </div>
                <div className="card-body">
                  <div className="form-group" style={{ margin: 0, marginBottom: 12 }}>
                    <label className="form-label">Deposit Amount (£)</label>
                    <input
                      className="form-input"
                      type="number"
                      step="0.01"
                      defaultValue={inspection.deposit_amount || ''}
                      onBlur={e => handleUpdateInspection({ deposit_amount: parseFloat(e.target.value) || 0 })}
                      disabled={isCompleted}
                    />
                  </div>

                  {deductions.length > 0 && (
                    <div className="deduction-summary">
                      {deductions.map(d => (
                        <div key={d.id} className="deduction-row">
                          <div>
                            <div style={{ fontWeight: 500 }}>{d.description}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {d.room_name ? `${d.room_name} — ${d.item_name}` : d.category}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600, color: 'var(--danger)' }}>£{d.cost.toFixed(2)}</span>
                            {!isCompleted && (
                              <button onClick={() => handleDeleteDeduction(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="deduction-total">
                        <span>Total Deductions</span>
                        <span style={{ color: 'var(--danger)' }}>£{(inspection.total_deductions || 0).toFixed(2)}</span>
                      </div>
                      {inspection.deposit_amount > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, padding: '8px 0', fontSize: 14, fontWeight: 700, color: 'var(--success)' }}>
                          <span>Deposit Return</span>
                          <span>£{(inspection.deposit_return || 0).toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Photo count */}
          <div className="card">
            <div className="card-header"><h3>Photos</h3></div>
            <div className="card-body">
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-light)' }}>{photos.length}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>photos uploaded</div>
            </div>
          </div>
        </div>
      </div>

      {/* Signature Modal */}
      {showSignModal && (
        <SignatureModal
          title={showSignModal === 'tenant' ? 'Tenant Signature' : 'Staff Signature'}
          onClose={() => setShowSignModal(null)}
          onSign={async (signatureData) => {
            await api.signInspection(id, showSignModal, signatureData);
            setShowSignModal(null);
            load();
          }}
        />
      )}

      {/* Add Room Modal */}
      {showAddRoom && (
        <div className="modal-backdrop" onClick={() => setShowAddRoom(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>Add Room</h3>
            <input className="form-input" placeholder="Room name..." value={newRoomName} onChange={e => setNewRoomName(e.target.value)} autoFocus />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowAddRoom(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddRoom}>Add Room</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Deduction Modal */}
      {showAddDeduction && (
        <div className="modal-backdrop" onClick={() => setShowAddDeduction(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>Add Deposit Deduction</h3>
            <div className="form-group">
              <label className="form-label">Description *</label>
              <input className="form-input" placeholder="e.g. Stained carpet in bedroom" value={deductionForm.description} onChange={e => setDeductionForm({ ...deductionForm, description: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Cost (£) *</label>
              <input className="form-input" type="number" step="0.01" placeholder="0.00" value={deductionForm.cost} onChange={e => setDeductionForm({ ...deductionForm, cost: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-select" value={deductionForm.category} onChange={e => setDeductionForm({ ...deductionForm, category: e.target.value })}>
                <option value="damage">Damage</option>
                <option value="cleaning">Cleaning</option>
                <option value="missing_item">Missing Item</option>
                <option value="repair">Repair</option>
                <option value="redecoration">Redecoration</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowAddDeduction(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddDeduction}>Add Deduction</button>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReport && (
        <div className="modal-backdrop" onClick={() => setShowReport(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3>Inspection Report</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={printReport}>
                  <Download size={13} /> Print / Save PDF
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowReport(false)}>
                  <X size={14} />
                </button>
              </div>
            </div>
            <div dangerouslySetInnerHTML={{ __html: reportHtml }} style={{ background: 'white', borderRadius: 8, overflow: 'hidden' }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ===== SIGNATURE PAD COMPONENT =====
function SignatureModal({ title, onClose, onSign }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(20, rect.height - 30);
    ctx.lineTo(rect.width - 20, rect.height - 30);
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches?.[0];
    return {
      x: (touch ? touch.clientX : e.clientX) - rect.left,
      y: (touch ? touch.clientY : e.clientY) - rect.top
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    setDrawing(true);
    setHasDrawn(true);
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!drawing) return;
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDraw = (e) => {
    e.preventDefault();
    setDrawing(false);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    setHasDrawn(false);
    // Redraw baseline
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(20, rect.height - 30);
    ctx.lineTo(rect.width - 20, rect.height - 30);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const save = () => {
    const dataUrl = canvasRef.current.toDataURL('image/png');
    onSign(dataUrl);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3 style={{ marginBottom: 12 }}>{title}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
          {title === 'Tenant Signature'
            ? 'I confirm that I am happy with the condition of the property as recorded in this inspection.'
            : 'I confirm that this inspection has been conducted accurately.'}
        </p>
        <canvas
          ref={canvasRef}
          className={`signature-pad ${hasDrawn ? 'signed' : ''}`}
          style={{ width: '100%', height: 150, borderRadius: 'var(--radius-md)' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost btn-sm" onClick={clear}>Clear</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!hasDrawn}>
            <CheckCircle size={14} /> Confirm Signature
          </button>
        </div>
      </div>
    </div>
  );
}

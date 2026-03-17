import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { ArrowLeft, Send, FileText, StickyNote, Clock, AlertCircle, Image } from 'lucide-react';

export default function IssueDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [ef, setEf] = useState({});
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');

  const load = () => api.getIssue(id).then(d => {
    setData(d);
    setEf({ final_cost: d.issue.final_cost ?? '', final_notes: d.issue.final_notes || '', attended_by: d.issue.attended_by || '', resolution_notes: d.issue.resolution_notes || '', resolved_at: d.issue.resolved_at ? d.issue.resolved_at.slice(0,10) : '' });
  });
  useEffect(() => { load(); }, [id]);
  if (!data) return <div style={{padding:40,textAlign:'center'}}><div className="loading-spinner" style={{margin:'0 auto'}}/></div>;
  const { issue, messages, attachments, staff, notes, similar } = data;

  const sendReply = async () => { if (!reply.trim()) return; setSending(true); try { await api.respondToIssue(id, reply); setReply(''); await load(); } finally { setSending(false); } };
  const updateField = async (f) => { await api.updateIssue(id, f); await load(); };
  const saveRes = async () => { setSaving(true); try { await api.updateIssue(id, { final_cost: ef.final_cost !== '' ? parseFloat(ef.final_cost) : null, final_notes: ef.final_notes, attended_by: ef.attended_by, resolution_notes: ef.resolution_notes, resolved_at: ef.resolved_at || null }); await load(); } finally { setSaving(false); } };
  const fmt = d => d ? new Date(d).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'N/A';

  const generateReport = async () => {
    setReportLoading(true);
    try { const r = await api.generateReport(id); setReport(r); } catch(e) { alert('Failed to generate report'); }
    finally { setReportLoading(false); }
  };

  const downloadReport = () => {
    if (!report) return;
    const content = `PSB PROPERTIES - MAINTENANCE ISSUE REPORT
========================================
Generated: ${new Date(report.generated_at).toLocaleString('en-GB')}
Reference: ${report.issue.uuid}
Property: ${report.issue.property_name}
Tenant: ${report.issue.tenant_name}${report.issue.tenant_flat ? ', ' + report.issue.tenant_flat : ''}
Status: ${report.issue.status}
Priority: ${report.issue.priority}
Category: ${report.issue.category || 'Pending'}
========================================

${report.report}

========================================
Photos: ${report.attachments.length} attached
Messages in conversation: ${report.messages_count}
AI Estimated Cost: £${(report.issue.estimated_cost || 0).toFixed(2)}
AI Estimated Time: ${(report.issue.estimated_hours || 0).toFixed(1)} hours
${report.issue.final_cost ? 'Actual Cost: £' + report.issue.final_cost.toFixed(2) : ''}
${report.issue.attended_by ? 'Attended By: ' + report.issue.attended_by : ''}
`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `issue-report-${report.issue.uuid}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try { await api.addIssueNote(id, noteText); setNoteText(''); await load(); }
    finally { setAddingNote(false); }
  };

  const photos = attachments?.filter(a => a.file_type?.startsWith('image')) || [];

  // SLA calculations
  const createdAt = new Date(issue.created_at);
  const firstBotMsg = messages?.find(m => m.sender === 'bot');
  const responseTimeMins = firstBotMsg ? Math.round((new Date(firstBotMsg.created_at) - createdAt) / 60000) : null;
  const resolutionHours = issue.resolved_at ? Math.round((new Date(issue.resolved_at) - createdAt) / 3600000 * 10) / 10 : null;

  return (
    <div className="fade-in">
      <div style={{marginBottom:20}}><Link to="/issues" className="btn btn-ghost btn-sm"><ArrowLeft size={15}/> Back</Link></div>
      <div className="page-header">
        <h2>{issue.title}</h2>
        <p>Ref: {issue.uuid} . <Link to={`/tenants/${issue.tenant_id_ref}`} style={{color:'var(--accent-light)'}}>{issue.tenant_name}</Link> . {issue.property_name}{issue.tenant_flat ? ' . '+issue.tenant_flat : ''}</p>
      </div>

      <div className="detail-grid">
        <div>
          {/* Tab navigation */}
          <div className="tabs" style={{marginBottom:0,borderRadius:'8px 8px 0 0'}}>
            <button className={`tab ${activeTab==='chat'?'active':''}`} onClick={()=>setActiveTab('chat')}>Conversation</button>
            <button className={`tab ${activeTab==='photos'?'active':''}`} onClick={()=>setActiveTab('photos')}>Photos {photos.length > 0 && `(${photos.length})`}</button>
            <button className={`tab ${activeTab==='report'?'active':''}`} onClick={()=>setActiveTab('report')}>AI Report</button>
            <button className={`tab ${activeTab==='notes'?'active':''}`} onClick={()=>setActiveTab('notes')}>Notes {notes?.length > 0 && `(${notes.length})`}</button>
            <button className={`tab ${activeTab==='activity'?'active':''}`} onClick={()=>setActiveTab('activity')}>Activity</button>
          </div>

          {/* Chat tab */}
          {activeTab === 'chat' && (
            <div className="card" style={{borderRadius:'0 0 8px 8px'}}>
              <div className="chat-container">
                {messages.map(m => (
                  <div key={m.id} className={`chat-bubble ${m.sender}`}>
                    <div className="chat-sender">{m.sender==='tenant'?issue.tenant_name:m.sender==='bot'?'AI Bot':'Staff'}</div>
                    <div style={{whiteSpace:'pre-wrap'}}>{m.content}</div>
                    <div className="chat-time">{fmt(m.created_at)}</div>
                  </div>
                ))}
              </div>
              {!['resolved','closed'].includes(issue.status) && (
                <div className="reply-box">
                  <textarea className="form-textarea" placeholder="Reply via WhatsApp..." value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendReply();}}}/>
                  <button className="btn btn-primary" onClick={sendReply} disabled={sending}><Send size={15}/></button>
                </div>
              )}
            </div>
          )}

          {/* Photos tab */}
          {activeTab === 'photos' && (
            <div className="card" style={{borderRadius:'0 0 8px 8px'}}>
              <div className="card-body">
                {photos.length === 0 ? (
                  <div className="empty-state"><Image size={32}/><h3>No photos yet</h3><p style={{fontSize:13,color:'var(--text-muted)'}}>Photos sent by the tenant will appear here</p></div>
                ) : (
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))',gap:12}}>
                    {photos.map(p => (
                      <div key={p.id} style={{background:'var(--bg-secondary)',borderRadius:8,overflow:'hidden',border:'1px solid var(--border-light)'}}>
                        <div style={{height:140,background:'var(--bg-input)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:'var(--text-muted)'}}>
                          <Image size={24} style={{opacity:0.4}}/>
                        </div>
                        {p.ai_analysis && (() => {
                          try {
                            const a = JSON.parse(p.ai_analysis.replace(/```json\n?/g,'').replace(/```\n?/g,''));
                            return <div style={{padding:10,fontSize:11,color:'var(--text-secondary)'}}>{a.description || a.likely_issue}</div>;
                          } catch(e) { return <div style={{padding:10,fontSize:11,color:'var(--text-secondary)'}}>{p.ai_analysis.slice(0,100)}</div>; }
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Report tab */}
          {activeTab === 'report' && (
            <div className="card" style={{borderRadius:'0 0 8px 8px'}}>
              <div className="card-body">
                {!report ? (
                  <div style={{textAlign:'center',padding:20}}>
                    <FileText size={32} style={{opacity:0.4,marginBottom:12}}/>
                    <p style={{color:'var(--text-secondary)',fontSize:13,marginBottom:16}}>Generate an AI-powered summary report for this issue. Includes diagnosis, actions taken, cost assessment and recommendations for the maintenance team.</p>
                    <button className="btn btn-primary" onClick={generateReport} disabled={reportLoading}>
                      {reportLoading ? 'Generating report...' : 'Generate AI Report'}
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{whiteSpace:'pre-wrap',fontSize:13,lineHeight:1.6,color:'var(--text-primary)',marginBottom:16}}>{report.report}</div>
                    <div style={{borderTop:'1px solid var(--border-light)',paddingTop:12,display:'flex',gap:8}}>
                      <button className="btn btn-primary btn-sm" onClick={downloadReport}><FileText size={14}/> Download Report</button>
                      <button className="btn btn-ghost btn-sm" onClick={generateReport} disabled={reportLoading}>{reportLoading ? 'Regenerating...' : 'Regenerate'}</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Internal Notes tab */}
          {activeTab === 'notes' && (
            <div className="card" style={{borderRadius:'0 0 8px 8px'}}>
              <div className="card-body">
                <p style={{fontSize:11,color:'var(--text-muted)',marginBottom:12}}>Private notes for the team only. Not visible to the tenant.</p>
                <div style={{display:'flex',gap:8,marginBottom:16}}>
                  <textarea className="form-textarea" rows={2} placeholder="Add an internal note..." value={noteText} onChange={e=>setNoteText(e.target.value)} style={{flex:1}}/>
                  <button className="btn btn-primary" onClick={addNote} disabled={addingNote} style={{alignSelf:'flex-end'}}><StickyNote size={14}/></button>
                </div>
                {notes?.length > 0 ? notes.map(n => (
                  <div key={n.id} style={{padding:'10px 12px',background:'var(--bg-secondary)',borderRadius:6,marginBottom:8,borderLeft:'3px solid #f59e0b'}}>
                    <div style={{fontSize:13,whiteSpace:'pre-wrap'}}>{n.content}</div>
                    <div style={{fontSize:11,color:'var(--text-muted)',marginTop:6}}>{n.author} . {fmt(n.created_at)}</div>
                  </div>
                )) : <p style={{fontSize:12,color:'var(--text-muted)'}}>No notes yet</p>}
              </div>
            </div>
          )}

          {/* Activity Log tab */}
          {activeTab === 'activity' && (
            <div className="card" style={{borderRadius:'0 0 8px 8px'}}>
              <div className="card-body">
                {data.activity?.map(a => (
                  <div key={a.id} style={{padding:'8px 0',borderBottom:'1px solid var(--border-light)',fontSize:12}}>
                    <span style={{color:'var(--text-primary)',fontWeight:500}}>{a.action.replace(/_/g,' ')}</span>
                    <span style={{color:'var(--text-muted)',marginLeft:8}}>{a.performed_by}</span>
                    <span style={{float:'right',color:'var(--text-muted)'}}>{fmt(a.created_at)}</span>
                    {a.details && <div style={{color:'var(--text-secondary)',marginTop:2}}>{a.details}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="detail-sidebar">
          {/* Status and Priority */}
          <div className="card"><div className="card-body">
            <div className="detail-field"><span className="detail-field-label">Status</span>
              <select className="form-select" style={{width:'auto',fontSize:12}} value={issue.status} onChange={e=>updateField({status:e.target.value})}>
                <option value="open">Open</option><option value="in_progress">In Progress</option><option value="escalated">Escalated</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
              </select></div>
            <div className="detail-field"><span className="detail-field-label">Priority</span>
              <select className="form-select" style={{width:'auto',fontSize:12}} value={issue.priority} onChange={e=>updateField({priority:e.target.value})}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
              </select></div>
            <div className="detail-field"><span className="detail-field-label">Category</span><span style={{textTransform:'capitalize'}}>{(issue.category||'Pending').replace(/_/g,' ')}</span></div>
            <div className="detail-field"><span className="detail-field-label">Reported</span><span>{fmt(issue.created_at)}</span></div>
            {issue.escalated_at && <div className="detail-field"><span className="detail-field-label">Escalated</span><span>{fmt(issue.escalated_at)}</span></div>}
          </div></div>

          {/* SLA / Timeline */}
          <div className="card"><div className="card-header"><h3><Clock size={14} style={{display:'inline',verticalAlign:'middle',marginRight:4}}/> Timeline</h3></div><div className="card-body">
            <div className="detail-field"><span className="detail-field-label">First Response</span><span>{responseTimeMins !== null ? (responseTimeMins < 1 ? '< 1 min' : responseTimeMins + ' mins') : 'Pending'}</span></div>
            <div className="detail-field"><span className="detail-field-label">Messages</span><span>{messages.length}</span></div>
            <div className="detail-field"><span className="detail-field-label">Photos</span><span>{photos.length}</span></div>
            {resolutionHours !== null && <div className="detail-field"><span className="detail-field-label">Resolved In</span><span>{resolutionHours}h</span></div>}
            <div className="detail-field"><span className="detail-field-label">Age</span><span>{Math.round((Date.now() - createdAt) / 3600000)}h</span></div>
          </div></div>

          {/* AI Estimates */}
          <div className="card"><div className="card-header"><h3>AI Assessment</h3></div><div className="card-body">
            <div className="detail-field"><span className="detail-field-label">Est. Cost</span><span>£{Number(issue.estimated_cost||0).toFixed(2)}</span></div>
            <div className="detail-field"><span className="detail-field-label">Est. Hours</span><span>{Number(issue.estimated_hours||0).toFixed(1)}h</span></div>
            {issue.estimated_materials && <div className="detail-field"><span className="detail-field-label">Materials</span><span style={{fontSize:12}}>{(() => { try { return JSON.parse(issue.estimated_materials).join(', '); } catch(e) { return issue.estimated_materials; } })()}</span></div>}
            {issue.ai_diagnosis && <div style={{marginTop:8,fontSize:12,color:'var(--text-secondary)',padding:'8px 0',borderTop:'1px solid var(--border-light)'}}>{issue.ai_diagnosis}</div>}
          </div></div>

          {/* Similar / Recurring Issues */}
          {similar?.length > 0 && (
            <div className="card"><div className="card-header"><h3><AlertCircle size={14} style={{display:'inline',verticalAlign:'middle',marginRight:4}}/> Similar Issues</h3></div><div className="card-body">
              <p style={{fontSize:11,color:'var(--text-muted)',marginBottom:8}}>Same property and category</p>
              {similar.map(s => (
                <Link to={`/issues/${s.id}`} key={s.id} style={{display:'block',padding:'6px 0',borderBottom:'1px solid var(--border-light)',fontSize:12,color:'var(--text-secondary)',textDecoration:'none'}}>
                  <span style={{color:'var(--accent-light)'}}>{s.uuid}</span> {s.title}
                  <span style={{float:'right',fontSize:11,color:'var(--text-muted)'}}>{s.status}</span>
                </Link>
              ))}
            </div></div>
          )}

          {/* Resolution */}
          <div className="card"><div className="card-header"><h3>Resolution Details</h3></div><div className="card-body">
            <div className="form-group"><label className="form-label">Attended By</label>
              <select className="form-select" value={ef.attended_by} onChange={e=>setEf(p=>({...p,attended_by:e.target.value}))}>
                <option value="">Select team member</option>
                {staff?.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Final Cost (£)</label><input className="form-input" type="number" step="0.01" placeholder="0.00" value={ef.final_cost} onChange={e=>setEf(p=>({...p,final_cost:e.target.value}))}/></div>
            <div className="form-group"><label className="form-label">Date Resolved</label><input className="form-input" type="date" value={ef.resolved_at} onChange={e=>setEf(p=>({...p,resolved_at:e.target.value}))}/></div>
            <div className="form-group"><label className="form-label">Resolution Notes</label><textarea className="form-textarea" rows={3} placeholder="What was done to fix this..." value={ef.resolution_notes} onChange={e=>setEf(p=>({...p,resolution_notes:e.target.value}))}/></div>
            <div className="form-group"><label className="form-label">Additional Notes</label><textarea className="form-textarea" rows={2} placeholder="Any other notes..." value={ef.final_notes} onChange={e=>setEf(p=>({...p,final_notes:e.target.value}))}/></div>
            <button className="btn btn-primary" onClick={saveRes} disabled={saving} style={{width:'100%'}}>{saving ? 'Saving...' : 'Save Resolution Details'}</button>
          </div></div>
        </div>
      </div>
    </div>
  );
}

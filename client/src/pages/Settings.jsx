import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../App';
import { Save, Plus, Mail, RefreshCw, Trash2, Power, PowerOff } from 'lucide-react';

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('email');
  const [settings, setSettings] = useState({});
  const [staff, setStaff] = useState([]);
  const [saved, setSaved] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', email: '', password: '', role: 'maintenance' });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' });

  // Email state
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [syncLog, setSyncLog] = useState([]);
  const [imapForm, setImapForm] = useState({ email_address: 'info@psb.properties', host: 'imap.zoho.com', port: 993, username: 'info@psb.properties', password: '' });
  const [emailLoading, setEmailLoading] = useState('');
  const [emailError, setEmailError] = useState('');
  const [testEmailStatus, setTestEmailStatus] = useState('');
  const [newPhone, setNewPhone] = useState({ name: '', number: '' });

  // Check URL params for Gmail callback result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'email') setTab('email');
    if (params.get('gmail') === 'connected') { setEmailError(''); loadEmailAccounts(); }
    if (params.get('gmail') === 'error') setEmailError(params.get('msg') || 'Gmail connection failed');
  }, []);

  useEffect(() => {
    if (isAdmin) {
      api.getSettings().then(setSettings).catch(() => {});
      api.getStaff().then(setStaff).catch(() => {});
    }
  }, [isAdmin]);
  useEffect(() => { if (tab === 'email') loadEmailAccounts(); }, [tab]);
  useEffect(() => {
    if (!isAdmin && !['email', 'account'].includes(tab)) setTab('email');
  }, [isAdmin, tab]);

  const loadEmailAccounts = () => {
    api.getEmailAccounts().then(setEmailAccounts).catch(() => {});
    api.getEmailSyncLog().then(setSyncLog).catch(() => {});
  };

  const saveSettings = async () => {
    await api.updateSettings(settings); setSaved(true); setTimeout(() => setSaved(false), 2000);
  };
  const createStaff = async () => {
    if (!newStaff.name || !newStaff.email || !newStaff.password) return;
    await api.createStaff(newStaff); setNewStaff({ name: '', email: '', password: '', role: 'maintenance' });
    api.getStaff().then(setStaff);
  };
  const changePw = async () => {
    await api.changePassword(pwForm.currentPassword, pwForm.newPassword);
    setPwForm({ currentPassword: '', newPassword: '' }); alert('Password changed');
  };

  const connectGmail = async () => {
    setEmailLoading('gmail'); setEmailError('');
    try {
      const { url } = await api.getGmailAuthUrl();
      window.location.href = url;
    } catch (e) {
      setEmailError(e.message);
      setEmailLoading('');
    }
  };

  const connectImap = async () => {
    if (!imapForm.email_address || !imapForm.username || !imapForm.password) return;
    setEmailLoading('imap'); setEmailError('');
    try {
      await api.addImapAccount(imapForm);
      setImapForm(f => ({ ...f, password: '' }));
      loadEmailAccounts();
    } catch (e) { setEmailError(e.message); }
    setEmailLoading('');
  };

  const triggerSync = async (id) => {
    setEmailLoading(`sync-${id}`);
    try {
      const result = await api.triggerEmailSync(id);
      alert(`Sync complete: ${result.processed} emails processed, ${result.matched} matched, ${result.issues} issues created${result.error ? '\nError: '+result.error : ''}`);
      loadEmailAccounts();
    } catch (e) { setEmailError(e.message); }
    setEmailLoading('');
  };

  const toggleAccount = async (id, enabled) => {
    await api.toggleEmailAccount(id, enabled);
    loadEmailAccounts();
  };

  const deleteAccount = async (id) => {
    if (!confirm('Remove this email account?')) return;
    await api.deleteEmailAccount(id);
    loadEmailAccounts();
  };

  const tabConfig = isAdmin ? [
    ['ai', 'AI Config'], ['whatsapp', 'WhatsApp'], ['notifications', 'Notifications'],
    ['email', 'Email Sync'], ['team', 'Team'], ['account', 'Account']
  ] : [
    ['email', 'Email Sync'], ['account', 'Account']
  ];

  return (
    <div className="fade-in">
      <div className="page-header"><h2>Settings</h2></div>
      <div className="tabs">
        {tabConfig.map(([t, label]) => <button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{label}</button>)}
      </div>

      {tab === 'ai' && <div className="card"><div className="card-body">
        <div className="form-group"><label className="form-label">LLM Provider</label>
          <div className="toggle-group">
            <button className={`toggle-option ${settings.llm_provider==='openai'?'active':''}`} onClick={()=>setSettings(s=>({...s,llm_provider:'openai'}))}>OpenAI</button>
            <button className={`toggle-option ${settings.llm_provider==='anthropic'?'active':''}`} onClick={()=>setSettings(s=>({...s,llm_provider:'anthropic'}))}>Anthropic</button>
          </div>
          <p style={{fontSize:11,color:'var(--text-muted)',marginTop:6}}>Set via Railway env vars for security (OPENAI_API_KEY / ANTHROPIC_API_KEY)</p>
        </div>
        <div className="form-group"><label className="form-label">OpenAI Key</label><input className="form-input" value={settings.openai_api_key||''} onChange={e=>setSettings(s=>({...s,openai_api_key:e.target.value}))} placeholder="sk-..."/>{settings.openai_api_key_set && <span style={{fontSize:11,color:'var(--success)'}}>Key configured</span>}</div>
        <div className="form-group"><label className="form-label">Anthropic Key</label><input className="form-input" value={settings.anthropic_api_key||''} onChange={e=>setSettings(s=>({...s,anthropic_api_key:e.target.value}))} placeholder="sk-ant-..."/>{settings.anthropic_api_key_set && <span style={{fontSize:11,color:'var(--success)'}}>Key configured</span>}</div>
        <div className="form-group"><label className="form-label">Escalation Threshold (bot attempts)</label><input className="form-input" type="number" value={settings.escalation_threshold||3} onChange={e=>setSettings(s=>({...s,escalation_threshold:e.target.value}))}/></div>
        <div className="form-group"><label className="form-label">Escalation Email</label><input className="form-input" value={settings.escalation_email||''} onChange={e=>setSettings(s=>({...s,escalation_email:e.target.value}))}/></div>
        <button className="btn btn-primary" onClick={saveSettings}><Save size={15}/> {saved ? 'Saved!' : 'Save'}</button>
      </div></div>}

      {tab === 'whatsapp' && <div className="card"><div className="card-body">
        <p style={{fontSize:13,color:'var(--text-secondary)',marginBottom:16}}>WhatsApp credentials are set via Railway environment variables for security. The following are configured there:</p>
        <div className="detail-field"><span className="detail-field-label">WHATSAPP_PHONE_NUMBER_ID</span><span className="badge badge-open">Set in Railway</span></div>
        <div className="detail-field"><span className="detail-field-label">WHATSAPP_ACCESS_TOKEN</span><span className="badge badge-open">Set in Railway</span></div>
        <div className="detail-field"><span className="detail-field-label">WHATSAPP_VERIFY_TOKEN</span><span className="badge badge-open">Set in Railway</span></div>
      </div></div>}

      {tab === 'notifications' && <div className="card"><div className="card-header"><h3>WhatsApp Notifications</h3></div><div className="card-body">
        <div className="form-group">
          <label className="form-label">Auto Status Updates to Tenants</label>
          <p style={{fontSize:12,color:'var(--text-muted)',marginBottom:8}}>Automatically send tenants a WhatsApp message when their issue status changes (e.g. in progress, escalated, resolved).</p>
          <div className="toggle-group">
            <button className={`toggle-option ${settings.auto_status_updates==='true'||settings.auto_status_updates===true?'active':''}`} onClick={()=>setSettings(s=>({...s,auto_status_updates:'true'}))}>On</button>
            <button className={`toggle-option ${settings.auto_status_updates==='false'||settings.auto_status_updates===false?'active':''}`} onClick={()=>setSettings(s=>({...s,auto_status_updates:'false'}))}>Off</button>
          </div>
        </div>
        <div className="form-group" style={{marginTop:20}}>
          <label className="form-label">Team WhatsApp Notifications</label>
          <p style={{fontSize:12,color:'var(--text-muted)',marginBottom:8}}>Add team members who should receive WhatsApp notifications when new issues are reported or tenants send messages.</p>

          {/* Current team members list */}
          {(() => {
            const raw = settings.staff_notify_phones || '';
            const entries = raw.split(',').map(e => e.trim()).filter(Boolean);
            // Parse entries: "Name:+447..." or just "+447..."
            const members = entries.map(e => {
              const parts = e.split(':');
              if (parts.length === 2) return { name: parts[0].trim(), number: parts[1].trim() };
              return { name: '', number: e.trim() };
            });

            return members.length > 0 ? (
              <div style={{marginBottom:12}}>
                {members.map((m, i) => (
                  <div key={i} style={{
                    display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
                    background:'rgba(99,102,241,0.04)', border:'1px solid rgba(99,102,241,0.1)',
                    borderRadius:8, marginBottom:6
                  }}>
                    <div style={{
                      width:32, height:32, borderRadius:'50%',
                      background:'var(--gradient-accent)', display:'flex',
                      alignItems:'center', justifyContent:'center',
                      fontSize:13, fontWeight:600, color:'white', flexShrink:0
                    }}>
                      {m.name ? m.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2) : '#'}
                    </div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:13, fontWeight:500, color:'var(--text-primary)'}}>
                        {m.name || 'Team Member'}
                      </div>
                      <div style={{fontSize:11, color:'var(--text-muted)'}}>{m.number}</div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{color:'var(--danger)', padding:'4px 8px'}}
                      onClick={() => {
                        const updated = entries.filter((_, idx) => idx !== i).join(', ');
                        setSettings(s => ({...s, staff_notify_phones: updated}));
                      }}
                      title="Remove"
                    >
                      <Trash2 size={14}/>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding:'16px', textAlign:'center', borderRadius:8,
                border:'1px dashed rgba(255,255,255,0.08)', marginBottom:12,
                color:'var(--text-muted)', fontSize:12
              }}>
                No team members added yet
              </div>
            );
          })()}

          {/* Add new member form */}
          <div style={{
            display:'flex', gap:8, alignItems:'flex-end', flexWrap:'wrap'
          }}>
            <div style={{flex:'1 1 120px', minWidth:120}}>
              <label style={{fontSize:11, color:'var(--text-muted)', marginBottom:4, display:'block'}}>Name</label>
              <input
                className="form-input"
                value={newPhone.name}
                onChange={e => setNewPhone(p => ({...p, name: e.target.value}))}
                placeholder="e.g. Fergus"
                style={{fontSize:13}}
              />
            </div>
            <div style={{flex:'1 1 160px', minWidth:160}}>
              <label style={{fontSize:11, color:'var(--text-muted)', marginBottom:4, display:'block'}}>WhatsApp Number</label>
              <input
                className="form-input"
                value={newPhone.number}
                onChange={e => setNewPhone(p => ({...p, number: e.target.value}))}
                placeholder="e.g. +447700900001"
                style={{fontSize:13}}
              />
            </div>
            <button
              className="btn btn-primary btn-sm"
              style={{height:38, padding:'0 16px', gap:6, whiteSpace:'nowrap'}}
              onClick={() => {
                const num = newPhone.number.trim();
                if (!num) return;
                const entry = newPhone.name.trim() ? `${newPhone.name.trim()}:${num}` : num;
                const current = settings.staff_notify_phones || '';
                const updated = current ? `${current}, ${entry}` : entry;
                setSettings(s => ({...s, staff_notify_phones: updated}));
                setNewPhone({ name: '', number: '' });
              }}
            >
              <Plus size={14}/> Add
            </button>
          </div>
          <p style={{fontSize:11, color:'var(--text-muted)', marginTop:6}}>Use international format with country code (e.g. +44 for UK). Remember to save after making changes.</p>
        </div>
        <button className="btn btn-primary" style={{marginTop:12}} onClick={saveSettings}><Save size={15}/> {saved ? 'Saved!' : 'Save'}</button>

        <div style={{marginTop:24,paddingTop:20,borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          <label className="form-label">Test Email Notifications</label>
          <p style={{fontSize:12,color:'var(--text-muted)',marginBottom:10}}>Send a test email to verify SMTP is configured correctly. The test email will be sent to the escalation email address.</p>
          <button
            className="btn btn-ghost"
            style={{gap:6}}
            onClick={async () => {
              setTestEmailStatus('sending');
              try {
                const r = await api.testEmail();
                setTestEmailStatus(r.message || 'Test email sent!');
              } catch (e) {
                setTestEmailStatus('Error: ' + e.message);
              }
              setTimeout(() => setTestEmailStatus(''), 8000);
            }}
            disabled={testEmailStatus === 'sending'}
          >
            <Mail size={15}/> {testEmailStatus === 'sending' ? 'Sending...' : 'Send Test Email'}
          </button>
          {testEmailStatus && testEmailStatus !== 'sending' && (
            <p style={{fontSize:12,marginTop:8,color:testEmailStatus.startsWith('Error') ? 'var(--danger)' : 'var(--success)'}}>{testEmailStatus}</p>
          )}
        </div>
      </div></div>}

      {tab === 'email' && <div>
        {emailError && <div style={{padding:12,marginBottom:16,background:'rgba(239,68,68,0.1)',border:'1px solid var(--danger)',borderRadius:8,color:'var(--danger)',fontSize:13}}>{emailError}</div>}

        {/* Connected Accounts */}
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h3>Connected Email Accounts</h3></div>
          {emailAccounts.length > 0 ? (
            <div className="table-container"><table><thead><tr><th>Provider</th><th>Email</th><th>Connected By</th><th>Last Sync</th><th>Status</th><th>Actions</th></tr></thead><tbody>
              {emailAccounts.map(a => (
                <tr key={a.id}>
                  <td><span className="badge" style={{background: a.provider === 'gmail' ? '#ea4335' : '#2196f3', color: '#fff', textTransform:'capitalize'}}>{a.provider}</span></td>
                  <td style={{fontWeight:500}}>{a.email_address}</td>
                  <td style={{fontSize:12,color:'var(--text-secondary)'}}>{a.owner_label || a.connected_by_name || a.connected_by_email || 'Team account'}</td>
                  <td style={{fontSize:12,color:'var(--text-secondary)'}}>{a.last_sync_at ? new Date(a.last_sync_at).toLocaleString('en-GB') : 'Never'}</td>
                  <td>{a.sync_enabled ? <span className="badge badge-resolved">Active</span> : <span className="badge badge-closed">Paused</span>}</td>
                  <td>
                    <div style={{display:'flex',gap:6}}>
                      <button className="btn btn-ghost btn-sm" onClick={()=>triggerSync(a.id)} disabled={!a.can_manage || emailLoading===`sync-${a.id}`} title={a.can_manage ? 'Sync now' : 'Only the connector or an admin can sync this account'}>
                        <RefreshCw size={14} className={emailLoading===`sync-${a.id}`?'spin':''}/>
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>toggleAccount(a.id, !a.sync_enabled)} disabled={!a.can_manage} title={a.can_manage ? (a.sync_enabled?'Pause':'Resume') : 'Only the connector or an admin can manage this account'}>
                        {a.sync_enabled ? <PowerOff size={14}/> : <Power size={14}/>}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>deleteAccount(a.id)} disabled={!a.can_manage} title={a.can_manage ? 'Remove' : 'Only the connector or an admin can remove this account'} style={{color:'var(--danger)'}}><Trash2 size={14}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody></table></div>
          ) : (
            <div className="card-body" style={{textAlign:'center',color:'var(--text-muted)',padding:32}}>No email accounts connected. Connect Gmail or add an IMAP account below.</div>
          )}
        </div>

        {/* Connect Gmail */}
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h3><Mail size={16} style={{verticalAlign:'middle',marginRight:6}}/>Connect Gmail Account</h3></div>
          <div className="card-body">
            <p style={{fontSize:13,color:'var(--text-secondary)',marginBottom:12}}>Connect the Gmail account you are currently logged into. FFR Property OS will keep it synced as a team context source; for admin@52oldelvet.com it will also place suggested replies in Gmail Drafts when a reply is needed.</p>
            <div style={{background:'rgba(99,102,241,0.06)',border:'1px solid rgba(99,102,241,0.15)',borderRadius:8,padding:'12px 14px',marginBottom:14,fontSize:12,color:'var(--text-secondary)',lineHeight:1.5}}>
              <strong style={{color:'var(--text-primary)'}}>Requires on Railway:</strong><br/>
              GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars from <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" style={{color:'var(--accent-light)'}}>Google Cloud Console</a><br/>
              GOOGLE_REDIRECT_URI = https://maintenance.52oldelvet.com/api/email/accounts/gmail/callback
            </div>
            <button className="btn btn-primary" onClick={connectGmail} disabled={emailLoading==='gmail'}>
              <Mail size={15}/> {emailLoading==='gmail' ? 'Connecting...' : 'Connect Gmail Account'}
            </button>
            <p style={{fontSize:11,color:'var(--text-muted)',marginTop:8}}>You'll be redirected to Google to authorise inbox reading and Gmail draft creation.</p>
          </div>
        </div>

        {/* Connect IMAP (Zoho) */}
        <div className="card" style={{marginBottom:16}}>
          <div className="card-header"><h3><Mail size={16} style={{verticalAlign:'middle',marginRight:6}}/>Connect IMAP Account (Zoho Mail)</h3></div>
          <div className="card-body">
            <p style={{fontSize:13,color:'var(--text-secondary)',marginBottom:12}}>Connect info@psb.properties or another IMAP email account as a long-running context source. Pre-configured for Zoho Mail. Use an App Password from Zoho for security.</p>
            <div style={{background:'rgba(99,102,241,0.06)',border:'1px solid rgba(99,102,241,0.15)',borderRadius:8,padding:'12px 14px',marginBottom:14,fontSize:12,color:'var(--text-secondary)',lineHeight:1.5}}>
              <strong style={{color:'var(--text-primary)'}}>Zoho App Password:</strong><br/>
              Go to <a href="https://accounts.zoho.com/home#security/security_pwd" target="_blank" rel="noreferrer" style={{color:'var(--accent-light)'}}>Zoho Account Security</a> &rarr; App Passwords &rarr; Generate new password for "PSB Maintenance Hub"
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div className="form-group"><label className="form-label">Email Address</label>
                <input className="form-input" value={imapForm.email_address} onChange={e=>setImapForm(f=>({...f,email_address:e.target.value}))} placeholder="info@psb.properties"/></div>
              <div className="form-group"><label className="form-label">IMAP Host</label>
                <input className="form-input" value={imapForm.host} onChange={e=>setImapForm(f=>({...f,host:e.target.value}))} placeholder="imap.zoho.com"/></div>
              <div className="form-group"><label className="form-label">Username</label>
                <input className="form-input" value={imapForm.username} onChange={e=>setImapForm(f=>({...f,username:e.target.value}))} placeholder="info@psb.properties"/></div>
              <div className="form-group"><label className="form-label">Zoho App Password</label>
                <input className="form-input" type="password" value={imapForm.password} onChange={e=>setImapForm(f=>({...f,password:e.target.value}))} placeholder="App-specific password from Zoho"/></div>
            </div>
            <button className="btn btn-primary" onClick={connectImap} disabled={emailLoading==='imap'} style={{marginTop:8}}>
              <Mail size={15}/> {emailLoading==='imap' ? 'Testing Connection...' : 'Test & Connect'}
            </button>
          </div>
        </div>

        {/* Sync Log */}
        {syncLog.length > 0 && (
          <div className="card">
            <div className="card-header"><h3>Recent Email Sync Log</h3></div>
            <div className="table-container"><table><thead><tr><th>Time</th><th>Account</th><th>From</th><th>Subject</th><th>Matched Tenant</th><th>Status</th></tr></thead><tbody>
              {syncLog.slice(0, 25).map(l => (
                <tr key={l.id}>
                  <td style={{fontSize:12,color:'var(--text-secondary)',whiteSpace:'nowrap'}}>{new Date(l.processed_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
                  <td style={{fontSize:12}}><span className="badge" style={{background: l.provider === 'gmail' ? '#ea4335' : '#2196f3', color: '#fff', fontSize:10}}>{l.provider}</span></td>
                  <td style={{fontSize:12,maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.from_address}</td>
                  <td style={{fontSize:12,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.subject}</td>
                  <td>{l.tenant_name ? <span style={{color:'var(--accent-light)',fontWeight:500,fontSize:12}}>{l.tenant_name}</span> : <span style={{color:'var(--text-muted)',fontSize:12}}>No match</span>}</td>
                  <td><span className={`badge ${l.status==='issue_created'?'badge-resolved':l.status==='matched'?'badge-in_progress':'badge-closed'}`} style={{fontSize:10}}>{l.status?.replace(/_/g,' ')}</span></td>
                </tr>
              ))}
            </tbody></table></div>
          </div>
        )}
      </div>}

      {tab === 'team' && <div>
        <div className="card" style={{marginBottom:16}}><div className="card-header"><h3>Team Members</h3></div>
          <div className="table-container"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last Login</th></tr></thead><tbody>
            {staff.map(s => <tr key={s.id}><td style={{fontWeight:500}}>{s.name}</td><td>{s.email}</td><td><span className="badge badge-open">{s.role}</span></td><td style={{fontSize:12,color:'var(--text-secondary)'}}>{s.last_login?new Date(s.last_login).toLocaleString('en-GB'):''}</td></tr>)}
          </tbody></table></div>
        </div>
        {user?.role === 'admin' && <div className="card"><div className="card-header"><h3>Add Team Member</h3></div><div className="card-body">
          <div className="settings-add-grid" style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:12,alignItems:'end'}}>
            <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={newStaff.name} onChange={e=>setNewStaff(s=>({...s,name:e.target.value}))}/></div>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={newStaff.email} onChange={e=>setNewStaff(s=>({...s,email:e.target.value}))}/></div>
            <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" value={newStaff.password} onChange={e=>setNewStaff(s=>({...s,password:e.target.value}))}/></div>
            <button className="btn btn-primary" onClick={createStaff} style={{marginBottom:16}}><Plus size={15}/> Add</button>
          </div>
        </div></div>}
      </div>}

      {tab === 'account' && <div className="card"><div className="card-header"><h3>Change Password</h3></div><div className="card-body">
        <div className="form-group"><label className="form-label">Current Password</label><input className="form-input" type="password" value={pwForm.currentPassword} onChange={e=>setPwForm(s=>({...s,currentPassword:e.target.value}))}/></div>
        <div className="form-group"><label className="form-label">New Password</label><input className="form-input" type="password" value={pwForm.newPassword} onChange={e=>setPwForm(s=>({...s,newPassword:e.target.value}))}/></div>
        <button className="btn btn-primary" onClick={changePw}>Change Password</button>
      </div></div>}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { ArrowLeft, Send, FileText, StickyNote, Clock, AlertCircle, Image, HardHat, Copy, Check, X, Trash2 } from 'lucide-react';

export default function IssueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ef, setEf] = useState({});
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [quotes, setQuotes] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [selectedContractor, setSelectedContractor] = useState('');
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [jobBrief, setJobBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefCopied, setBriefCopied] = useState(false);

  const loadQuotes = () => api.getIssueQuotes(id).then(setQuotes).catch(() => {});

  const load = () => api.getIssue(id).then(d => {
    setData(d);
    setEf({ final_cost: d.issue.final_cost ?? '', final_notes: d.issue.final_notes || '', attended_by: d.issue.attended_by || '', resolution_notes: d.issue.resolution_notes || '', resolved_at: d.issue.resolved_at ? d.issue.resolved_at.slice(0,10) : '' });
    if (d.savedReport && !report) setReport(d.savedReport);
  });
  useEffect(() => { load(); loadQuotes(); api.getContractors().then(setContractors).catch(() => {}); }, [id]);
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

  const downloadReport = async () => {
    if (!report) return;
    try {
    const { default: jsPDF } = await import('jspdf');
    const { applyPlugin } = await import('jspdf-autotable');
    applyPlugin(jsPDF);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 18;
    const contentW = pageW - margin * 2;
    let y = 0;

    const COLORS = {
      navy: [26, 26, 46],
      accent: [99, 102, 241],
      accentLight: [139, 92, 246],
      success: [52, 211, 153],
      warning: [251, 191, 36],
      danger: [248, 113, 113],
      darkBg: [15, 15, 30],
      lightBg: [248, 249, 250],
      cardBg: [240, 242, 248],
      text: [30, 30, 50],
      muted: [120, 120, 140],
      white: [255, 255, 255],
    };

    const STATUS_CFG = {
      open: { color: COLORS.accent, emoji: 'o', label: 'OPEN' },
      in_progress: { color: COLORS.warning, emoji: '>', label: 'IN PROGRESS' },
      escalated: { color: COLORS.danger, emoji: '!', label: 'ESCALATED' },
      resolved: { color: COLORS.success, emoji: '+', label: 'RESOLVED' },
      closed: { color: COLORS.muted, emoji: 'x', label: 'CLOSED' },
    };

    const PRIORITY_CFG = {
      urgent: { color: [220, 38, 38], label: 'URGENT' },
      high: { color: [249, 115, 22], label: 'HIGH' },
      medium: { color: [234, 179, 8], label: 'MEDIUM' },
      low: { color: [34, 197, 94], label: 'LOW' },
    };

    const checkPageBreak = (needed) => {
      if (y + needed > pageH - 20) {
        // Footer on current page
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.muted);
        doc.text(`PSB Properties  |  Maintenance Report  |  ${report.issue.uuid}`, pageW / 2, pageH - 10, { align: 'center' });
        doc.addPage();
        y = 18;
      }
    };

    const drawRoundedRect = (x, ry, w, h, r, fillColor) => {
      doc.setFillColor(...fillColor);
      doc.roundedRect(x, ry, w, h, r, r, 'F');
    };

    const drawBadge = (text, x, by, color) => {
      const badgeW = doc.getTextWidth(text) + 8;
      drawRoundedRect(x, by - 4, badgeW, 6.5, 1.5, color);
      doc.setTextColor(...COLORS.white);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text(text, x + 4, by);
      return badgeW + 3;
    };

    // ========= HEADER BANNER =========
    drawRoundedRect(0, 0, pageW, 52, 0, COLORS.navy);
    // Accent stripe
    doc.setFillColor(...COLORS.accent);
    doc.rect(0, 48, pageW, 4, 'F');

    // Logo area
    doc.setFillColor(...COLORS.accent);
    doc.roundedRect(margin, 12, 10, 10, 2, 2, 'F');
    doc.setTextColor(...COLORS.white);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('PSB', margin + 1.5, 19.5);

    // Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Maintenance Issue Report', margin + 14, 17.5);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 200, 220);
    doc.text(`PSB Properties  |  Ref: ${report.issue.uuid}  |  Generated ${new Date(report.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, margin + 14, 23.5);

    // Status & Priority badges in header
    const sc = STATUS_CFG[report.issue.status] || STATUS_CFG.open;
    const pc = PRIORITY_CFG[report.issue.priority] || PRIORITY_CFG.medium;
    doc.setFontSize(7);
    let bx = margin + 14;
    bx += drawBadge(`${sc.emoji}  ${sc.label}`, bx, 31, sc.color);
    bx += drawBadge(pc.label, bx, 31, pc.color);
    if (report.issue.category) {
      bx += drawBadge((report.issue.category || '').toUpperCase().replace(/_/g, ' '), bx, 31, [80, 80, 110]);
    }

    y = 60;

    // ========= ISSUE DETAILS TABLE =========
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.text);
    doc.text('>>  Issue Details', margin, y);
    y += 7;

    const detailRows = [
      ['Property', `${report.issue.property_name || 'Unknown'}${report.issue.property_address ? '  (' + report.issue.property_address + ')' : ''}`],
      ['Tenant', `${report.issue.tenant_name || 'Unknown'}${report.issue.tenant_flat ? '  |  ' + report.issue.tenant_flat : ''}`],
      ['Reported', new Date(report.issue.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })],
    ];
    if (report.issue.escalated_at) detailRows.push(['Escalated', new Date(report.issue.escalated_at).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })]);
    if (report.issue.resolved_at) detailRows.push(['Resolved', new Date(report.issue.resolved_at).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })]);
    if (report.issue.attended_by) detailRows.push(['Attended By', report.issue.attended_by]);

    doc.autoTable({
      startY: y,
      head: [],
      body: detailRows,
      theme: 'plain',
      margin: { left: margin, right: margin },
      columnStyles: {
        0: { cellWidth: 35, fontStyle: 'bold', textColor: COLORS.muted, fontSize: 9 },
        1: { textColor: COLORS.text, fontSize: 9 },
      },
      styles: { cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 }, overflow: 'linebreak' },
      alternateRowStyles: { fillColor: [245, 246, 250] },
      didDrawPage: () => {},
    });

    y = doc.lastAutoTable.finalY + 8;

    // ========= COST ASSESSMENT BOX =========
    checkPageBreak(30);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.text);
    doc.text('GBP  Cost Assessment', margin, y);
    y += 5;

    drawRoundedRect(margin, y, contentW, 22, 3, COLORS.cardBg);

    const estCost = (report.issue.estimated_cost || 0).toFixed(2);
    const actCost = report.issue.final_cost ? report.issue.final_cost.toFixed(2) : null;
    const estHours = (report.issue.estimated_hours || 0).toFixed(1);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.muted);

    const colW = contentW / (actCost ? 3 : 2);
    doc.text('AI Estimated Cost', margin + colW * 0 + 6, y + 7);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.accent);
    doc.text(`\u00A3${estCost}`, margin + colW * 0 + 6, y + 14);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.muted);
    doc.text('Estimated Hours', margin + colW * 1 + 6, y + 7);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.accent);
    doc.text(`${estHours}h`, margin + colW * 1 + 6, y + 14);

    if (actCost) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.muted);
      doc.text('Actual Cost', margin + colW * 2 + 6, y + 7);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.success);
      doc.text(`\u00A3${actCost}`, margin + colW * 2 + 6, y + 14);
    }

    y += 28;

    // ========= AI REPORT SECTIONS =========
    checkPageBreak(20);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.text);
    doc.text('[AI]  AI Analysis Report', margin, y);
    y += 7;

    // Parse report into sections
    const reportText = report.report || '';
    const sectionHeaders = ['SUMMARY', 'DIAGNOSIS', 'ACTIONS TAKEN', 'RECOMMENDATIONS', 'COST ASSESSMENT'];
    const sectionEmojis = { 'SUMMARY': '>>', 'DIAGNOSIS': '>>', 'ACTIONS TAKEN': '+', 'RECOMMENDATIONS': '*', 'COST ASSESSMENT': 'GBP' };
    const sectionColors = { 'SUMMARY': COLORS.accent, 'DIAGNOSIS': [168, 85, 247], 'ACTIONS TAKEN': COLORS.success, 'RECOMMENDATIONS': COLORS.warning, 'COST ASSESSMENT': [34, 211, 238] };

    // Split report text into sections
    let sections = [];
    let remaining = reportText;
    for (let i = 0; i < sectionHeaders.length; i++) {
      const hdr = sectionHeaders[i];
      const patterns = [
        new RegExp(`\\d+\\)\\s*${hdr}[:\\s-]*`, 'i'),
        new RegExp(`${hdr}[:\\s-]*`, 'i'),
      ];
      let idx = -1;
      let matchLen = 0;
      for (const p of patterns) {
        const m = remaining.match(p);
        if (m) { idx = m.index; matchLen = m[0].length; break; }
      }
      if (idx !== -1) {
        // Find the end (next section or end of text)
        let endIdx = remaining.length;
        for (let j = i + 1; j < sectionHeaders.length; j++) {
          const nextPatterns = [
            new RegExp(`\\d+\\)\\s*${sectionHeaders[j]}[:\\s-]*`, 'i'),
            new RegExp(`${sectionHeaders[j]}[:\\s-]*`, 'i'),
          ];
          for (const np of nextPatterns) {
            const nm = remaining.match(np);
            if (nm && nm.index > idx) { endIdx = Math.min(endIdx, nm.index); break; }
          }
        }
        const body = remaining.substring(idx + matchLen, endIdx).trim();
        if (body) sections.push({ title: hdr, body });
      }
    }

    // If no sections parsed, just use the full text
    if (sections.length === 0) {
      sections = [{ title: 'REPORT', body: reportText }];
    }

    for (const section of sections) {
      const lines = doc.splitTextToSize(section.body, contentW - 16);
      const blockH = lines.length * 4.5 + 14;
      checkPageBreak(blockH + 4);

      const sColor = sectionColors[section.title] || COLORS.accent;
      const sEmoji = sectionEmojis[section.title] || '-';

      // Section card background
      drawRoundedRect(margin, y, contentW, blockH, 3, [245, 246, 252]);
      // Left accent bar
      doc.setFillColor(...sColor);
      doc.roundedRect(margin, y, 2.5, blockH, 1, 1, 'F');

      // Section header
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...sColor);
      doc.text(`${sEmoji}  ${section.title}`, margin + 8, y + 7);

      // Section body
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.text);
      doc.text(lines, margin + 8, y + 13);

      y += blockH + 4;
    }

    // ========= CONVERSATION LOG =========
    if (data?.messages?.length > 0) {
      checkPageBreak(20);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.text);
      doc.text(`>>  Conversation Log (${data.messages.length} messages)`, margin, y);
      y += 7;

      const msgRows = data.messages.map(m => {
        const who = m.sender === 'tenant' ? `${report.issue.tenant_name}` : m.sender === 'bot' ? '[AI] Assistant' : `[Staff] ${m.sender}`;
        const time = new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        return [who, (m.content || '[media]').slice(0, 200), time];
      });

      const senderColors = {
        tenant: [232, 245, 233],
        bot: [227, 242, 253],
        staff: [255, 243, 224],
        system: [245, 245, 245],
      };

      doc.autoTable({
        startY: y,
        head: [['From', 'Message', 'Time']],
        body: msgRows,
        margin: { left: margin, right: margin },
        headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontSize: 8, fontStyle: 'bold', cellPadding: 3 },
        bodyStyles: { fontSize: 7.5, textColor: COLORS.text, cellPadding: 2.5, overflow: 'linebreak' },
        columnStyles: {
          0: { cellWidth: 30, fontStyle: 'bold' },
          1: { cellWidth: contentW - 55 },
          2: { cellWidth: 25, textColor: COLORS.muted, fontSize: 7 },
        },
        alternateRowStyles: { fillColor: [248, 249, 255] },
        styles: { lineColor: [230, 230, 240], lineWidth: 0.2 },
        didParseCell: (hookData) => {
          if (hookData.section === 'body' && hookData.column.index === 0) {
            const text = hookData.cell.raw || '';
            if (hookData.row.index < data.messages.length) {
              const sender = data.messages[hookData.row.index]?.sender;
              if (sender === 'tenant') hookData.cell.styles.fillColor = senderColors.tenant;
              else if (sender === 'bot') hookData.cell.styles.fillColor = senderColors.bot;
              else hookData.cell.styles.fillColor = senderColors.staff;
            }
          }
        },
      });

      y = doc.lastAutoTable.finalY + 8;
    }

    // ========= ATTACHED PHOTOS =========
    if (report.attachments?.length > 0) {
      checkPageBreak(20);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.text);
      doc.text(`>>  Attached Photos (${report.attachments.length})`, margin, y);
      y += 7;

      for (const att of report.attachments) {
        try {
          const imgUrl = `${window.location.origin}${att.file_path}`;
          const response = await fetch(imgUrl);
          if (!response.ok) continue;
          const blob = await response.blob();
          const dataUrl = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });

          checkPageBreak(75);

          // Photo frame
          drawRoundedRect(margin, y, contentW, 68, 3, COLORS.cardBg);

          try {
            doc.addImage(dataUrl, 'JPEG', margin + 3, y + 3, 55, 55);
          } catch (imgErr) {
            doc.setFontSize(9);
            doc.setTextColor(...COLORS.muted);
            doc.text('[Image could not be embedded]', margin + 6, y + 30);
          }

          // AI analysis beside the photo
          if (att.ai_analysis) {
            let analysis = att.ai_analysis;
            try {
              const parsed = JSON.parse(analysis.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
              analysis = `Issue: ${parsed.likely_issue || 'Unknown'}\nSeverity: ${parsed.severity || 'Unknown'}\nCategory: ${parsed.category || 'Unknown'}${parsed.safety_concern ? '\n! Safety Concern Identified' : ''}`;
            } catch (e) {
              analysis = (typeof analysis === 'string' ? analysis : '').slice(0, 200);
            }
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...COLORS.accent);
            doc.text('[AI] Photo Analysis', margin + 62, y + 8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...COLORS.text);
            const analysisLines = doc.splitTextToSize(analysis, contentW - 68);
            doc.text(analysisLines, margin + 62, y + 14);
          }

          y += 72;
        } catch (err) {
          console.error('[PDF] Failed to embed image:', err);
        }
      }
    }

    // ========= FOOTER ON LAST PAGE =========
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.muted);
    doc.text(`PSB Properties  |  Maintenance Report  |  ${report.issue.uuid}  |  Page ${doc.internal.getCurrentPageInfo().pageNumber}`, pageW / 2, pageH - 10, { align: 'center' });

    // Add page numbers to all pages
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.muted);
      doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 10, { align: 'right' });
    }

    doc.save(`PSB-Report-${report.issue.uuid}.pdf`);
    } catch (err) {
      console.error('[PDF] Error generating PDF:', err);
      alert('Failed to generate PDF. Please try again.');
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try { await api.addIssueNote(id, noteText); setNoteText(''); await load(); }
    finally { setAddingNote(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteIssue(id);
      navigate('/issues');
    } catch (e) {
      alert('Failed to delete issue: ' + e.message);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const photos = attachments?.filter(a => a.file_type?.startsWith('image')) || [];

  // SLA calculations
  const createdAt = new Date(issue.created_at);
  const firstBotMsg = messages?.find(m => m.sender === 'bot');
  const responseTimeMins = firstBotMsg ? Math.round((new Date(firstBotMsg.created_at) - createdAt) / 60000) : null;
  const resolutionHours = issue.resolved_at ? Math.round((new Date(issue.resolved_at) - createdAt) / 3600000 * 10) / 10 : null;

  return (
    <div className="fade-in">
      <div style={{marginBottom:20,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <Link to="/issues" className="btn btn-ghost btn-sm"><ArrowLeft size={15}/> Back</Link>
        <button className="btn btn-danger btn-sm" onClick={()=>setShowDeleteConfirm(true)} style={{display:'flex',alignItems:'center',gap:4}}><Trash2 size={14}/> Delete Issue</button>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowDeleteConfirm(false)}>
          <div style={{background:'var(--gradient-card)',backdropFilter:'var(--glass-blur)',WebkitBackdropFilter:'var(--glass-blur)',borderRadius:'var(--radius-lg)',padding:28,maxWidth:400,width:'90%',border:'var(--glass-border)',boxShadow:'var(--shadow-lg)'}} onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:'0 0 8px',color:'var(--text-primary)'}}>Delete Issue?</h3>
            <p style={{fontSize:13,color:'var(--text-secondary)',margin:'0 0 8px'}}>
              This will permanently delete issue <strong>{issue.uuid}</strong> ({issue.title}) and all associated messages, photos, notes, and activity logs.
            </p>
            <p style={{fontSize:12,color:'#ef4444',margin:'0 0 20px'}}>This action cannot be undone.</p>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowDeleteConfirm(false)} disabled={deleting}>Cancel</button>
              <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting} style={{display:'flex',alignItems:'center',gap:4}}>
                <Trash2 size={14}/> {deleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

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
            <button className={`tab ${activeTab==='quotes'?'active':''}`} onClick={()=>setActiveTab('quotes')}>Quotes {quotes.length > 0 && `(${quotes.length})`}</button>
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
                    {m.message_type === 'image' && attachments?.find(a => a.message_id === m.id) && (
                      <a href={attachments.find(a => a.message_id === m.id).file_path} target="_blank" rel="noopener noreferrer" style={{display:'inline-block',overflow:'hidden',borderRadius:6,marginBottom:4}}>
                        <img src={attachments.find(a => a.message_id === m.id).file_path} alt="Photo" style={{maxWidth:'100%',maxHeight:200,borderRadius:6,display:'block',transition:'transform 0.2s ease, filter 0.2s ease',cursor:'pointer'}} onMouseEnter={e => { e.target.style.transform='scale(1.03)'; e.target.style.filter='brightness(1.1)'; }} onMouseLeave={e => { e.target.style.transform='scale(1)'; e.target.style.filter='brightness(1)'; }} onError={e => { e.target.style.display='none'; const placeholder = document.createElement('div'); placeholder.style.cssText='width:200px;height:140px;background:var(--bg-input);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted)'; placeholder.textContent='Image unavailable'; e.target.parentNode.appendChild(placeholder); }}/>
                      </a>
                    )}
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
                        <a href={p.file_path} target="_blank" rel="noopener noreferrer" style={{display:'block',overflow:'hidden'}}>
                          <img src={p.file_path} alt="Tenant photo" style={{width:'100%',height:140,objectFit:'cover',display:'block',transition:'transform 0.2s ease, filter 0.2s ease',cursor:'pointer'}} onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }} onMouseEnter={e => { e.target.style.transform='scale(1.05)'; e.target.style.filter='brightness(1.1)'; }} onMouseLeave={e => { e.target.style.transform='scale(1)'; e.target.style.filter='brightness(1)'; }}/>
                          <div style={{height:140,background:'var(--bg-input)',alignItems:'center',justifyContent:'center',fontSize:12,color:'var(--text-muted)',display:'none',flexDirection:'column',gap:6}}><Image size={24} style={{opacity:0.4}}/><span>Image unavailable</span></div>
                        </a>
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
                      <button className="btn btn-primary btn-sm" onClick={downloadReport}><FileText size={14}/> Download PDF Report</button>
                      <button className="btn btn-ghost btn-sm" onClick={generateReport} disabled={reportLoading}>{reportLoading ? 'Regenerating...' : 'Regenerate'}</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quotes tab */}
          {activeTab === 'quotes' && (
            <div className="card" style={{borderRadius:'0 0 8px 8px'}}>
              <div className="card-body">
                {/* Request quote form */}
                <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'flex-end'}}>
                  <div style={{flex:1}}>
                    <label className="form-label">Request Quote</label>
                    <select className="form-select" value={selectedContractor} onChange={e=>setSelectedContractor(e.target.value)}>
                      <option value="">Select contractor...</option>
                      {contractors.filter(c=>c.active).map(c => <option key={c.id} value={c.id}>{c.name} ({c.trade})</option>)}
                    </select>
                  </div>
                  <button className="btn btn-primary" disabled={!selectedContractor||creatingQuote} onClick={async()=>{
                    setCreatingQuote(true);
                    try { await api.createQuote(id, { contractor_id: parseInt(selectedContractor), description: jobBrief || '' }); setSelectedContractor(''); await loadQuotes(); await load(); }
                    catch(e){ alert(e.message); }
                    setCreatingQuote(false);
                  }}>{creatingQuote ? 'Creating...' : 'Request Quote'}</button>
                </div>

                {/* Job brief */}
                <div style={{marginBottom:20}}>
                  <button className="btn btn-secondary btn-sm" onClick={async()=>{
                    setBriefLoading(true);
                    try { const r = await api.generateJobBrief(id); setJobBrief(r.brief); } catch(e){ alert('Failed: '+e.message); }
                    setBriefLoading(false);
                  }} disabled={briefLoading}><HardHat size={14}/> {briefLoading ? 'Generating...' : 'Generate Job Brief'}</button>
                  {jobBrief && (
                    <div style={{marginTop:12,background:'var(--bg-secondary)',borderRadius:8,border:'1px solid var(--border-light)',padding:16}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                        <span style={{fontSize:11,fontWeight:600,color:'var(--text-secondary)',textTransform:'uppercase'}}>Job Brief</span>
                        <div style={{display:'flex',gap:4}}>
                          <button className="btn btn-ghost btn-sm" onClick={()=>{ navigator.clipboard.writeText(jobBrief); setBriefCopied(true); setTimeout(()=>setBriefCopied(false),2000); }}>
                            {briefCopied ? <><Check size={12}/> Copied</> : <><Copy size={12}/> Copy</>}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={()=>setJobBrief(null)}><X size={12}/></button>
                        </div>
                      </div>
                      <pre style={{fontSize:12,color:'var(--text-primary)',whiteSpace:'pre-wrap',lineHeight:1.5,margin:0}}>{jobBrief}</pre>
                    </div>
                  )}
                </div>

                {/* Quote list */}
                {quotes.length === 0 ? (
                  <div className="empty-state"><HardHat size={32}/><h3>No quotes yet</h3><p style={{fontSize:13,color:'var(--text-muted)'}}>Request a quote from a contractor above</p></div>
                ) : quotes.map(q => (
                  <div key={q.id} style={{padding:14,background:'var(--bg-secondary)',borderRadius:8,border:'1px solid var(--border-light)',marginBottom:10}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                      <div>
                        <div style={{fontWeight:500,fontSize:14}}>{q.contractor_name}</div>
                        <div style={{fontSize:11,color:'var(--text-muted)'}}>{q.contractor_trade} {q.contractor_phone ? `| ${q.contractor_phone}` : ''}</div>
                      </div>
                      <span className={`badge badge-${q.status==='completed'?'resolved':q.status==='approved'?'open':q.status==='rejected'?'closed':q.status==='received'?'in_progress':'escalated'}`}>{q.status}</span>
                    </div>
                    {q.amount !== null && <div style={{fontSize:18,fontWeight:600,color:'var(--accent-light)',marginBottom:6}}>{'\u00A3'}{Number(q.amount).toFixed(2)}</div>}

                    {/* Actions based on status */}
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                      {q.status === 'requested' && (
                        <>
                          <div style={{display:'flex',gap:4,alignItems:'center'}}>
                            <input className="form-input" type="number" step="0.01" placeholder="Amount" style={{width:100,fontSize:12,padding:'4px 8px'}} id={`qa-${q.id}`}/>
                            <button className="btn btn-primary btn-sm" onClick={async()=>{
                              const amt = document.getElementById(`qa-${q.id}`).value;
                              if(!amt)return;
                              await api.updateQuote(q.id, { amount: parseFloat(amt), status:'received' });
                              await loadQuotes();
                            }}>Set Amount</button>
                          </div>
                        </>
                      )}
                      {q.status === 'received' && (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={async()=>{ await api.updateQuote(q.id, {status:'approved'}); await loadQuotes(); await load(); }}>Approve</button>
                          <button className="btn btn-danger btn-sm" onClick={async()=>{ await api.updateQuote(q.id, {status:'rejected'}); await loadQuotes(); }}>Reject</button>
                        </>
                      )}
                      {q.status === 'approved' && (
                        <button className="btn btn-primary btn-sm" onClick={async()=>{ await api.updateQuote(q.id, {status:'completed'}); await loadQuotes(); await load(); }}>Mark Completed</button>
                      )}
                    </div>
                    {q.notes && <div style={{fontSize:11,color:'var(--text-muted)',marginTop:6}}>{q.notes}</div>}
                  </div>
                ))}
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

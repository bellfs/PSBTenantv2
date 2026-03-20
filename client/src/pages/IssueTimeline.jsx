import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { Calendar, ChevronLeft, ChevronRight, Filter, AlertCircle, Clock, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

const STATUS_COLORS = {
  open: { bg: 'rgba(99,102,241,0.7)', border: '#6366f1', label: 'Open' },
  in_progress: { bg: 'rgba(251,191,36,0.7)', border: '#fbbf24', label: 'In Progress' },
  escalated: { bg: 'rgba(248,113,113,0.7)', border: '#f87171', label: 'Escalated' },
  resolved: { bg: 'rgba(52,211,153,0.5)', border: '#34d399', label: 'Resolved' },
  closed: { bg: 'rgba(148,163,184,0.4)', border: '#94a3b8', label: 'Closed' }
};

const PRIORITY_COLORS = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e'
};

const STATUS_ICONS = {
  open: AlertCircle,
  in_progress: Clock,
  escalated: AlertTriangle,
  resolved: CheckCircle,
  closed: XCircle
};

function getDaysBetween(start, end) {
  return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
}

function formatDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function IssueTooltip({ issue, position }) {
  const daysOpen = getDaysBetween(new Date(issue.created_at), issue.resolved_at ? new Date(issue.resolved_at) : new Date());
  const StatusIcon = STATUS_ICONS[issue.status] || AlertCircle;
  const statusInfo = STATUS_COLORS[issue.status] || STATUS_COLORS.open;

  return (
    <div style={{
      position: 'fixed',
      left: position.x,
      top: position.y,
      zIndex: 9999,
      background: 'rgba(15,15,30,0.97)',
      border: '1px solid rgba(99,102,241,0.25)',
      borderRadius: 10,
      padding: '14px 18px',
      minWidth: 260,
      maxWidth: 340,
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      pointerEvents: 'none'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          background: statusInfo.bg,
          color: 'white',
          padding: '2px 8px',
          borderRadius: 6,
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 4
        }}>
          <StatusIcon size={10} />
          {statusInfo.label}
        </span>
        <span style={{
          background: PRIORITY_COLORS[issue.priority] || '#eab308',
          color: 'white',
          padding: '2px 8px',
          borderRadius: 6,
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase'
        }}>
          {issue.priority}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{issue.uuid}</span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.3 }}>
        {issue.title || 'Untitled Issue'}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
        {issue.tenant_name && <div>Tenant: <strong style={{ color: 'var(--text-primary)' }}>{issue.tenant_name}</strong></div>}
        {issue.property_name && <div>Property: <strong style={{ color: 'var(--text-primary)' }}>{issue.property_name}</strong></div>}
        {issue.category && <div>Category: <strong style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{issue.category.replace(/_/g, ' ')}</strong></div>}
        {issue.estimated_cost > 0 && <div>Est. cost: <strong style={{ color: 'var(--text-primary)' }}>&pound;{issue.estimated_cost}</strong></div>}
      </div>

      <div style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 11,
        color: 'var(--text-muted)'
      }}>
        <span>Reported: {new Date(issue.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <span style={{
          color: daysOpen > 14 ? 'var(--danger)' : daysOpen > 7 ? 'var(--warning)' : 'var(--text-muted)',
          fontWeight: daysOpen > 7 ? 600 : 400
        }}>
          {issue.resolved_at ? `Resolved in ${daysOpen}d` : `${daysOpen}d open`}
        </span>
      </div>

      {issue.ai_diagnosis && (
        <div style={{
          marginTop: 8,
          padding: '8px 10px',
          background: 'rgba(99,102,241,0.06)',
          borderRadius: 6,
          fontSize: 11,
          color: 'var(--text-secondary)',
          lineHeight: 1.4
        }}>
          AI: {issue.ai_diagnosis.length > 120 ? issue.ai_diagnosis.slice(0, 120) + '...' : issue.ai_diagnosis}
        </div>
      )}
    </div>
  );
}

export default function IssueTimeline({ compact = false }) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewWeeks, setViewWeeks] = useState(compact ? 4 : 8);
  const [offset, setOffset] = useState(0);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.getIssueTimeline().then(data => {
      setIssues(data.issues || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const now = new Date();
  const viewStart = new Date(now);
  viewStart.setDate(viewStart.getDate() - (viewWeeks * 7) - (offset * 7));
  const viewEnd = new Date(viewStart);
  viewEnd.setDate(viewEnd.getDate() + (viewWeeks * 7));
  const totalDays = getDaysBetween(viewStart, viewEnd);

  const filteredIssues = useMemo(() => {
    let filtered = issues.filter(issue => {
      const created = new Date(issue.created_at);
      const ended = issue.resolved_at ? new Date(issue.resolved_at) : now;
      const overlaps = created <= viewEnd && ended >= viewStart;
      if (!overlaps) return false;
      if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
      return true;
    });
    filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return compact ? filtered.slice(0, 15) : filtered;
  }, [issues, statusFilter, viewStart.getTime(), viewEnd.getTime(), compact]);

  const dateColumns = useMemo(() => {
    const cols = [];
    const d = new Date(viewStart);
    while (d <= viewEnd) {
      cols.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return cols;
  }, [viewStart.getTime(), viewEnd.getTime()]);

  const weekMarkers = useMemo(() => {
    const markers = [];
    const d = new Date(viewStart);
    // Align to Monday
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    while (d <= viewEnd) {
      markers.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }
    return markers;
  }, [viewStart.getTime(), viewEnd.getTime()]);

  const handleBarHover = (e, issue) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top - 8;
    // Keep tooltip on screen
    if (x + 170 > window.innerWidth) x = window.innerWidth - 180;
    if (x - 130 < 0) x = 140;
    if (y < 200) y = rect.bottom + 8;
    else y = rect.top - 220;
    setTooltip({ issue, position: { x: x - 130, y } });
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;

  const ROW_HEIGHT = compact ? 28 : 34;
  const LABEL_WIDTH = compact ? 140 : 200;
  const HEADER_HEIGHT = compact ? 48 : 60;

  return (
    <div className={compact ? '' : 'fade-in'}>
      {!compact && (
        <div className="page-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Calendar size={22} style={{ color: 'var(--accent-light)' }} />
            Issue Timeline
          </h2>
          <p>Visual overview of all maintenance issues over time</p>
        </div>
      )}

      {/* Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: compact ? 12 : 16,
        flexWrap: 'wrap'
      }}>
        {!compact && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={14} style={{ color: 'var(--text-muted)' }} />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="form-select"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--text-primary)',
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: 12
              }}
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="escalated">Escalated</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: compact ? 0 : 'auto' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setOffset(o => o + viewWeeks)}
            style={{ padding: '4px 8px' }}
          >
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 120, textAlign: 'center' }}>
            {formatDate(viewStart)} - {formatDate(viewEnd)}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setOffset(o => Math.max(0, o - viewWeeks))}
            style={{ padding: '4px 8px' }}
            disabled={offset === 0}
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {!compact && (
          <div style={{ display: 'flex', gap: 4 }}>
            {[4, 8, 12].map(w => (
              <button
                key={w}
                className={`btn btn-sm ${viewWeeks === w ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setViewWeeks(w)}
                style={{ padding: '4px 10px', fontSize: 11 }}
              >
                {w}w
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      {!compact && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
          {Object.entries(STATUS_COLORS).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: val.bg, border: `1px solid ${val.border}` }} />
              {val.label}
            </div>
          ))}
        </div>
      )}

      {/* Gantt Chart */}
      <div
        ref={containerRef}
        className="card"
        style={{
          overflow: 'auto',
          position: 'relative',
          maxHeight: compact ? 400 : 'calc(100vh - 280px)'
        }}
        onMouseLeave={() => setTooltip(null)}
      >
        <div style={{ minWidth: LABEL_WIDTH + totalDays * (compact ? 14 : 20), position: 'relative' }}>
          {/* Date header */}
          <div style={{
            display: 'flex',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: 'rgba(10,10,24,0.95)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)'
          }}>
            <div style={{
              width: LABEL_WIDTH,
              minWidth: LABEL_WIDTH,
              padding: '12px 14px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderRight: '1px solid rgba(255,255,255,0.06)'
            }}>
              Issue
            </div>
            <div style={{ flex: 1, position: 'relative', height: HEADER_HEIGHT }}>
              {weekMarkers.map((d, i) => {
                const dayOffset = getDaysBetween(viewStart, d);
                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: dayOffset * (compact ? 14 : 20),
                      top: 0,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      paddingLeft: 4
                    }}
                  >
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    {!compact && (
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', whiteSpace: 'nowrap' }}>
                        Wk {Math.ceil((d.getDate()) / 7)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Issue rows */}
          {filteredIssues.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No issues in this date range
            </div>
          ) : (
            filteredIssues.map((issue, idx) => {
              const created = new Date(issue.created_at);
              const ended = issue.resolved_at ? new Date(issue.resolved_at) : now;
              const startDay = Math.max(0, getDaysBetween(viewStart, created));
              const duration = Math.max(1, getDaysBetween(
                created < viewStart ? viewStart : created,
                ended > viewEnd ? viewEnd : ended
              ));
              const statusColor = STATUS_COLORS[issue.status] || STATUS_COLORS.open;
              const isOdd = idx % 2 === 0;

              return (
                <div
                  key={issue.id}
                  style={{
                    display: 'flex',
                    height: ROW_HEIGHT,
                    background: isOdd ? 'transparent' : 'rgba(255,255,255,0.015)',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    transition: 'background 0.15s'
                  }}
                  onClick={() => navigate(`/issues/${issue.id}`)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(99,102,241,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isOdd ? 'transparent' : 'rgba(255,255,255,0.015)';
                  }}
                >
                  {/* Label */}
                  <div style={{
                    width: LABEL_WIDTH,
                    minWidth: LABEL_WIDTH,
                    padding: compact ? '4px 10px' : '6px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderRight: '1px solid rgba(255,255,255,0.04)',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: PRIORITY_COLORS[issue.priority] || '#eab308',
                      flexShrink: 0
                    }} />
                    <span style={{
                      fontSize: compact ? 10 : 12,
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontWeight: 450
                    }}>
                      {issue.title || issue.uuid}
                    </span>
                  </div>

                  {/* Bar area */}
                  <div style={{ flex: 1, position: 'relative' }}>
                    {/* Week gridlines */}
                    {weekMarkers.map((d, i) => {
                      const dayOff = getDaysBetween(viewStart, d);
                      return (
                        <div
                          key={i}
                          style={{
                            position: 'absolute',
                            left: dayOff * (compact ? 14 : 20),
                            top: 0,
                            bottom: 0,
                            width: 1,
                            background: 'rgba(255,255,255,0.03)'
                          }}
                        />
                      );
                    })}

                    {/* Today marker */}
                    {now >= viewStart && now <= viewEnd && (
                      <div style={{
                        position: 'absolute',
                        left: getDaysBetween(viewStart, now) * (compact ? 14 : 20),
                        top: 0,
                        bottom: 0,
                        width: 2,
                        background: 'rgba(99,102,241,0.4)',
                        zIndex: 2
                      }} />
                    )}

                    {/* Issue bar */}
                    <div
                      style={{
                        position: 'absolute',
                        left: startDay * (compact ? 14 : 20),
                        width: Math.max(compact ? 14 : 20, duration * (compact ? 14 : 20)),
                        top: compact ? 5 : 6,
                        height: compact ? 18 : 22,
                        background: statusColor.bg,
                        border: `1px solid ${statusColor.border}`,
                        borderRadius: compact ? 4 : 5,
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: 6,
                        overflow: 'hidden',
                        transition: 'transform 0.1s, box-shadow 0.1s',
                        zIndex: 3
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'scaleY(1.2)';
                        e.currentTarget.style.boxShadow = `0 2px 12px ${statusColor.bg}`;
                        handleBarHover(e, issue);
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'scaleY(1)';
                        e.currentTarget.style.boxShadow = 'none';
                        setTooltip(null);
                      }}
                    >
                      {duration * (compact ? 14 : 20) > 50 && (
                        <span style={{
                          fontSize: compact ? 8 : 9,
                          color: 'white',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                        }}>
                          {issue.uuid}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && <IssueTooltip issue={tooltip.issue} position={tooltip.position} />}

      {compact && filteredIssues.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Link to="/timeline" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>
            View Full Timeline
          </Link>
        </div>
      )}
    </div>
  );
}

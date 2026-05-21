import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../App';
import {
  AlertTriangle,
  ArrowUpRight,
  BedDouble,
  CalendarCheck2,
  CheckCircle,
  Link2,
  MessageSquare,
  Percent,
  PoundSterling,
  RefreshCw,
  Settings,
  Webhook
} from 'lucide-react';

function money(value) {
  const n = Number(value || 0);
  return `£${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

function pct(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function MetricCard({ label, value, sub, icon: Icon, tone = 'info' }) {
  return (
    <div className={`shortlet-metric ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>
      <Icon size={20} />
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="team-empty-line">{children}</div>;
}

export default function ShortLets() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [webhookConfig, setWebhookConfig] = useState(null);
  const [form, setForm] = useState({ account_name: 'FFR Guesty', client_id: '', client_secret: '' });
  const [working, setWorking] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    const [summaryData, accountData, configData] = await Promise.all([
      api.getGuestySummary(),
      api.getGuestyAccounts(),
      api.getGuestyWebhookConfig().catch(() => null)
    ]);
    setSummary(summaryData);
    setAccounts(accountData);
    setWebhookConfig(configData);
  };

  useEffect(() => {
    load().catch(err => setError(err.message));
  }, []);

  const run = async (key, fn, success) => {
    setWorking(key);
    setNotice('');
    setError('');
    try {
      await fn();
      setNotice(success);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking('');
    }
  };

  const connect = async () => {
    if (!form.client_id || !form.client_secret) return;
    await run('connect', () => api.addGuestyAccount(form), 'Guesty account connected.');
    setForm({ account_name: 'FFR Guesty', client_id: '', client_secret: '' });
  };

  const registerWebhook = async () => {
    const account = accounts.find(a => a.sync_enabled) || accounts[0];
    await run('webhook', () => api.registerGuestyWebhook({ account_id: account?.id, events: webhookConfig?.events }), 'Guesty webhook registered.');
  };

  const runOperator = async () => {
    await run('operator', () => api.runAgent('short_let_operator', {
      mode: 'dry_run',
      trigger_type: 'short_lets_dashboard',
      input: {
        request: 'Review Guesty short-let performance, upcoming check-ins/check-outs, gap nights, payment failures, guest messages and webhook events. Produce the best next actions with owners and approval needs.'
      },
      context: {
        source: 'short_lets_dashboard',
        summary
      }
    }), 'Short-Let Operator prepared a dry-run plan.');
  };

  const totals = summary?.totals || {};
  const next30 = totals.next_30 || {};
  const next90 = totals.next_90 || {};
  const last30 = totals.last_30 || {};
  const properties = summary?.properties || [];
  const upcoming = summary?.upcoming || [];
  const recent = summary?.recent || [];
  const alerts = summary?.alerts || [];
  const actions = summary?.suggested_actions || [];

  const bestProperty = useMemo(() => {
    return properties.slice().sort((a, b) => Number(b.revenue_30 || 0) - Number(a.revenue_30 || 0))[0];
  }, [properties]);

  if (!summary && !error) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;
  }

  return (
    <div className="fade-in shortlets-page">
      <div className="page-header shortlets-header">
        <div>
          <h2>Short Lets</h2>
          <p>Guesty performance, reservations, webhooks and operating actions for FFR short-term lets.</p>
        </div>
        <div className="team-hero-actions">
          <button className="btn btn-secondary" onClick={() => run('refresh', load, 'Short-let dashboard refreshed.')} disabled={working === 'refresh'}>
            <RefreshCw size={15} className={working === 'refresh' ? 'spin' : ''} /> Refresh
          </button>
          <button className="btn btn-secondary" onClick={() => run('sync', () => api.syncGuesty(), 'Guesty sync complete.')} disabled={working === 'sync' || !isAdmin}>
            <CalendarCheck2 size={15} /> {working === 'sync' ? 'Syncing' : 'Sync Guesty'}
          </button>
          <button className="btn btn-primary" onClick={runOperator} disabled={working === 'operator'}>
            <BedDouble size={15} /> Run operator
          </button>
        </div>
      </div>

      {(notice || error) && (
        <div className={`team-notice ${error ? 'danger' : 'success'}`}>
          {error ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
          {error || notice}
        </div>
      )}

      <div className="shortlet-metrics">
        <MetricCard label="Occupancy" value={pct(next30.occupancy_pct)} sub="next 30 days" icon={Percent} tone={next30.occupancy_pct >= 70 ? 'success' : 'warning'} />
        <MetricCard label="Booked Revenue" value={money(next30.booked_revenue)} sub="next 30 days" icon={PoundSterling} tone="success" />
        <MetricCard label="Gap Nights" value={next30.gap_nights || 0} sub={`${next90.gap_nights || 0} over 90 days`} icon={CalendarCheck2} tone={next30.gap_nights > 10 ? 'warning' : 'info'} />
        <MetricCard label="ADR" value={money(next30.adr)} sub={`RevPAR ${money(next30.revpar)}`} icon={PoundSterling} tone="info" />
        <MetricCard label="Today" value={`${totals.checkins_today || 0}/${totals.checkouts_today || 0}`} sub="check-ins / check-outs" icon={BedDouble} tone={(totals.checkins_today || totals.checkouts_today) ? 'warning' : 'info'} />
        <MetricCard label="Live Listings" value={totals.listings || 0} sub={summary?.connected ? 'Guesty connected' : 'Guesty not connected'} icon={Link2} tone={summary?.connected ? 'success' : 'danger'} />
      </div>

      {alerts.length > 0 && (
        <section className="shortlet-alerts">
          {alerts.map(alert => (
            <div className={`shortlet-alert ${alert.tone || 'info'}`} key={`${alert.title}-${alert.detail}`}>
              <AlertTriangle size={16} />
              <span><strong>{alert.title}</strong><small>{alert.detail}</small></span>
            </div>
          ))}
        </section>
      )}

      <div className="shortlet-grid">
        <section className="card">
          <div className="card-header">
            <h3>Property Performance</h3>
            <span className="badge badge-open">Next 30 days</span>
          </div>
          <div className="card-body">
            {properties.length === 0 ? <EmptyState>No Guesty listing metrics yet.</EmptyState> : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>Property</th><th>Occ.</th><th>Revenue</th><th>ADR</th><th>Gaps</th></tr>
                  </thead>
                  <tbody>
                    {properties.map(property => (
                      <tr key={`${property.property_id || property.property_name}-${property.sample_listing}`}>
                        <td>
                          <strong>{property.property_name}</strong>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{property.listing_count} listing{Number(property.listing_count) === 1 ? '' : 's'}</div>
                        </td>
                        <td>{pct(property.occupancy_30)}</td>
                        <td>{money(property.revenue_30)}</td>
                        <td>{money(property.adr_30)}</td>
                        <td>{property.gap_nights_30}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Suggested Actions</h3>
            <Link to="/agents" className="btn btn-ghost btn-sm">Tasks <ArrowUpRight size={12} /></Link>
          </div>
          <div className="card-body team-list">
            {actions.length === 0 ? <EmptyState>No short-let actions suggested.</EmptyState> : actions.map(action => (
              <button
                key={action.title}
                className="team-row neutral team-row-button"
                onClick={action.agent_key ? runOperator : undefined}
                disabled={!action.agent_key || working === 'operator'}
              >
                <BedDouble size={15} />
                <span>
                  <strong>{action.title}</strong>
                  <small>{action.detail}</small>
                </span>
                {action.agent_key ? <ArrowUpRight size={14} /> : null}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="shortlet-grid">
        <section className="card">
          <div className="card-header">
            <h3>Upcoming Stays</h3>
            <span className="badge badge-low">{upcoming.length} visible</span>
          </div>
          <div className="card-body team-list">
            {upcoming.length === 0 ? <EmptyState>No upcoming Guesty reservations synced.</EmptyState> : upcoming.slice(0, 8).map(reservation => (
              <div className="team-row neutral" key={reservation.id}>
                <CalendarCheck2 size={15} />
                <span>
                  <strong>{reservation.property_name || reservation.listing_title || reservation.listing_nickname || 'Unlinked listing'}</strong>
                  <small>{dateLabel(reservation.check_in)} to {dateLabel(reservation.check_out)} · {reservation.guest_name || 'Guest'} · {reservation.channel || reservation.source || 'channel unknown'}</small>
                </span>
                <span className="badge badge-open">{reservation.status || 'booking'}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Channel Mix</h3>
            <span className="badge badge-open">Last 30 / next 90</span>
          </div>
          <div className="card-body">
            {(summary?.channels || []).length === 0 ? <EmptyState>No channel data yet.</EmptyState> : summary.channels.map(channel => {
              const max = Math.max(...summary.channels.map(c => Number(c.revenue || 0)), 1);
              const width = (Number(channel.revenue || 0) / max) * 100;
              return (
                <div className="shortlet-channel" key={channel.channel}>
                  <div><strong>{channel.channel}</strong><span>{channel.reservation_count} reservation{Number(channel.reservation_count) === 1 ? '' : 's'} · {money(channel.revenue)}</span></div>
                  <i><b style={{ width: `${width}%` }} /></i>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <h3>Guesty Connection</h3>
          <button className="btn btn-ghost btn-sm" onClick={registerWebhook} disabled={working === 'webhook' || !isAdmin || accounts.length === 0}>
            <Webhook size={13} /> {working === 'webhook' ? 'Registering' : 'Register webhook'}
          </button>
        </div>
        <div className="card-body">
          <div className="shortlet-connection-grid">
            <div>
              <h4><Settings size={15} /> Accounts</h4>
              {accounts.length === 0 ? <EmptyState>No Guesty account configured.</EmptyState> : accounts.map(account => (
                <div className="shortlet-account" key={account.id}>
                  <strong>{account.account_name}</strong>
                  <small>{account.listing_count || 0} listings · {account.reservation_count || 0} reservations · last sync {account.last_sync_at ? new Date(account.last_sync_at).toLocaleString('en-GB') : 'never'}</small>
                  <span className={`badge ${account.sync_enabled ? 'badge-resolved' : 'badge-closed'}`}>{account.sync_enabled ? 'Active' : 'Paused'}</span>
                </div>
              ))}
            </div>
            <div>
              <h4><Webhook size={15} /> Webhook</h4>
              <div className="shortlet-webhook-box">
                <small>Endpoint</small>
                <code>{webhookConfig?.url || 'https://maintenance.52oldelvet.com/api/guesty/webhook'}</code>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10 }}>
                Guesty webhooks feed reservations, guest messages, payment failures, calendar changes and task events into the ledger and Business Memory.
              </p>
            </div>
          </div>

          {isAdmin && (
            <div className="shortlet-connect-form">
              <h4>Connect Guesty API</h4>
              <div className="settings-add-grid">
                <div className="form-group">
                  <label className="form-label">Account name</label>
                  <input className="form-input" value={form.account_name} onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Client ID</label>
                  <input className="form-input" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Client Secret</label>
                  <input className="form-input" type="password" value={form.client_secret} onChange={e => setForm(f => ({ ...f, client_secret: e.target.value }))} />
                </div>
                <button className="btn btn-primary" onClick={connect} disabled={working === 'connect' || !form.client_id || !form.client_secret}>
                  <Link2 size={15} /> Connect
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3>Recent Reservations</h3>
          <span>{bestProperty ? `Top: ${bestProperty.property_name}` : ''}</span>
        </div>
        <div className="card-body">
          {recent.length === 0 ? <EmptyState>No Guesty reservations imported yet.</EmptyState> : (
            <div className="table-container">
              <table>
                <thead><tr><th>Dates</th><th>Property</th><th>Guest</th><th>Channel</th><th>Status</th><th>Revenue</th></tr></thead>
                <tbody>
                  {recent.slice(0, 12).map(reservation => (
                    <tr key={reservation.id}>
                      <td>{dateLabel(reservation.check_in)} to {dateLabel(reservation.check_out)}</td>
                      <td>{reservation.property_name || reservation.listing_title || reservation.listing_nickname || 'Unlinked'}</td>
                      <td>{reservation.guest_name || '-'}</td>
                      <td>{reservation.channel || reservation.source || '-'}</td>
                      <td>{reservation.status || '-'}</td>
                      <td>{money(reservation.total_price || reservation.accommodation_fare || reservation.host_payout)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <div className="team-tool-strip">
        <Link to="/business-memory"><MessageSquare size={16} /> Short-let memory</Link>
        <Link to="/agents"><BedDouble size={16} /> Short-Let Operator</Link>
        <Link to="/dashboard"><PoundSterling size={16} /> Analytics</Link>
      </div>
    </div>
  );
}

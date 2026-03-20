import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../App';
import {
  Landmark, Plus, RefreshCw, Search, Filter, Tag, Building2, ArrowDownLeft, ArrowUpRight,
  TrendingDown, TrendingUp, PoundSterling, Sparkles, X, ChevronDown, ChevronUp,
  Trash2, ToggleLeft, ToggleRight, Wifi, WifiOff, Clock, AlertCircle, CheckCircle
} from 'lucide-react';

const PROVIDER_META = {
  starling: { label: 'Starling Bank', color: '#7C3AED', bg: 'rgba(124,58,237,0.1)' },
  wise: { label: 'Wise', color: '#00B9FF', bg: 'rgba(0,185,255,0.1)' },
  pleo: { label: 'Pleo', color: '#FF6B6B', bg: 'rgba(255,107,107,0.1)' },
};

const CATEGORY_COLORS = {
  plumbing: '#3b82f6', electrical: '#f59e0b', joinery: '#8b5cf6', roofing: '#ef4444',
  cleaning: '#10b981', gardening: '#22c55e', insurance: '#6366f1', council_tax: '#a855f7',
  utilities_gas: '#f97316', utilities_electric: '#eab308', building_materials: '#64748b',
  safety_compliance: '#dc2626', general_maintenance: '#0ea5e9', furnishing: '#d946ef',
  unknown: '#94a3b8', uncategorised: '#94a3b8', transfer: '#475569',
};

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount || 0);
}

function formatCategory(cat) {
  if (!cat) return 'Uncategorised';
  return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function Finance() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [txnTotal, setTxnTotal] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(null);
  const [categorising, setCategorising] = useState(false);

  // Filters
  const [direction, setDirection] = useState('OUT');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [dateRange, setDateRange] = useState('3');
  const [txnPage, setTxnPage] = useState(0);

  // Add account modal
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ provider: 'starling', account_name: '', access_token: '' });

  // Tag modal
  const [tagTxn, setTagTxn] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getFinanceSummary({ months: dateRange }),
      api.getFinanceCategories(),
      api.getProperties(),
      api.getBankAccounts()
    ]).then(([sum, cats, props, accts]) => {
      setSummary(sum);
      setCategories(cats);
      setProperties(props);
      setAccounts(accts);
    }).finally(() => setLoading(false));
  }, [dateRange]);

  const loadTransactions = () => {
    const params = { direction, limit: 50, offset: txnPage * 50 };
    if (search) params.search = search;
    if (categoryFilter) params.category = categoryFilter;
    if (propertyFilter) params.property_id = propertyFilter;
    if (accountFilter) params.account_id = accountFilter;
    if (categoryFilter === '__uncategorised') { delete params.category; params.uncategorised = '1'; }

    // Date range
    const d = new Date();
    params.to = d.toISOString().split('T')[0];
    d.setMonth(d.getMonth() - parseInt(dateRange));
    params.from = d.toISOString().split('T')[0];

    api.getTransactions(params).then(r => {
      setTransactions(r.transactions);
      setTxnTotal(r.total);
    });
  };

  useEffect(() => { if (tab === 'transactions') loadTransactions(); }, [tab, direction, search, categoryFilter, propertyFilter, accountFilter, dateRange, txnPage]);

  const handleSync = async (accountId) => {
    setSyncing(accountId);
    try {
      await api.syncBankAccount(accountId);
      const [sum, accts] = await Promise.all([api.getFinanceSummary({ months: dateRange }), api.getBankAccounts()]);
      setSummary(sum);
      setAccounts(accts);
      if (tab === 'transactions') loadTransactions();
    } catch (e) { alert('Sync failed: ' + e.message); }
    setSyncing(null);
  };

  const handleCategorise = async () => {
    setCategorising(true);
    try {
      const result = await api.categoriseTransactions();
      alert(`AI categorised ${result.categorised} transactions`);
      const sum = await api.getFinanceSummary({ months: dateRange });
      setSummary(sum);
      if (tab === 'transactions') loadTransactions();
    } catch (e) { alert('Categorisation failed: ' + e.message); }
    setCategorising(false);
  };

  const handleAddAccount = async () => {
    if (!addForm.account_name || !addForm.access_token) return;
    try {
      await api.addBankAccount(addForm);
      setShowAdd(false);
      setAddForm({ provider: 'starling', account_name: '', access_token: '' });
      const accts = await api.getBankAccounts();
      setAccounts(accts);
    } catch (e) { alert('Error: ' + e.message); }
  };

  const handleDeleteAccount = async (id) => {
    if (!confirm('Remove this bank account and all its transactions?')) return;
    await api.deleteBankAccount(id);
    const [accts, sum] = await Promise.all([api.getBankAccounts(), api.getFinanceSummary({ months: dateRange })]);
    setAccounts(accts);
    setSummary(sum);
  };

  const handleTagTransaction = async (txnId, data) => {
    await api.updateTransaction(txnId, data);
    setTagTxn(null);
    if (tab === 'transactions') loadTransactions();
    else {
      const sum = await api.getFinanceSummary({ months: dateRange });
      setSummary(sum);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2>Finance</h2>
          <p>Bank feeds, transaction categorisation & spending analysis</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="form-select" value={dateRange} onChange={e => setDateRange(e.target.value)} style={{ width: 'auto' }}>
            <option value="1">Last Month</option>
            <option value="3">Last 3 Months</option>
            <option value="6">Last 6 Months</option>
            <option value="12">Last 12 Months</option>
          </select>
          {summary?.uncategorisedCount > 0 && (
            <button className="btn btn-secondary" onClick={handleCategorise} disabled={categorising}>
              <Sparkles size={14} /> {categorising ? 'Categorising...' : `AI Categorise (${summary.uncategorisedCount})`}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Connect Bank
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="filters-bar" style={{ gap: 4, marginBottom: 16 }}>
        {['overview', 'transactions', 'accounts'].map(t => (
          <button key={t} className={`btn ${tab === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t)}
            style={{ textTransform: 'capitalize', fontSize: 13 }}>
            {t}
          </button>
        ))}
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {tab === 'overview' && summary && (
        <>
          {/* Summary Cards */}
          <div className="stats-grid" style={{ gap: 10, marginBottom: 16 }}>
            <div className="stat-card" style={{ borderLeft: '3px solid var(--danger)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="stat-card-label">Total Outgoings</div>
                  <div className="stat-card-value" style={{ color: 'var(--danger)' }}>{formatCurrency(summary.totalSpend)}</div>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(248,113,113,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <TrendingDown size={18} style={{ color: 'var(--danger)' }} />
                </div>
              </div>
            </div>

            <div className="stat-card" style={{ borderLeft: '3px solid var(--success)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="stat-card-label">Total Income</div>
                  <div className="stat-card-value" style={{ color: 'var(--success)' }}>{formatCurrency(summary.totalIncome)}</div>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(52,211,153,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <TrendingUp size={18} style={{ color: 'var(--success)' }} />
                </div>
              </div>
            </div>

            <div className="stat-card" style={{ borderLeft: '3px solid #f97316', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="stat-card-label">Maintenance Spend</div>
                  <div className="stat-card-value" style={{ color: '#f97316' }}>{formatCurrency(summary.maintenanceSpend)}</div>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(249,115,22,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PoundSterling size={18} style={{ color: '#f97316' }} />
                </div>
              </div>
            </div>

            <div className="stat-card" style={{ borderLeft: '3px solid var(--accent-light)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="stat-card-label">Net Position</div>
                  <div className="stat-card-value" style={{ color: (summary.totalIncome - summary.totalSpend) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {formatCurrency(summary.totalIncome - summary.totalSpend)}
                  </div>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Landmark size={18} style={{ color: 'var(--accent-light)' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Connected Accounts Balances */}
          {summary.accounts?.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {summary.accounts.map(acc => {
                const meta = PROVIDER_META[acc.provider];
                return (
                  <div key={acc.id} style={{
                    flex: '1 1 200px', padding: '12px 16px', borderRadius: 'var(--radius-md)',
                    background: meta.bg, border: `1px solid ${meta.color}22`,
                    display: 'flex', alignItems: 'center', gap: 12
                  }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${meta.color}33` }}>
                      <Landmark size={16} style={{ color: meta.color }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{meta.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: meta.color }}>{acc.balance != null ? formatCurrency(acc.balance) : '--'}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {acc.sync_enabled ? <Wifi size={12} style={{ color: 'var(--success)' }} /> : <WifiOff size={12} style={{ color: 'var(--text-muted)' }} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Charts side by side */}
          <div className="dashboard-perf-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            {/* Spend by Category */}
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-header" style={{ padding: '12px 16px' }}>
                <h3 style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Tag size={15} style={{ color: 'var(--accent-light)' }} />
                  Spend by Category
                </h3>
              </div>
              <div className="card-body" style={{ padding: '12px 16px' }}>
                {summary.byCategory?.length > 0 ? summary.byCategory.slice(0, 10).map((c, i) => {
                  const maxVal = summary.byCategory[0]?.total || 1;
                  const pct = (c.total / maxVal) * 100;
                  const color = CATEGORY_COLORS[c.category] || '#94a3b8';
                  return (
                    <div key={c.category} style={{ marginBottom: i < 9 ? 10 : 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 450 }}>
                          {formatCategory(c.category)}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color }}>{formatCurrency(c.total)}</span>
                      </div>
                      <div style={{ height: 5, background: 'rgba(99,102,241,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  );
                }) : <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>No transactions yet</p>}
              </div>
            </div>

            {/* Spend by Property */}
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-header" style={{ padding: '12px 16px' }}>
                <h3 style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Building2 size={15} style={{ color: 'var(--success)' }} />
                  Spend by Property
                </h3>
              </div>
              <div className="card-body" style={{ padding: '12px 16px' }}>
                {summary.byProperty?.length > 0 ? summary.byProperty.map((p, i) => {
                  const maxVal = summary.byProperty[0]?.total || 1;
                  const pct = (p.total / maxVal) * 100;
                  return (
                    <div key={p.property_id} style={{ marginBottom: i < summary.byProperty.length - 1 ? 10 : 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 450 }}>{p.property_name || 'Untagged'}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)' }}>{formatCurrency(p.total)}</span>
                      </div>
                      <div style={{ height: 5, background: 'rgba(52,211,153,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--gradient-success)', borderRadius: 3, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  );
                }) : <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Tag transactions to see property spend</p>}
              </div>
            </div>
          </div>

          {/* Monthly Trend */}
          {summary.monthlyTrend?.length > 0 && (
            <div className="card">
              <div className="card-header" style={{ padding: '12px 16px' }}>
                <h3 style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TrendingDown size={15} style={{ color: 'var(--danger)' }} />
                  Monthly Trend
                </h3>
              </div>
              <div className="card-body" style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 120 }}>
                  {summary.monthlyTrend.map(m => {
                    const maxSpend = Math.max(...summary.monthlyTrend.map(x => x.spend), 1);
                    const h = (m.spend / maxSpend) * 100;
                    return (
                      <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--danger)' }}>{formatCurrency(m.spend)}</div>
                        <div style={{
                          width: '100%', maxWidth: 60, height: `${h}%`, minHeight: 4,
                          background: 'linear-gradient(180deg, rgba(248,113,113,0.8) 0%, rgba(248,113,113,0.3) 100%)',
                          borderRadius: '4px 4px 0 0'
                        }} />
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>
                          {new Date(m.month + '-01').toLocaleDateString('en-GB', { month: 'short' })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Top Counterparties */}
          {summary.topCounterparties?.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-header" style={{ padding: '12px 16px' }}>
                <h3 style={{ fontSize: 14 }}>Top Payees</h3>
              </div>
              <div className="card-body" style={{ padding: '0 16px 12px' }}>
                <div className="table-scroll-mobile">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Payee</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Total</th>
                        <th style={{ textAlign: 'center', padding: '10px 8px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Txns</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topCounterparties.map(cp => (
                        <tr key={cp.counterparty} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '8px', fontWeight: 500 }}>{cp.counterparty}</td>
                          <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: 'var(--danger)' }}>{formatCurrency(cp.total)}</td>
                          <td style={{ padding: '8px', textAlign: 'center', color: 'var(--text-muted)' }}>{cp.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Empty state if no accounts */}
          {(!summary.accounts || summary.accounts.length === 0) && (
            <div className="empty-state" style={{ marginTop: 24 }}>
              <Landmark size={48} />
              <h3>No bank accounts connected</h3>
              <p>Connect your Starling, Wise, or Pleo accounts to see real transaction data</p>
              <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: 12 }}>
                <Plus size={14} /> Connect Bank Account
              </button>
            </div>
          )}
        </>
      )}

      {/* ===== TRANSACTIONS TAB ===== */}
      {tab === 'transactions' && (
        <>
          <div className="filters-bar" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div className="search-input-wrapper" style={{ minWidth: 200 }}>
              <Search size={15} />
              <input className="form-input" placeholder="Search transactions..." value={search} onChange={e => { setSearch(e.target.value); setTxnPage(0); }} />
            </div>
            <select className="form-select" value={direction} onChange={e => { setDirection(e.target.value); setTxnPage(0); }} style={{ width: 'auto' }}>
              <option value="OUT">Outgoings</option>
              <option value="IN">Income</option>
            </select>
            <select className="form-select" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setTxnPage(0); }} style={{ width: 'auto' }}>
              <option value="">All Categories</option>
              <option value="__uncategorised">Uncategorised</option>
              {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select className="form-select" value={propertyFilter} onChange={e => { setPropertyFilter(e.target.value); setTxnPage(0); }} style={{ width: 'auto' }}>
              <option value="">All Properties</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {accounts.length > 1 && (
              <select className="form-select" value={accountFilter} onChange={e => { setAccountFilter(e.target.value); setTxnPage(0); }} style={{ width: 'auto' }}>
                <option value="">All Accounts</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name} ({PROVIDER_META[a.provider]?.label})</option>)}
              </select>
            )}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            {txnTotal} transaction{txnTotal !== 1 ? 's' : ''} found
          </div>

          <div className="issue-list">
            {transactions.length === 0 ? (
              <div className="empty-state">
                <Landmark size={48} />
                <h3>No transactions found</h3>
                <p>Connect a bank account and sync to see transactions</p>
              </div>
            ) : transactions.map(txn => {
              const catColor = CATEGORY_COLORS[txn.ai_category] || '#94a3b8';
              const provMeta = PROVIDER_META[txn.provider] || {};
              return (
                <div key={txn.id} className="issue-row" style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setTagTxn(txn)}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: txn.direction === 'OUT' ? 'rgba(248,113,113,0.1)' : 'rgba(52,211,153,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}>
                    {txn.direction === 'OUT'
                      ? <ArrowUpRight size={18} style={{ color: 'var(--danger)' }} />
                      : <ArrowDownLeft size={18} style={{ color: 'var(--success)' }} />
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {txn.counterparty || txn.description || txn.reference || 'Unknown'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span>{new Date(txn.date).toLocaleDateString('en-GB')}</span>
                      {txn.reference && <span style={{ opacity: 0.7 }}>{txn.reference.slice(0, 30)}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {txn.ai_category && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                        background: `${catColor}18`, color: catColor
                      }}>
                        {formatCategory(txn.ai_category)}
                      </span>
                    )}
                    {txn.property_name && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 500,
                        background: 'rgba(52,211,153,0.1)', color: 'var(--success)'
                      }}>
                        <Building2 size={10} /> {txn.property_name}
                      </span>
                    )}
                    <span style={{
                      fontSize: 14, fontWeight: 700, minWidth: 80, textAlign: 'right',
                      color: txn.direction === 'OUT' ? 'var(--danger)' : 'var(--success)'
                    }}>
                      {txn.direction === 'OUT' ? '-' : '+'}{formatCurrency(txn.amount)}
                    </span>
                  </div>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: provMeta.color || '#94a3b8', flexShrink: 0
                  }} title={provMeta.label} />
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {txnTotal > 50 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost btn-sm" disabled={txnPage === 0} onClick={() => setTxnPage(p => p - 1)}>Previous</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                Page {txnPage + 1} of {Math.ceil(txnTotal / 50)}
              </span>
              <button className="btn btn-ghost btn-sm" disabled={(txnPage + 1) * 50 >= txnTotal} onClick={() => setTxnPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* ===== ACCOUNTS TAB ===== */}
      {tab === 'accounts' && (
        <div>
          {accounts.length === 0 ? (
            <div className="empty-state">
              <Landmark size={48} />
              <h3>No bank accounts connected</h3>
              <p>Connect Starling, Wise, or Pleo for read-only transaction access</p>
              <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: 12 }}>
                <Plus size={14} /> Connect Account
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {accounts.map(acc => {
                const meta = PROVIDER_META[acc.provider];
                return (
                  <div key={acc.id} className="card" style={{ marginBottom: 0 }}>
                    <div className="card-body" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: 12, background: meta.bg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: `1px solid ${meta.color}33`, flexShrink: 0
                      }}>
                        <Landmark size={22} style={{ color: meta.color }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 150 }}>
                        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{acc.account_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                          <span>{acc.txn_count} transactions</span>
                          {acc.last_sync_at && <span><Clock size={11} /> Last sync: {new Date(acc.last_sync_at).toLocaleString('en-GB')}</span>}
                        </div>
                      </div>
                      {acc.balance != null && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Balance</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: meta.color }}>{formatCurrency(acc.balance)}</div>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleSync(acc.id)} disabled={syncing === acc.id}>
                          <RefreshCw size={13} className={syncing === acc.id ? 'spin' : ''} /> {syncing === acc.id ? 'Syncing...' : 'Sync'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteAccount(acc.id)}
                          style={{ color: 'var(--danger)' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Connect Another Account
            </button>
          </div>

          {/* Setup instructions */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-header" style={{ padding: '12px 16px' }}>
              <h3 style={{ fontSize: 14 }}>How to Connect</h3>
            </div>
            <div className="card-body" style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
              <div style={{ marginBottom: 16 }}>
                <strong style={{ color: PROVIDER_META.starling.color }}>Starling Bank</strong>
                <p style={{ margin: '4px 0' }}>1. Log into Starling Developer Portal &rarr; Create Personal Access Token</p>
                <p style={{ margin: '4px 0' }}>2. Select read-only scopes: account:read, balance:read, transaction:read</p>
                <p style={{ margin: '4px 0' }}>3. Copy the token and paste it below</p>
              </div>
              <div style={{ marginBottom: 16 }}>
                <strong style={{ color: PROVIDER_META.wise.color }}>Wise</strong>
                <p style={{ margin: '4px 0' }}>1. Go to Wise Settings &rarr; API tokens</p>
                <p style={{ margin: '4px 0' }}>2. Create a read-only API token for your business profile</p>
                <p style={{ margin: '4px 0' }}>3. Copy the token and paste it below</p>
              </div>
              <div>
                <strong style={{ color: PROVIDER_META.pleo.color }}>Pleo</strong>
                <p style={{ margin: '4px 0' }}>1. Contact Pleo support or use Pleo API portal to generate an API key</p>
                <p style={{ margin: '4px 0' }}>2. Request read-only access to expenses</p>
                <p style={{ margin: '4px 0' }}>3. Copy the token and paste it below</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== ADD ACCOUNT MODAL ===== */}
      {showAdd && (
        <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700 }}>Connect Bank Account</h3>
            <div className="form-group">
              <label className="form-label">Provider</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['starling', 'wise', 'pleo'].map(p => {
                  const meta = PROVIDER_META[p];
                  return (
                    <button key={p} className={`btn ${addForm.provider === p ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setAddForm({ ...addForm, provider: p })}
                      style={addForm.provider === p ? { background: meta.color, borderColor: meta.color } : {}}>
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Account Name</label>
              <input className="form-input" placeholder="e.g. PSB Business Account" value={addForm.account_name}
                onChange={e => setAddForm({ ...addForm, account_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">API Token / Access Token</label>
              <input className="form-input" type="password" placeholder="Paste your read-only API token..."
                value={addForm.access_token}
                onChange={e => setAddForm({ ...addForm, access_token: e.target.value })} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Read-only access only. We never make payments or modify your account.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddAccount}
                disabled={!addForm.account_name || !addForm.access_token}>
                Connect Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TAG TRANSACTION MODAL ===== */}
      {tagTxn && (
        <TagModal
          txn={tagTxn}
          categories={categories}
          properties={properties}
          onClose={() => setTagTxn(null)}
          onSave={handleTagTransaction}
        />
      )}
    </div>
  );
}

function TagModal({ txn, categories, properties, onClose, onSave }) {
  const [category, setCategory] = useState(txn.ai_category || '');
  const [propertyId, setPropertyId] = useState(txn.property_id || '');
  const [notes, setNotes] = useState(txn.notes || '');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3 style={{ marginBottom: 4, fontSize: 16, fontWeight: 700 }}>Tag Transaction</h3>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          {txn.counterparty || txn.description} &bull; {new Date(txn.date).toLocaleDateString('en-GB')} &bull;{' '}
          <span style={{ color: txn.direction === 'OUT' ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
            {txn.direction === 'OUT' ? '-' : '+'}{formatCurrency(txn.amount)}
          </span>
        </div>

        <div className="form-group">
          <label className="form-label">Category</label>
          <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Uncategorised</option>
            {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Property</label>
          <select className="form-select" value={propertyId} onChange={e => setPropertyId(e.target.value)}>
            <option value="">Not tagged to a property</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <input className="form-input" placeholder="Optional notes..." value={notes}
            onChange={e => setNotes(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(txn.id, {
            ai_category: category || null,
            property_id: propertyId || null,
            notes: notes || null
          })}>
            Save Tags
          </button>
        </div>
      </div>
    </div>
  );
}

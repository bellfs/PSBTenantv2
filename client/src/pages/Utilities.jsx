import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import { Zap, Flame, Save, AlertTriangle, TrendingUp, PoundSterling, BarChart3, Settings, ClipboardList, RefreshCw, ChevronDown, Plus, Trash2, CheckCircle, Hash } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line, Legend, PieChart, Pie, Cell
} from 'recharts';

const MONTH_NAMES = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const GAS_COLOR = '#f59e0b';
const ELEC_COLOR = '#6366f1';
const DANGER_COLOR = '#ef4444';

const OLD_ELVET_APARTMENTS = [
  'Landlord Supply', 'The Villiers', 'The Barrington', 'The Egerton', 'The Wolsey',
  'The Tunstall', 'The Montague', 'The Morton', 'The Gray',
  'The Langley', 'The Kirkham', 'The Fordham', 'The Talbot Penthouse'
];

const tooltipStyle = { background: '#16161f', border: '1px solid #2a2a3a', borderRadius: 8, color: '#f0f0f5' };
const tickStyle = { fill: '#8888a0', fontSize: 11 };

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  const bg = type === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(52,211,153,0.12)';
  const border = type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(52,211,153,0.3)';
  const color = type === 'error' ? 'var(--danger)' : 'var(--success)';
  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 9999, padding: '14px 20px',
      background: bg, border: `1px solid ${border}`, borderRadius: 10,
      color, fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)', animation: 'fadeIn 0.2s ease'
    }}>
      {type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
      {message}
    </div>
  );
}

export default function Utilities() {
  const [tab, setTab] = useState('readings');
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Readings tab state
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [selectedApartment, setSelectedApartment] = useState('');
  const [readingMonth, setReadingMonth] = useState(new Date().getMonth() + 1);
  const [readingYear, setReadingYear] = useState(new Date().getFullYear());
  const [gasReading, setGasReading] = useState('');
  const [gasUsage, setGasUsage] = useState('');
  const [elecReading, setElecReading] = useState('');
  const [elecUsage, setElecUsage] = useState('');
  const [recentReadings, setRecentReadings] = useState([]);
  const [rates, setRates] = useState({ current: {} });
  const [saving, setSaving] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkMonth, setBulkMonth] = useState(new Date().getMonth() + 1);
  const [bulkYear, setBulkYear] = useState(new Date().getFullYear());
  const [bulkData, setBulkData] = useState([]);
  const [bulkSaving, setBulkSaving] = useState(false);

  // Dashboard tab state
  const [dashYear, setDashYear] = useState(new Date().getFullYear());
  const [analytics, setAnalytics] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [fairUsage, setFairUsage] = useState([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Meter refs tab state
  const [meterRefs, setMeterRefs] = useState([]);
  const [meterRefsLoading, setMeterRefsLoading] = useState(false);

  // Rates tab state
  const [allRates, setAllRates] = useState({ rates: [], current: {}, byProperty: {} });
  const [rateForm, setRateForm] = useState({ rate_type: 'gas_unit_rate', rate_value: '', effective_from: new Date().toISOString().split('T')[0], notes: '', property_id: '', property_name: '' });
  const [rateViewProperty, setRateViewProperty] = useState('');  // '' = global, 'propId:propName' = specific
  const [fairUsageLimits, setFairUsageLimits] = useState([]);
  const [rateSaving, setRateSaving] = useState(false);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  // Initial data load
  useEffect(() => {
    Promise.all([
      api.getProperties(),
      api.getUtilityRates()
    ]).then(([props, r]) => {
      setProperties(props);
      setRates(r);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Load readings when property/month/year changes
  useEffect(() => {
    if (selectedPropertyId) {
      const params = { year: readingYear, property_id: selectedPropertyId };
      if (selectedApartment) params.property_name = selectedApartment;
      api.getUtilityReadings(params).then(setRecentReadings).catch(() => {});
    }
  }, [selectedPropertyId, selectedApartment, readingYear]);

  // Load analytics data when dashboard tab is active
  useEffect(() => {
    if (tab === 'dashboard' || tab === 'analytics') {
      setAnalyticsLoading(true);
      Promise.all([
        api.getUtilityAnalytics(dashYear),
        api.getUtilityAlerts(dashYear),
        api.getUtilityFairUsage()
      ]).then(([a, al, fu]) => {
        setAnalytics(a);
        setAlerts(al);
        setFairUsage(fu);
        setAnalyticsLoading(false);
      }).catch(() => setAnalyticsLoading(false));
    }
  }, [tab, dashYear]);

  // Load meter refs tab data
  useEffect(() => {
    if (tab === 'meters') {
      setMeterRefsLoading(true);
      api.getUtilityMeterRefs().then(refs => {
        setMeterRefs(refs);
        setMeterRefsLoading(false);
      }).catch(() => setMeterRefsLoading(false));
    }
  }, [tab]);

  // Load rates tab data
  useEffect(() => {
    if (tab === 'rates') {
      Promise.all([
        api.getUtilityRates(),
        api.getUtilityFairUsage()
      ]).then(([r, fu]) => {
        setAllRates(r);
        setFairUsageLimits(fu);
      }).catch(() => {});
    }
  }, [tab]);

  const selectedProperty = properties.find(p => p.id === parseInt(selectedPropertyId));
  const isOldElvet = selectedProperty?.name?.toLowerCase().includes('old elvet') || selectedProperty?.name?.toLowerCase().includes('52 old');

  const gasCost = gasUsage && rates.current.gas_unit_rate
    ? (parseFloat(gasUsage) * parseFloat(rates.current.gas_unit_rate)).toFixed(2) : '';
  const elecCost = elecUsage && rates.current.electric_unit_rate
    ? (parseFloat(elecUsage) * parseFloat(rates.current.electric_unit_rate)).toFixed(2) : '';

  // Save individual reading
  const saveReading = async () => {
    if (!selectedPropertyId || !readingMonth || !readingYear) {
      showToast('Please select a property, month, and year', 'error');
      return;
    }
    setSaving(true);
    try {
      const readings = [];
      if (gasUsage || gasReading) {
        readings.push({
          property_id: parseInt(selectedPropertyId),
          property_name: selectedApartment || selectedProperty?.name || '',
          meter_type: 'gas',
          month: readingMonth,
          year: readingYear,
          reading: gasReading ? parseFloat(gasReading) : null,
          usage_kwh: gasUsage ? parseFloat(gasUsage) : 0,
          cost: gasCost ? parseFloat(gasCost) : 0
        });
      }
      if (elecUsage || elecReading) {
        readings.push({
          property_id: parseInt(selectedPropertyId),
          property_name: selectedApartment || selectedProperty?.name || '',
          meter_type: 'electric',
          month: readingMonth,
          year: readingYear,
          reading: elecReading ? parseFloat(elecReading) : null,
          usage_kwh: elecUsage ? parseFloat(elecUsage) : 0,
          cost: elecCost ? parseFloat(elecCost) : 0
        });
      }
      if (readings.length === 0) {
        showToast('Please enter at least one reading', 'error');
        setSaving(false);
        return;
      }
      for (const r of readings) {
        await api.saveUtilityReading(r);
      }
      showToast(`${readings.length} reading(s) saved successfully`);
      setGasReading(''); setGasUsage(''); setElecReading(''); setElecUsage('');
      // Refresh readings
      const params = { year: readingYear, property_id: selectedPropertyId };
      if (selectedApartment) params.property_name = selectedApartment;
      api.getUtilityReadings(params).then(setRecentReadings).catch(() => {});
    } catch (e) {
      showToast(e.message || 'Failed to save reading', 'error');
    }
    setSaving(false);
  };

  // Initialize bulk data
  const initBulkData = useCallback(() => {
    const rows = [];
    for (const prop of properties) {
      if (prop.name?.toLowerCase().includes('old elvet') || prop.name?.toLowerCase().includes('52 old')) {
        for (const apt of OLD_ELVET_APARTMENTS) {
          rows.push({ property_id: prop.id, property_name: apt, gas_usage: '', gas_reading: '', elec_usage: '', elec_reading: '', gas_cost: '', elec_cost: '' });
        }
      } else {
        rows.push({ property_id: prop.id, property_name: prop.name || '', gas_usage: '', gas_reading: '', elec_usage: '', elec_reading: '', gas_cost: '', elec_cost: '' });
      }
    }
    setBulkData(rows);
  }, [properties]);

  useEffect(() => {
    if (bulkMode && properties.length > 0 && bulkData.length === 0) {
      initBulkData();
    }
  }, [bulkMode, properties, bulkData.length, initBulkData]);

  const updateBulkRow = (idx, field, value) => {
    setBulkData(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      // Auto-calculate costs
      if (field === 'gas_usage' && rates.current.gas_unit_rate) {
        updated[idx].gas_cost = value ? (parseFloat(value) * parseFloat(rates.current.gas_unit_rate)).toFixed(2) : '';
      }
      if (field === 'elec_usage' && rates.current.electric_unit_rate) {
        updated[idx].elec_cost = value ? (parseFloat(value) * parseFloat(rates.current.electric_unit_rate)).toFixed(2) : '';
      }
      return updated;
    });
  };

  const saveBulkReadings = async () => {
    const readings = [];
    for (const row of bulkData) {
      if (row.gas_usage || row.gas_reading) {
        readings.push({
          property_id: row.property_id, property_name: row.property_name, meter_type: 'gas',
          month: bulkMonth, year: bulkYear,
          reading: row.gas_reading ? parseFloat(row.gas_reading) : null,
          usage_kwh: row.gas_usage ? parseFloat(row.gas_usage) : 0,
          cost: row.gas_cost ? parseFloat(row.gas_cost) : 0
        });
      }
      if (row.elec_usage || row.elec_reading) {
        readings.push({
          property_id: row.property_id, property_name: row.property_name, meter_type: 'electric',
          month: bulkMonth, year: bulkYear,
          reading: row.elec_reading ? parseFloat(row.elec_reading) : null,
          usage_kwh: row.elec_usage ? parseFloat(row.elec_usage) : 0,
          cost: row.elec_cost ? parseFloat(row.elec_cost) : 0
        });
      }
    }
    if (readings.length === 0) { showToast('No readings to save', 'error'); return; }
    setBulkSaving(true);
    try {
      const result = await api.saveUtilityReadingsBulk(readings);
      showToast(`${result.count} readings saved successfully`);
      initBulkData();
    } catch (e) {
      showToast(e.message || 'Failed to save bulk readings', 'error');
    }
    setBulkSaving(false);
  };

  // Save rate
  const saveRate = async () => {
    if (!rateForm.rate_value) { showToast('Please enter a rate value', 'error'); return; }
    setRateSaving(true);
    try {
      await api.saveUtilityRate(rateForm);
      showToast('Rate saved successfully');
      const r = await api.getUtilityRates();
      setAllRates(r);
      setRates(r);
      setRateForm(prev => ({ ...prev, rate_value: '', notes: '' }));
    } catch (e) {
      showToast(e.message || 'Failed to save rate', 'error');
    }
    setRateSaving(false);
  };

  // Save fair usage limit
  const saveFairUsageLimit = async (propertyId, meterType, limitKwh) => {
    try {
      await api.saveUtilityFairUsage({ property_id: propertyId, meter_type: meterType, monthly_limit_kwh: parseFloat(limitKwh) || 0 });
      showToast('Fair usage limit updated');
      const fu = await api.getUtilityFairUsage();
      setFairUsageLimits(fu);
    } catch (e) {
      showToast(e.message || 'Failed to save limit', 'error');
    }
  };

  // Check overusage
  const checkOverusage = async () => {
    try {
      const result = await api.checkUtilityOverusage(dashYear === new Date().getFullYear() ? new Date().getMonth() + 1 : 12, dashYear);
      if (result.alerts_created > 0) {
        showToast(`${result.alerts_created} overusage alert(s) created`);
        const al = await api.getUtilityAlerts(dashYear);
        setAlerts(al);
      } else {
        showToast('No overusage detected');
      }
    } catch (e) {
      showToast(e.message || 'Failed to check overusage', 'error');
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>;

  // Prepare analytics chart data
  const monthlyChartData = [];
  const cumulativeChartData = [];
  const propertyChartData = [];
  const yoyChartData = [];
  const projectionChartData = [];
  let totals = { gas_cost: 0, electric_cost: 0, total_cost: 0, gas_usage: 0, electric_usage: 0 };
  let mostExpensive = null;

  if (analytics) {
    // Monthly spend by type
    const monthlyMap = {};
    for (const row of analytics.monthlyTrends || []) {
      if (!monthlyMap[row.month]) monthlyMap[row.month] = { month: MONTH_SHORT[row.month], gas_cost: 0, electric_cost: 0, gas_kwh: 0, electric_kwh: 0 };
      if (row.meter_type === 'gas') { monthlyMap[row.month].gas_cost = row.total_cost; monthlyMap[row.month].gas_kwh = row.total_kwh; }
      if (row.meter_type === 'electric') { monthlyMap[row.month].electric_cost = row.total_cost; monthlyMap[row.month].electric_kwh = row.total_kwh; }
    }
    for (let m = 1; m <= 12; m++) {
      if (monthlyMap[m]) monthlyChartData.push(monthlyMap[m]);
    }

    // Cumulative
    for (const row of analytics.cumulativeData || []) {
      cumulativeChartData.push({ month: MONTH_SHORT[row.month], total: row.cumulative_total, gas: row.cumulative_gas, electric: row.cumulative_electric });
    }

    // Property comparison
    for (const row of analytics.propertyTotals || []) {
      propertyChartData.push({ name: row.display_name || 'Unknown', gas: row.total_gas_cost || 0, electric: row.total_electric_cost || 0, total: row.total_cost || 0 });
    }

    // YoY
    for (const row of analytics.yoyComparison || []) {
      if (row.current_year_cost > 0 || row.prev_year_cost > 0) {
        yoyChartData.push({ month: MONTH_SHORT[row.month], current: row.current_year_cost, previous: row.prev_year_cost });
      }
    }

    // Projections - combine actual monthly totals with projected
    const actualMonthly = {};
    for (const row of analytics.monthlyTrends || []) {
      if (!actualMonthly[row.month]) actualMonthly[row.month] = 0;
      actualMonthly[row.month] += row.total_cost;
    }
    for (let m = 1; m <= 12; m++) {
      if (actualMonthly[m]) projectionChartData.push({ month: MONTH_SHORT[m], actual: actualMonthly[m] });
    }
    for (const row of analytics.projections || []) {
      projectionChartData.push({ month: MONTH_SHORT[row.month], projected: row.projected_cost });
    }

    // Totals from spend breakdown
    for (const row of analytics.spendBreakdown || []) {
      if (row.meter_type === 'gas') { totals.gas_cost = row.total_cost; totals.gas_usage = row.total_kwh; }
      if (row.meter_type === 'electric') { totals.electric_cost = row.total_cost; totals.electric_usage = row.total_kwh; }
    }
    totals.total_cost = totals.gas_cost + totals.electric_cost;

    if (analytics.expensiveMonths?.length > 0) {
      mostExpensive = analytics.expensiveMonths[0];
    }
  }

  const leaderboard = analytics?.leaderboard || [];
  const maxLeaderboardKwh = leaderboard.length > 0 ? Math.max(...leaderboard.map(l => l.total_kwh || 0)) : 1;

  const tabConfig = [
    ['readings', 'Meter Readings', <ClipboardList size={15} key="r" />],
    ['dashboard', 'Usage Dashboard', <BarChart3 size={15} key="d" />],
    ['analytics', 'Analytics & Charts', <TrendingUp size={15} key="a" />],
    ['meters', 'Meter Numbers', <Hash size={15} key="m" />],
    ['rates', 'Rates & Settings', <Settings size={15} key="s" />]
  ];

  return (
    <div className="fade-in">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #f59e0b 0%, #6366f1 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(245,158,11,0.3)'
          }}>
            <Zap size={18} style={{ color: 'white' }} />
          </div>
          <div>
            <h2>Utilities Management</h2>
            <p>Meter readings, usage tracking, and energy analytics</p>
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabConfig.map(([t, label, icon]) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {icon} {label}
            {t === 'dashboard' && alerts.length > 0 && (
              <span style={{
                background: DANGER_COLOR, color: '#fff', borderRadius: 10, padding: '1px 7px',
                fontSize: 10, fontWeight: 700, marginLeft: 4
              }}>{alerts.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ===== TAB 1: METER READINGS ===== */}
      {tab === 'readings' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className={`btn ${!bulkMode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setBulkMode(false)} style={{ fontSize: 13 }}>Single Entry</button>
            <button className={`btn ${bulkMode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setBulkMode(true)} style={{ fontSize: 13 }}>Bulk Input</button>
          </div>

          {!bulkMode ? (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header"><h3>Input Meter Reading</h3></div>
                <div className="card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                    <div className="form-group">
                      <label className="form-label">Property</label>
                      <select className="form-input" value={selectedPropertyId} onChange={e => { setSelectedPropertyId(e.target.value); setSelectedApartment(''); }}>
                        <option value="">Select property...</option>
                        {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    {isOldElvet && (
                      <div className="form-group">
                        <label className="form-label">Apartment</label>
                        <select className="form-input" value={selectedApartment} onChange={e => setSelectedApartment(e.target.value)}>
                          <option value="">Select apartment...</option>
                          {OLD_ELVET_APARTMENTS.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="form-group">
                      <label className="form-label">Month</label>
                      <select className="form-input" value={readingMonth} onChange={e => setReadingMonth(parseInt(e.target.value))}>
                        {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Year</label>
                      <select className="form-input" value={readingYear} onChange={e => setReadingYear(parseInt(e.target.value))}>
                        {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {/* Gas */}
                    <div style={{ padding: 16, borderRadius: 10, background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.12)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                        <Flame size={16} style={{ color: GAS_COLOR }} />
                        <span style={{ fontWeight: 600, color: GAS_COLOR, fontSize: 14 }}>Gas</span>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Meter Reading</label>
                        <input className="form-input" type="number" value={gasReading} onChange={e => setGasReading(e.target.value)} placeholder="e.g. 12345" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Usage (kWh)</label>
                        <input className="form-input" type="number" value={gasUsage} onChange={e => setGasUsage(e.target.value)} placeholder="e.g. 450" />
                      </div>
                      {gasCost && (
                        <div style={{ fontSize: 13, color: GAS_COLOR, fontWeight: 600, marginTop: 4 }}>
                          Estimated Cost: &pound;{gasCost}
                        </div>
                      )}
                    </div>

                    {/* Electric */}
                    <div style={{ padding: 16, borderRadius: 10, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.12)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                        <Zap size={16} style={{ color: ELEC_COLOR }} />
                        <span style={{ fontWeight: 600, color: ELEC_COLOR, fontSize: 14 }}>Electric</span>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Meter Reading</label>
                        <input className="form-input" type="number" value={elecReading} onChange={e => setElecReading(e.target.value)} placeholder="e.g. 67890" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Usage (kWh)</label>
                        <input className="form-input" type="number" value={elecUsage} onChange={e => setElecUsage(e.target.value)} placeholder="e.g. 320" />
                      </div>
                      {elecCost && (
                        <div style={{ fontSize: 13, color: ELEC_COLOR, fontWeight: 600, marginTop: 4 }}>
                          Estimated Cost: &pound;{elecCost}
                        </div>
                      )}
                    </div>
                  </div>

                  <button className="btn btn-primary" style={{ marginTop: 16, gap: 6 }} onClick={saveReading} disabled={saving}>
                    <Save size={15} /> {saving ? 'Saving...' : 'Save Reading'}
                  </button>
                </div>
              </div>

              {/* Recent readings table */}
              {selectedPropertyId && recentReadings.length > 0 && (
                <div className="card">
                  <div className="card-header"><h3>Recent Readings - {selectedApartment || selectedProperty?.name}</h3></div>
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr><th>Month</th><th>Type</th><th>Reading</th><th>Usage (kWh)</th><th>Cost</th></tr>
                      </thead>
                      <tbody>
                        {recentReadings.map((r, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 500 }}>{MONTH_NAMES[r.month]} {r.year}</td>
                            <td>
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                color: r.meter_type === 'gas' ? GAS_COLOR : ELEC_COLOR, fontWeight: 500, fontSize: 13
                              }}>
                                {r.meter_type === 'gas' ? <Flame size={13} /> : <Zap size={13} />}
                                {r.meter_type}
                              </span>
                            </td>
                            <td>{r.reading || '-'}</td>
                            <td>{r.usage_kwh ? r.usage_kwh.toFixed(1) : '-'}</td>
                            <td style={{ fontWeight: 600 }}>{r.cost ? `\u00A3${Number(r.cost).toFixed(2)}` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Bulk input mode */
            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>Bulk Input - {MONTH_NAMES[bulkMonth]} {bulkYear}</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select className="form-input" style={{ width: 'auto', fontSize: 12 }} value={bulkMonth} onChange={e => setBulkMonth(parseInt(e.target.value))}>
                    {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                  <select className="form-input" style={{ width: 'auto', fontSize: 12 }} value={bulkYear} onChange={e => setBulkYear(parseInt(e.target.value))}>
                    {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Property</th>
                      <th style={{ color: GAS_COLOR }}>Gas Reading</th>
                      <th style={{ color: GAS_COLOR }}>Gas kWh</th>
                      <th style={{ color: GAS_COLOR }}>Gas Cost</th>
                      <th style={{ color: ELEC_COLOR }}>Elec Reading</th>
                      <th style={{ color: ELEC_COLOR }}>Elec kWh</th>
                      <th style={{ color: ELEC_COLOR }}>Elec Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkData.map((row, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap' }}>{row.property_name}</td>
                        <td><input className="form-input" type="number" value={row.gas_reading} onChange={e => updateBulkRow(idx, 'gas_reading', e.target.value)} style={{ fontSize: 12, padding: '6px 8px' }} /></td>
                        <td><input className="form-input" type="number" value={row.gas_usage} onChange={e => updateBulkRow(idx, 'gas_usage', e.target.value)} style={{ fontSize: 12, padding: '6px 8px' }} /></td>
                        <td style={{ fontSize: 12, color: GAS_COLOR, fontWeight: 500 }}>{row.gas_cost ? `\u00A3${row.gas_cost}` : ''}</td>
                        <td><input className="form-input" type="number" value={row.elec_reading} onChange={e => updateBulkRow(idx, 'elec_reading', e.target.value)} style={{ fontSize: 12, padding: '6px 8px' }} /></td>
                        <td><input className="form-input" type="number" value={row.elec_usage} onChange={e => updateBulkRow(idx, 'elec_usage', e.target.value)} style={{ fontSize: 12, padding: '6px 8px' }} /></td>
                        <td style={{ fontSize: 12, color: ELEC_COLOR, fontWeight: 500 }}>{row.elec_cost ? `\u00A3${row.elec_cost}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-body" style={{ paddingTop: 12 }}>
                <button className="btn btn-primary" onClick={saveBulkReadings} disabled={bulkSaving} style={{ gap: 6 }}>
                  <Save size={15} /> {bulkSaving ? 'Saving...' : 'Save All Readings'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== TAB 2: USAGE DASHBOARD ===== */}
      {tab === 'dashboard' && (
        <div>
          {analyticsLoading ? (
            <div style={{ padding: 60, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>
          ) : (
            <>
              {/* Year selector */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[2024, 2025, 2026].map(y => (
                    <button key={y} className={`btn ${dashYear === y ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 13 }} onClick={() => setDashYear(y)}>{y}</button>
                  ))}
                </div>
                <button className="btn btn-ghost" onClick={checkOverusage} style={{ gap: 6, fontSize: 13 }}>
                  <RefreshCw size={14} /> Check Overusage
                </button>
              </div>

              {/* Overusage alerts */}
              {alerts.length > 0 && (
                <div className="card" style={{ marginBottom: 16, borderLeft: `3px solid ${DANGER_COLOR}` }}>
                  <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={16} style={{ color: DANGER_COLOR }} />
                    <h3 style={{ color: DANGER_COLOR }}>Overusage Alerts ({alerts.length})</h3>
                  </div>
                  <div className="table-container">
                    <table>
                      <thead><tr><th>Property</th><th>Type</th><th>Month</th><th>Usage</th><th>Avg/Limit</th><th>% Over</th></tr></thead>
                      <tbody>
                        {alerts.map((a, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 500 }}>{a.property_name || a.parent_property_name || 'Unknown'}</td>
                            <td>
                              <span style={{ color: a.meter_type === 'gas' ? GAS_COLOR : ELEC_COLOR, fontWeight: 500, fontSize: 13 }}>
                                {a.meter_type}
                              </span>
                            </td>
                            <td>{MONTH_NAMES[a.month]}</td>
                            <td>{Number(a.usage_kwh).toFixed(1)} kWh</td>
                            <td>{Number(a.avg_usage).toFixed(1)} kWh</td>
                            <td style={{ color: DANGER_COLOR, fontWeight: 700 }}>{a.threshold_pct || Math.round((a.usage_kwh / a.avg_usage) * 100)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Summary stat cards */}
              <div className="stats-grid" style={{ marginBottom: 16 }}>
                <div className="stat-card" style={{ borderLeft: `3px solid ${GAS_COLOR}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="stat-card-label">Total Gas Spend</div>
                      <div className="stat-card-value" style={{ color: GAS_COLOR }}>&pound;{totals.gas_cost.toFixed(0)}</div>
                      <div className="stat-card-sub">{totals.gas_usage.toFixed(0)} kWh</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(245,158,11,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Flame size={20} style={{ color: GAS_COLOR }} />
                    </div>
                  </div>
                </div>
                <div className="stat-card" style={{ borderLeft: `3px solid ${ELEC_COLOR}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="stat-card-label">Total Electric Spend</div>
                      <div className="stat-card-value" style={{ color: ELEC_COLOR }}>&pound;{totals.electric_cost.toFixed(0)}</div>
                      <div className="stat-card-sub">{totals.electric_usage.toFixed(0)} kWh</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Zap size={20} style={{ color: ELEC_COLOR }} />
                    </div>
                  </div>
                </div>
                <div className="stat-card accent">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="stat-card-label">Total Combined</div>
                      <div className="stat-card-value">&pound;{totals.total_cost.toFixed(0)}</div>
                      <div className="stat-card-sub">{leaderboard.length} properties tracked</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PoundSterling size={20} style={{ color: 'var(--accent-light)' }} />
                    </div>
                  </div>
                </div>
                <div className="stat-card" style={{ borderLeft: '3px solid #22d3ee' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="stat-card-label">Highest Spender</div>
                      <div className="stat-card-value" style={{ color: '#22d3ee', fontSize: 16 }}>
                        {leaderboard.length > 0 ? leaderboard[0].display_name : 'N/A'}
                      </div>
                      <div className="stat-card-sub">{leaderboard.length > 0 ? `£${(leaderboard[0].total_cost || 0).toFixed(0)}` : ''}</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(34,211,238,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TrendingUp size={20} style={{ color: '#22d3ee' }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Property Spend Comparison - Bar Chart */}
              {leaderboard.length > 0 && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="card-header">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <PoundSterling size={16} style={{ color: 'var(--accent-light)' }} />
                      Property Spend Comparison - {dashYear}
                    </h3>
                  </div>
                  <div className="card-body" style={{ height: Math.max(350, leaderboard.length * 32 + 60) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={(analytics?.propertyTotals || []).map(r => ({ name: r.display_name || 'Unknown', gas: Number((r.total_gas_cost || 0).toFixed(2)), electric: Number((r.total_electric_cost || 0).toFixed(2)), total: Number((r.total_cost || 0).toFixed(2)) }))} layout="vertical" margin={{ left: 10, right: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                        <XAxis type="number" tick={tickStyle} tickFormatter={v => `£${v}`} />
                        <YAxis dataKey="name" type="category" tick={tickStyle} width={140} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`£${Number(v).toFixed(2)}`, name]} />
                        <Legend />
                        <Bar dataKey="gas" fill={GAS_COLOR} radius={[0, 4, 4, 0]} stackId="a" name="Gas" />
                        <Bar dataKey="electric" fill={ELEC_COLOR} radius={[0, 4, 4, 0]} stackId="a" name="Electric" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Property Usage Comparison - Bar Chart */}
              {leaderboard.length > 0 && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="card-header">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Zap size={16} style={{ color: 'var(--accent-light)' }} />
                      Property Usage Comparison (kWh) - {dashYear}
                    </h3>
                  </div>
                  <div className="card-body" style={{ height: Math.max(350, leaderboard.length * 32 + 60) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={leaderboard.map(r => ({ name: r.display_name || 'Unknown', gas: Number((r.gas_kwh || 0).toFixed(0)), electric: Number((r.electric_kwh || 0).toFixed(0)), total: Number((r.total_kwh || 0).toFixed(0)) }))} layout="vertical" margin={{ left: 10, right: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                        <XAxis type="number" tick={tickStyle} tickFormatter={v => `${v} kWh`} />
                        <YAxis dataKey="name" type="category" tick={tickStyle} width={140} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${Number(v).toLocaleString()} kWh`, name]} />
                        <Legend />
                        <Bar dataKey="gas" fill={GAS_COLOR} radius={[0, 4, 4, 0]} stackId="a" name="Gas" />
                        <Bar dataKey="electric" fill={ELEC_COLOR} radius={[0, 4, 4, 0]} stackId="a" name="Electric" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Property Leaderboard Table */}
              <div className="card">
                <div className="card-header">
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TrendingUp size={16} style={{ color: 'var(--accent-light)' }} />
                    Property Leaderboard - {dashYear}
                  </h3>
                </div>
                {leaderboard.length > 0 ? (
                  <div className="table-container">
                    <table>
                      <thead><tr><th>#</th><th>Property</th><th>Gas (kWh)</th><th>Electric (kWh)</th><th>Total (kWh)</th><th>Total Cost</th><th>Usage</th><th>Status</th></tr></thead>
                      <tbody>
                        {leaderboard.map((row, idx) => {
                          const pct = maxLeaderboardKwh > 0 ? ((row.total_kwh || 0) / maxLeaderboardKwh) * 100 : 0;
                          const gasLimit = fairUsage.find(f => f.property_id === row.property_id && f.meter_type === 'gas');
                          const elecLimit = fairUsage.find(f => f.property_id === row.property_id && f.meter_type === 'electric');
                          const monthCount = analytics?.monthlyTrends?.length > 0 ? new Set(analytics.monthlyTrends.map(r => r.month)).size : 12;
                          const gasOverLimit = gasLimit && gasLimit.monthly_limit_kwh > 0 ? (row.gas_kwh || 0) > gasLimit.monthly_limit_kwh * monthCount : false;
                          const elecOverLimit = elecLimit && elecLimit.monthly_limit_kwh > 0 ? (row.electric_kwh || 0) > elecLimit.monthly_limit_kwh * monthCount : false;
                          const isOver = gasOverLimit || elecOverLimit;
                          const totalLimit = ((gasLimit?.monthly_limit_kwh || 0) + (elecLimit?.monthly_limit_kwh || 0)) * monthCount;
                          const usagePct = totalLimit > 0 ? ((row.total_kwh || 0) / totalLimit) * 100 : null;
                          const statusColor = usagePct === null ? 'var(--text-muted)' : usagePct > 100 ? DANGER_COLOR : usagePct > 80 ? GAS_COLOR : 'var(--success)';

                          return (
                            <tr key={idx}>
                              <td style={{ fontWeight: 700, color: 'var(--accent-light)', fontSize: 15 }}>{idx + 1}</td>
                              <td style={{ fontWeight: 500 }}>{row.display_name || 'Unknown'}</td>
                              <td style={{ color: GAS_COLOR }}>{(row.gas_kwh || 0).toFixed(0)}</td>
                              <td style={{ color: ELEC_COLOR }}>{(row.electric_kwh || 0).toFixed(0)}</td>
                              <td style={{ fontWeight: 600 }}>{(row.total_kwh || 0).toFixed(0)}</td>
                              <td style={{ fontWeight: 600 }}>&pound;{(row.total_cost || 0).toFixed(2)}</td>
                              <td style={{ width: 140 }}>
                                <div style={{ height: 8, background: 'rgba(99,102,241,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                                  <div style={{
                                    height: '100%', width: `${pct}%`, borderRadius: 4,
                                    background: isOver ? `linear-gradient(90deg, ${GAS_COLOR}, ${DANGER_COLOR})` : 'var(--gradient-accent)',
                                    transition: 'width 0.5s ease'
                                  }} />
                                </div>
                              </td>
                              <td>
                                <span style={{
                                  display: 'inline-block', padding: '2px 10px', borderRadius: 10,
                                  fontSize: 11, fontWeight: 600, color: statusColor,
                                  background: statusColor === 'var(--success)' ? 'rgba(52,211,153,0.1)' : statusColor === GAS_COLOR ? 'rgba(245,158,11,0.1)' : statusColor === DANGER_COLOR ? 'rgba(239,68,68,0.1)' : 'rgba(136,136,160,0.1)'
                                }}>
                                  {usagePct === null ? 'No limit' : usagePct > 100 ? 'Over' : usagePct > 80 ? 'Warning' : 'OK'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No usage data for {dashYear}</div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ===== TAB 3: ANALYTICS & CHARTS ===== */}
      {tab === 'analytics' && (
        <div>
          {analyticsLoading ? (
            <div style={{ padding: 60, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>
          ) : (
            <>
              {/* Year selector */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {[2024, 2025, 2026].map(y => (
                  <button key={y} className={`btn ${dashYear === y ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 13 }} onClick={() => setDashYear(y)}>{y}</button>
                ))}
              </div>

              {/* Summary stat cards */}
              <div className="stats-grid">
                <div className="stat-card" style={{ borderLeft: `3px solid ${GAS_COLOR}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="stat-card-label">Total Gas</div>
                      <div className="stat-card-value" style={{ color: GAS_COLOR }}>&pound;{totals.gas_cost.toFixed(0)}</div>
                      <div className="stat-card-sub">{totals.gas_usage.toFixed(0)} kWh</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(245,158,11,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Flame size={20} style={{ color: GAS_COLOR }} />
                    </div>
                  </div>
                </div>

                <div className="stat-card" style={{ borderLeft: `3px solid ${ELEC_COLOR}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="stat-card-label">Total Electric</div>
                      <div className="stat-card-value" style={{ color: ELEC_COLOR }}>&pound;{totals.electric_cost.toFixed(0)}</div>
                      <div className="stat-card-sub">{totals.electric_usage.toFixed(0)} kWh</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Zap size={20} style={{ color: ELEC_COLOR }} />
                    </div>
                  </div>
                </div>

                <div className="stat-card accent">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="stat-card-label">Total Combined</div>
                      <div className="stat-card-value">&pound;{totals.total_cost.toFixed(0)}</div>
                      <div className="stat-card-sub">{(totals.gas_usage + totals.electric_usage).toFixed(0)} kWh total</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PoundSterling size={20} style={{ color: 'var(--accent-light)' }} />
                    </div>
                  </div>
                </div>

                <div className="stat-card" style={{ borderLeft: '3px solid #22d3ee' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="stat-card-label">Avg Monthly</div>
                      <div className="stat-card-value" style={{ color: '#22d3ee' }}>
                        &pound;{monthlyChartData.length > 0 ? (totals.total_cost / monthlyChartData.length).toFixed(0) : '0'}
                      </div>
                      <div className="stat-card-sub">{monthlyChartData.length} months of data</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(34,211,238,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TrendingUp size={20} style={{ color: '#22d3ee' }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Most expensive month card */}
              {mostExpensive && (
                <div style={{
                  padding: '14px 18px', marginBottom: 16, borderRadius: 10,
                  background: 'linear-gradient(135deg, rgba(239,68,68,0.06) 0%, rgba(245,158,11,0.04) 100%)',
                  border: '1px solid rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', gap: 12
                }}>
                  <AlertTriangle size={18} style={{ color: DANGER_COLOR, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    Most expensive month: <strong>{MONTH_NAMES[mostExpensive.month]} {mostExpensive.year}</strong> at <strong>&pound;{Number(mostExpensive.total_cost).toFixed(2)}</strong>
                  </span>
                </div>
              )}

              {/* Gas vs Electric monthly spend */}
              <div className="chart-grid-2">
                <div className="card">
                  <div className="card-header"><h3>Gas vs Electric Monthly Spend</h3></div>
                  <div className="card-body" style={{ height: 300 }}>
                    {monthlyChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={monthlyChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                          <XAxis dataKey="month" tick={tickStyle} />
                          <YAxis tick={tickStyle} tickFormatter={v => `\u00A3${v}`} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`\u00A3${Number(v).toFixed(2)}`, name === 'gas_cost' ? 'Gas' : 'Electric']} />
                          <Legend formatter={v => v === 'gas_cost' ? 'Gas' : 'Electric'} />
                          <Bar dataKey="gas_cost" fill={GAS_COLOR} radius={[4, 4, 0, 0]} name="gas_cost" />
                          <Bar dataKey="electric_cost" fill={ELEC_COLOR} radius={[4, 4, 0, 0]} name="electric_cost" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>No data for {dashYear}</div>
                    )}
                  </div>
                </div>

                {/* Cumulative */}
                <div className="card">
                  <div className="card-header"><h3>Cumulative Energy Costs</h3></div>
                  <div className="card-body" style={{ height: 300 }}>
                    {cumulativeChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={cumulativeChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                          <XAxis dataKey="month" tick={tickStyle} />
                          <YAxis tick={tickStyle} tickFormatter={v => `\u00A3${v}`} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`\u00A3${Number(v).toFixed(2)}`, name === 'gas' ? 'Gas' : name === 'electric' ? 'Electric' : 'Total']} />
                          <Legend />
                          <Area type="monotone" dataKey="total" stroke="#22d3ee" fill="rgba(34,211,238,0.1)" strokeWidth={2} name="Total" />
                          <Area type="monotone" dataKey="gas" stroke={GAS_COLOR} fill="rgba(245,158,11,0.06)" strokeWidth={1.5} name="Gas" />
                          <Area type="monotone" dataKey="electric" stroke={ELEC_COLOR} fill="rgba(99,102,241,0.06)" strokeWidth={1.5} name="Electric" />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>No data for {dashYear}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Property comparison */}
              <div className="chart-grid-2">
                <div className="card">
                  <div className="card-header"><h3>Property Comparison</h3></div>
                  <div className="card-body" style={{ height: Math.max(300, propertyChartData.length * 40) }}>
                    {propertyChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={propertyChartData} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                          <XAxis type="number" tick={tickStyle} tickFormatter={v => `\u00A3${v}`} />
                          <YAxis dataKey="name" type="category" tick={tickStyle} width={120} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`\u00A3${Number(v).toFixed(2)}`, name]} />
                          <Legend />
                          <Bar dataKey="gas" fill={GAS_COLOR} radius={[0, 4, 4, 0]} stackId="a" name="Gas" />
                          <Bar dataKey="electric" fill={ELEC_COLOR} radius={[0, 4, 4, 0]} stackId="a" name="Electric" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>No data for {dashYear}</div>
                    )}
                  </div>
                </div>

                {/* Year-on-year */}
                <div className="card">
                  <div className="card-header"><h3>Year-on-Year Comparison</h3></div>
                  <div className="card-body" style={{ height: 300 }}>
                    {yoyChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={yoyChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                          <XAxis dataKey="month" tick={tickStyle} />
                          <YAxis tick={tickStyle} tickFormatter={v => `\u00A3${v}`} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`\u00A3${Number(v).toFixed(2)}`, name === 'current' ? `${dashYear}` : `${dashYear - 1}`]} />
                          <Legend formatter={v => v === 'current' ? `${dashYear}` : `${dashYear - 1}`} />
                          <Bar dataKey="current" fill={ELEC_COLOR} radius={[4, 4, 0, 0]} name="current" />
                          <Bar dataKey="previous" fill="rgba(99,102,241,0.3)" radius={[4, 4, 0, 0]} name="previous" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>No comparison data available</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Future projections */}
              {projectionChartData.length > 0 && (
                <div className="card" style={{ marginTop: 0 }}>
                  <div className="card-header"><h3>Future Cost Projections</h3></div>
                  <div className="card-body" style={{ height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={projectionChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                        <XAxis dataKey="month" tick={tickStyle} />
                        <YAxis tick={tickStyle} tickFormatter={v => `\u00A3${v}`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`\u00A3${Number(v).toFixed(2)}`, name === 'actual' ? 'Actual' : 'Projected']} />
                        <Legend />
                        <Line type="monotone" dataKey="actual" stroke="#22d3ee" strokeWidth={2} dot={{ fill: '#22d3ee', r: 4 }} name="Actual" />
                        <Line type="monotone" dataKey="projected" stroke={GAS_COLOR} strokeWidth={2} strokeDasharray="8 4" dot={{ fill: GAS_COLOR, r: 4 }} name="Projected" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===== TAB 4: METER NUMBERS ===== */}
      {tab === 'meters' && (
        <div>
          {meterRefsLoading ? (
            <div style={{ padding: 60, textAlign: 'center' }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>
          ) : (
            <div className="card">
              <div className="card-header">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Hash size={16} style={{ color: 'var(--accent-light)' }} />
                  Meter Reference Numbers
                </h3>
              </div>
              {meterRefs.length > 0 ? (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Property</th>
                        <th>Unit / Apartment</th>
                        <th>Type</th>
                        <th>MPRN (Gas)</th>
                        <th>MPAN (Electric)</th>
                        <th>Water Ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Group by property + apartment to avoid duplicates
                        const seen = new Set();
                        return meterRefs.filter(r => {
                          const key = `${r.property_id}:${r.property_name || ''}:${r.meter_type}`;
                          if (seen.has(key)) return false;
                          seen.add(key);
                          return true;
                        }).map((r, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 500 }}>{r.parent_property_name || 'Unknown'}</td>
                            <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{r.property_name && r.property_name !== r.parent_property_name ? r.property_name : '-'}</td>
                            <td>
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                color: r.meter_type === 'gas' ? GAS_COLOR : ELEC_COLOR, fontWeight: 500, fontSize: 13
                              }}>
                                {r.meter_type === 'gas' ? <Flame size={13} /> : <Zap size={13} />}
                                {r.meter_type}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: 13, color: r.mprn ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.mprn || '-'}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 13, color: r.mpan ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.mpan || '-'}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 13, color: r.water_ref ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.water_ref || '-'}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                  No meter reference numbers found. Meter references are stored when readings are entered with MPRN/MPAN details.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== TAB 5: RATES & SETTINGS ===== */}
      {tab === 'rates' && (() => {
        // Build property options for the rate view selector (includes 52 OE apartments)
        const ratePropertyOptions = [];
        properties.forEach(p => {
          const isOE = p.name?.toLowerCase().includes('52 old elvet');
          if (isOE) {
            OLD_ELVET_APARTMENTS.forEach(apt => ratePropertyOptions.push({ id: p.id, name: apt, label: apt }));
          } else {
            ratePropertyOptions.push({ id: p.id, name: '', label: p.name });
          }
        });

        // Get effective rates for the selected view
        const getEffectiveRate = (rateType) => {
          if (!rateViewProperty) return allRates.current?.[rateType];
          const override = allRates.byProperty?.[rateViewProperty]?.[rateType];
          if (override != null) return override;
          return allRates.current?.[rateType]; // fallback to global
        };
        const isOverride = (rateType) => {
          if (!rateViewProperty) return false;
          return allRates.byProperty?.[rateViewProperty]?.[rateType] != null;
        };

        return (
        <div>
          {/* Property selector for viewing rates */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Viewing rates for:</label>
                <select className="form-input" style={{ maxWidth: 300 }} value={rateViewProperty} onChange={e => setRateViewProperty(e.target.value)}>
                  <option value="">All Properties (Global Defaults)</option>
                  {ratePropertyOptions.map(p => (
                    <option key={`${p.id}:${p.name}`} value={`${p.id}:${p.name}`}>{p.label}</option>
                  ))}
                </select>
                {rateViewProperty && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Properties without custom rates use the global defaults
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Current rates display */}
          <div className="stats-grid" style={{ marginBottom: 16 }}>
            {[
              { key: 'gas_unit_rate', label: 'Gas Unit Rate', unit: 'p/kWh', color: GAS_COLOR, icon: <Flame size={18} /> },
              { key: 'electric_unit_rate', label: 'Electric Unit Rate', unit: 'p/kWh', color: ELEC_COLOR, icon: <Zap size={18} /> },
              { key: 'gas_standing_charge', label: 'Gas Standing Charge', unit: 'p/day', color: GAS_COLOR, icon: <Flame size={18} /> },
              { key: 'electric_standing_charge', label: 'Elec Standing Charge', unit: 'p/day', color: ELEC_COLOR, icon: <Zap size={18} /> },
              { key: 'vat_rate', label: 'VAT Rate', unit: '%', color: '#a855f7', icon: <PoundSterling size={18} /> }
            ].map(rate => {
              const val = getEffectiveRate(rate.key);
              const overridden = isOverride(rate.key);
              return (
              <div key={rate.key} className="stat-card" style={{ borderLeft: `3px solid ${rate.color}`, position: 'relative' }}>
                {overridden && (
                  <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 9, background: 'var(--accent-light)', color: '#fff', padding: '1px 6px', borderRadius: 8, fontWeight: 600 }}>
                    CUSTOM
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="stat-card-label">{rate.label}</div>
                    <div className="stat-card-value" style={{ color: rate.color }}>
                      {val != null ? `${val}${rate.unit === '%' ? '%' : ''}` : 'Not set'}
                    </div>
                    <div className="stat-card-sub">{rate.unit}{!overridden && rateViewProperty ? ' (global)' : ''}</div>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${rate.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: rate.color }}>
                    {rate.icon}
                  </div>
                </div>
              </div>
              );
            })}
          </div>

          {/* Update rates form */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><h3>Update Rate</h3></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Apply To</label>
                  <select className="form-input" value={rateForm.property_id ? `${rateForm.property_id}:${rateForm.property_name}` : ''} onChange={e => {
                    if (!e.target.value) {
                      setRateForm(f => ({ ...f, property_id: '', property_name: '' }));
                    } else {
                      const [pid, ...pname] = e.target.value.split(':');
                      setRateForm(f => ({ ...f, property_id: parseInt(pid), property_name: pname.join(':') }));
                    }
                  }}>
                    <option value="">All Properties (Global Default)</option>
                    {ratePropertyOptions.map(p => (
                      <option key={`f-${p.id}:${p.name}`} value={`${p.id}:${p.name}`}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Rate Type</label>
                  <select className="form-input" value={rateForm.rate_type} onChange={e => setRateForm(f => ({ ...f, rate_type: e.target.value }))}>
                    <option value="gas_unit_rate">Gas Unit Rate (p/kWh)</option>
                    <option value="electric_unit_rate">Electric Unit Rate (p/kWh)</option>
                    <option value="gas_standing_charge">Gas Standing Charge (p/day)</option>
                    <option value="electric_standing_charge">Electric Standing Charge (p/day)</option>
                    <option value="vat_rate">VAT Rate (%)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Rate Value</label>
                  <input className="form-input" type="number" step="0.001" value={rateForm.rate_value} onChange={e => setRateForm(f => ({ ...f, rate_value: e.target.value }))} placeholder="e.g. 7.37" />
                </div>
                <div className="form-group">
                  <label className="form-label">Effective From</label>
                  <input className="form-input" type="date" value={rateForm.effective_from} onChange={e => setRateForm(f => ({ ...f, effective_from: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <input className="form-input" value={rateForm.notes} onChange={e => setRateForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. New tariff from supplier" />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button className="btn btn-primary" style={{ gap: 6 }} onClick={saveRate} disabled={rateSaving}>
                  <Save size={15} /> {rateSaving ? 'Saving...' : 'Save Rate'}
                </button>
                {rateForm.property_id && (
                  <span style={{ fontSize: 12, color: 'var(--accent-light)', fontWeight: 500 }}>
                    Setting custom rate for {ratePropertyOptions.find(p => p.id === rateForm.property_id && p.name === rateForm.property_name)?.label || 'selected property'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Rate history */}
          {allRates.rates?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header"><h3>Rate History</h3></div>
              <div className="table-container">
                <table>
                  <thead><tr><th>Property</th><th>Rate Type</th><th>Value</th><th>Effective From</th><th>Effective To</th><th>Notes</th></tr></thead>
                  <tbody>
                    {allRates.rates.map((r, i) => (
                      <tr key={i}>
                        <td>
                          {r.property_id ? (
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-light)' }}>
                              {r.property_name || r.parent_property_name || `Property #${r.property_id}`}
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Global Default</span>
                          )}
                        </td>
                        <td style={{ fontWeight: 500, textTransform: 'capitalize' }}>{(r.rate_type || '').replace(/_/g, ' ')}</td>
                        <td style={{ fontWeight: 600 }}>{r.rate_value}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.effective_from}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.effective_to || 'Current'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.notes || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Fair usage limits */}
          <div className="card">
            <div className="card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} style={{ color: GAS_COLOR }} />
                Fair Usage Limits (Monthly kWh)
              </h3>
            </div>
            <div className="table-container">
              <table>
                <thead><tr><th>Property</th><th style={{ color: GAS_COLOR }}>Gas Limit (kWh/month)</th><th style={{ color: ELEC_COLOR }}>Electric Limit (kWh/month)</th></tr></thead>
                <tbody>
                  {properties.map(prop => {
                    // For Old Elvet, show apartments
                    const isOE = prop.name?.toLowerCase().includes('old elvet') || prop.name?.toLowerCase().includes('52 old');
                    if (isOE) {
                      return OLD_ELVET_APARTMENTS.map(apt => {
                        const gasLim = fairUsageLimits.find(f => f.property_id === prop.id && f.meter_type === 'gas');
                        const elecLim = fairUsageLimits.find(f => f.property_id === prop.id && f.meter_type === 'electric');
                        return (
                          <FairUsageRow
                            key={`${prop.id}-${apt}`}
                            label={apt}
                            propertyId={prop.id}
                            gasLimit={gasLim?.monthly_limit_kwh || ''}
                            elecLimit={elecLim?.monthly_limit_kwh || ''}
                            onSave={saveFairUsageLimit}
                          />
                        );
                      });
                    }
                    const gasLim = fairUsageLimits.find(f => f.property_id === prop.id && f.meter_type === 'gas');
                    const elecLim = fairUsageLimits.find(f => f.property_id === prop.id && f.meter_type === 'electric');
                    return (
                      <FairUsageRow
                        key={prop.id}
                        label={prop.name}
                        propertyId={prop.id}
                        gasLimit={gasLim?.monthly_limit_kwh || ''}
                        elecLimit={elecLim?.monthly_limit_kwh || ''}
                        onSave={saveFairUsageLimit}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

function FairUsageRow({ label, propertyId, gasLimit, elecLimit, onSave }) {
  const [gas, setGas] = useState(gasLimit);
  const [elec, setElec] = useState(elecLimit);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setGas(gasLimit); setElec(elecLimit); }, [gasLimit, elecLimit]);

  return (
    <tr>
      <td style={{ fontWeight: 500 }}>{label}</td>
      <td>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            className="form-input"
            type="number"
            value={gas}
            onChange={e => { setGas(e.target.value); setDirty(true); }}
            style={{ fontSize: 12, padding: '6px 8px', width: 100 }}
            placeholder="kWh"
          />
          {dirty && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11, padding: '4px 8px', color: '#f59e0b' }}
              onClick={() => { onSave(propertyId, 'gas', gas); setDirty(false); }}
            >
              Save
            </button>
          )}
        </div>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            className="form-input"
            type="number"
            value={elec}
            onChange={e => { setElec(e.target.value); setDirty(true); }}
            style={{ fontSize: 12, padding: '6px 8px', width: 100 }}
            placeholder="kWh"
          />
          {dirty && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11, padding: '4px 8px', color: '#6366f1' }}
              onClick={() => { onSave(propertyId, 'electric', elec); setDirty(false); }}
            >
              Save
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

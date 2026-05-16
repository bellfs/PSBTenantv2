const API_BASE = '/api';
function getToken() { return localStorage.getItem('psb_token'); }
export function setToken(token) { localStorage.setItem('psb_token', token); }
export function clearToken() { localStorage.removeItem('psb_token'); }
export function getStoredUser() { const u = localStorage.getItem('psb_user'); return u ? JSON.parse(u) : null; }
export function setStoredUser(user) { localStorage.setItem('psb_user', JSON.stringify(user)); }

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}), ...options.headers };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) { clearToken(); window.location.href = '/login'; throw new Error('Session expired'); }
  if (!res.ok) { const err = await res.json().catch(() => ({ error: 'Request failed' })); throw new Error(err.error || 'Request failed'); }
  return res.json();
}

function downloadFile(path, filename) {
  const token = getToken();
  return fetch(`${API_BASE}${path}`, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    });
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/auth/me'),
  changePassword: (currentPassword, newPassword) => request('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),
  getStaff: () => request('/auth/staff'),
  createStaff: (data) => request('/auth/staff', { method: 'POST', body: JSON.stringify(data) }),
  getStaffList: () => request('/staff-list'),

  getIssues: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/issues?${qs}`); },
  getIssueStats: () => request('/issues/stats'),
  getIssueTimeline: () => request('/issues/timeline'),
  getIssue: (id) => request(`/issues/${id}`),
  updateIssue: (id, data) => request(`/issues/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteIssue: (id) => request(`/issues/${id}`, { method: 'DELETE' }),
  respondToIssue: (id, message) => request(`/issues/${id}/respond`, { method: 'POST', body: JSON.stringify({ message }) }),
  generateReport: (id) => request(`/issues/${id}/report`),
  getIssueNotes: (id) => request(`/issues/${id}/notes`),
  addIssueNote: (id, content) => request(`/issues/${id}/notes`, { method: 'POST', body: JSON.stringify({ content }) }),
  getSimilarIssues: (id) => request(`/issues/${id}/similar`),
  getSlaMetrics: () => request('/analytics/sla'),

  getProperties: () => request('/properties'),
  getPropertyIssues: (id) => request(`/properties/${id}/issues`),
  createProperty: (data) => request('/properties', { method: 'POST', body: JSON.stringify(data) }),
  updateProperty: (id, data) => request(`/properties/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  exportPropertyIssues: (id) => downloadFile(`/properties/${id}/export`, 'property-issues.csv'),

  getTenants: (year) => request(`/tenants${year ? `?year=${year}` : ''}`),
  searchTenants: (q) => request(`/tenants/search?q=${encodeURIComponent(q)}`),
  getTenantIssues: (id) => request(`/tenants/${id}/issues`),
  updateTenant: (id, data) => request(`/tenants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  exportTenantIssues: (id) => downloadFile(`/tenants/${id}/export`, 'tenant-issues.csv'),
  getPropertyApartments: (id) => request(`/properties/${id}/apartments`),

  getAnalytics: () => request('/analytics'),
  exportAllIssues: () => downloadFile('/analytics/export', 'maintenance-export.csv'),

  getSettings: () => request('/settings'),
  testEmail: () => request('/settings/test-email', { method: 'POST' }),
  updateSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Contractors
  getContractors: () => request('/contractors'),
  createContractor: (data) => request('/contractors', { method: 'POST', body: JSON.stringify(data) }),
  updateContractor: (id, data) => request(`/contractors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getContractorQuotes: (id) => request(`/contractors/${id}/quotes`),

  // Quotes
  getIssueQuotes: (issueId) => request(`/contractors/issues/${issueId}/quotes`),
  createQuote: (issueId, data) => request(`/contractors/issues/${issueId}/quotes`, { method: 'POST', body: JSON.stringify(data) }),
  updateQuote: (id, data) => request(`/contractors/quotes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  generateJobBrief: (issueId) => request(`/contractors/issues/${issueId}/job-brief`, { method: 'POST' }),

  // Budgets
  getBudgets: (year) => request(`/budgets?year=${year || new Date().getFullYear()}`),
  setBudget: (data) => request('/budgets', { method: 'PUT', body: JSON.stringify(data) }),

  // Compliance & Documents
  getCertificates: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/compliance/certificates${qs ? '?' + qs : ''}`);
  },
  getComplianceSummary: () => request('/compliance/summary'),
  createCertificate: (data) => request('/compliance/certificates', { method: 'POST', body: JSON.stringify(data) }),
  updateCertificate: (id, data) => request(`/compliance/certificates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCertificate: (id) => request(`/compliance/certificates/${id}`, { method: 'DELETE' }),
  getDocuments: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/compliance/documents${qs ? '?' + qs : ''}`);
  },
  uploadDocument: (formData) => {
    const token = localStorage.getItem('psb_token');
    return fetch(`${API_BASE}/compliance/documents`, {
      method: 'POST', body: formData,
      headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
    }).then(r => { if (!r.ok) throw new Error('Upload failed'); return r.json(); });
  },
  deleteDocument: (id) => request(`/compliance/documents/${id}`, { method: 'DELETE' }),

  // Email accounts
  getEmailAccounts: () => request('/email/accounts'),
  getGmailAuthUrl: () => request('/email/accounts/gmail/auth-url', { method: 'POST' }),
  addImapAccount: (data) => request('/email/accounts/imap', { method: 'POST', body: JSON.stringify(data) }),
  toggleEmailAccount: (id, enabled) => request(`/email/accounts/${id}`, { method: 'PUT', body: JSON.stringify({ sync_enabled: enabled }) }),
  deleteEmailAccount: (id) => request(`/email/accounts/${id}`, { method: 'DELETE' }),
  triggerEmailSync: (id) => request(`/email/accounts/${id}/sync`, { method: 'POST' }),
  getEmailSyncLog: () => request('/email/sync-log'),
  scanInboxForComplaints: () => request('/email/scan-inbox', { method: 'POST' }),

  // Copilot
  askCopilot: (question, history) => request('/copilot/ask', { method: 'POST', body: JSON.stringify({ question, history }) }),

  // FFR Property OS
  getOSOverview: () => request('/os/overview'),
  getAgents: () => request('/agents'),
  getAgentHealth: () => request('/agents/health'),
  getAgentRuns: (limit = 50) => request(`/agents/runs?limit=${limit}`),
  runAgent: (key, data = {}) => request(`/agents/${key}/run`, { method: 'POST', body: JSON.stringify(data) }),
  getAgentTasks: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/agents/tasks${qs ? '?' + qs : ''}`); },
  createAgentTask: (data) => request('/agents/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateAgentTask: (id, data) => request(`/agents/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getAgentApprovals: (status = 'pending') => request(`/agents/approvals?status=${status}`),
  createAgentApproval: (data) => request('/agents/approvals', { method: 'POST', body: JSON.stringify(data) }),
  updateAgentApproval: (id, status) => request(`/agents/approvals/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Intake
  processWhatsAppExport: (data) => request('/intake/whatsapp-export', { method: 'POST', body: JSON.stringify(data) }),
  getIntakeSummary: () => request('/intake/summary'),
  getIntakeItems: (limit = 100) => request(`/intake/items?limit=${limit}`),
  getIntakeExtractions: (limit = 100) => request(`/intake/extractions?limit=${limit}`),

  // Admin Email Agent
  getEmailAgentSummary: () => request('/email-agent/summary'),
  getEmailAgentItems: (limit = 100) => request(`/email-agent/items?limit=${limit}`),
  getEmailAgentDrafts: (status = 'draft', limit = 100) => request(`/email-agent/drafts?status=${encodeURIComponent(status)}&limit=${limit}`),
  runEmailAgent: () => request('/email-agent/run', { method: 'POST' }),
  updateEmailAgentDraft: (id, data) => request(`/email-agent/drafts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  approveEmailAgentDraft: (id) => request(`/email-agent/drafts/${id}/approve`, { method: 'POST' }),
  sendEmailAgentDraft: (id) => request(`/email-agent/drafts/${id}/send`, { method: 'POST' }),
  previewEmailDailyReport: (date) => request('/email-agent/reports/daily/preview', { method: 'POST', body: JSON.stringify({ date }) }),
  sendEmailDailyReport: (date) => request('/email-agent/reports/daily/send', { method: 'POST', body: JSON.stringify({ date }) }),
  getEmailAgentReports: (limit = 30) => request(`/email-agent/reports?limit=${limit}`),

  // Inspections (Check-In / Check-Out)
  getInspections: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/inspections?${qs}`); },
  getInspection: (id) => request(`/inspections/${id}`),
  createInspection: (data) => request('/inspections', { method: 'POST', body: JSON.stringify(data) }),
  updateInspection: (id, data) => request(`/inspections/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInspection: (id) => request(`/inspections/${id}`, { method: 'DELETE' }),
  updateInspectionItem: (itemId, data) => request(`/inspections/items/${itemId}`, { method: 'PUT', body: JSON.stringify(data) }),
  addInspectionRoom: (id, room_name) => request(`/inspections/${id}/rooms`, { method: 'POST', body: JSON.stringify({ room_name }) }),
  addRoomItem: (roomId, item_name) => request(`/inspections/rooms/${roomId}/items`, { method: 'POST', body: JSON.stringify({ item_name }) }),
  uploadInspectionPhoto: (id, formData) => {
    const token = localStorage.getItem('psb_token');
    return fetch(`${API_BASE}/inspections/${id}/photos`, {
      method: 'POST', body: formData,
      headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
    }).then(r => { if (!r.ok) throw new Error('Upload failed'); return r.json(); });
  },
  deleteInspectionPhoto: (photoId) => request(`/inspections/photos/${photoId}`, { method: 'DELETE' }),
  signInspection: (id, signer, signature) => request(`/inspections/${id}/sign`, { method: 'POST', body: JSON.stringify({ signer, signature }) }),
  addDeduction: (id, data) => request(`/inspections/${id}/deductions`, { method: 'POST', body: JSON.stringify(data) }),
  deleteDeduction: (deductionId) => request(`/inspections/deductions/${deductionId}`, { method: 'DELETE' }),
  getInspectionReport: (id) => request(`/inspections/${id}/report`),
  getPropertyCheckins: (propertyId) => request(`/inspections/property/${propertyId}/checkins`),

  // Utilities
  getUtilityReadings: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/utilities/readings?${qs}`); },
  saveUtilityReading: (data) => request('/utilities/readings', { method: 'POST', body: JSON.stringify(data) }),
  saveUtilityReadingsBulk: (readings) => request('/utilities/readings/bulk', { method: 'POST', body: JSON.stringify({ readings }) }),
  getUtilityRates: () => request('/utilities/rates'),
  saveUtilityRate: (data) => request('/utilities/rates', { method: 'POST', body: JSON.stringify(data) }),
  getUtilityAnalytics: (year) => request(`/utilities/analytics?year=${year || new Date().getFullYear()}`),
  getUtilityAlerts: (year) => request(`/utilities/alerts?year=${year || new Date().getFullYear()}`),
  getUtilityFairUsage: () => request('/utilities/fair-usage'),
  saveUtilityFairUsage: (data) => request('/utilities/fair-usage', { method: 'POST', body: JSON.stringify(data) }),
  checkUtilityOverusage: (month, year) => request('/utilities/check-overusage', { method: 'POST', body: JSON.stringify({ month, year }) }),
  getUtilityMeterRefs: () => request('/utilities/meter-refs'),

  // Finance / Banking
  getBankAccounts: () => request('/finance/accounts'),
  addBankAccount: (data) => request('/finance/accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateBankAccount: (id, data) => request(`/finance/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBankAccount: (id) => request(`/finance/accounts/${id}`, { method: 'DELETE' }),
  syncBankAccount: (id) => request(`/finance/accounts/${id}/sync`, { method: 'POST' }),
  getTransactions: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/finance/transactions?${qs}`); },
  updateTransaction: (id, data) => request(`/finance/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  categoriseTransactions: (ids) => request('/finance/categorise', { method: 'POST', body: JSON.stringify({ transaction_ids: ids }) }),
  getFinanceSummary: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/finance/summary?${qs}`); },
  getFinanceCategories: () => request('/finance/categories'),
};

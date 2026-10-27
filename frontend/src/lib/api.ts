import axios from 'axios'

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
})

api.interceptors.request.use(
  (config) => {
    if (import.meta.env.DEV) {
      console.debug(`[API] ${config.method?.toUpperCase()} ${config.url}`)
    }
    return config
  },
  (error) => Promise.reject(error),
)

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.message ||
      'An unexpected error occurred'
    if (import.meta.env.DEV) {
      console.error(`[API Error] ${message}`)
    }
    return Promise.reject({ ...error, message })
  },
)

// ─── Events ──────────────────────────────────────────────────────────────────
export const eventsApi = {
  getAll: (params?: {
    search?: string
    industry?: string
    status?: string
    skip?: number
    limit?: number
  }) => api.get('/events/', { params }),
  get: (id: number) => api.get(`/events/${id}`),
  create: (data: object) => api.post('/events/', data),
  update: (id: number, data: object) => api.put(`/events/${id}`, data),
  delete: (id: number) => api.delete(`/events/${id}`),
  scrape: (data: { industry: string; location?: string; max_events?: number }) =>
    api.post('/events/scrape', data),
  getScrapeStatus: (jobId: number) => api.get(`/events/scrape/status/${jobId}`),
}

// ─── Leads ──────────────────────────────────────────────────────────────────
export const leadsApi = {
  getAll: (params?: {
    event_id?: number
    status?: string
    priority?: string
    search?: string
    min_score?: number
    skip?: number
    limit?: number
  }) => api.get('/leads/', { params }),
  get: (id: number) => api.get(`/leads/${id}`),
  create: (data: object) => api.post('/leads/', data),
  update: (id: number, data: object) => api.put(`/leads/${id}`, data),
  delete: (id: number) => api.delete(`/leads/${id}`),
  qualify: (id: number, params?: { icp_description?: string }) =>
    api.post(`/leads/${id}/qualify`, null, { params }),
  bulkQualify: (data: { lead_ids: number[]; icp_description?: string }) =>
    api.post('/leads/bulk/qualify', data),
  scrape: (data: { event_id: number; max_leads?: number }) =>
    api.post('/leads/scrape', data),
}

// ─── Emails ──────────────────────────────────────────────────────────────────
export const emailsApi = {
  getAll: (params?: {
    lead_id?: number
    status?: string
    search?: string
    skip?: number
    limit?: number
  }) => api.get('/emails/', { params }),
  get: (id: number) => api.get(`/emails/${id}`),
  create: (data: object) => api.post('/emails/', data),
  generate: (data: {
    lead_id: number
    custom_notes?: string
    sender_name?: string
    sender_company?: string
    sender_role?: string
    tone?: string
  }) => api.post('/emails/generate', data),
  update: (id: number, data: object) => api.put(`/emails/${id}`, data),
  delete: (id: number) => api.delete(`/emails/${id}`),
  approve: (id: number) => api.post(`/emails/${id}/approve`),
  reject: (id: number) => api.post(`/emails/${id}/reject`),
  bulkGenerate: (data: {
    lead_ids: number[]
    sender_name?: string
    sender_company?: string
    sender_role?: string
    custom_notes?: string
    tone?: string
  }) => api.post('/emails/bulk/generate', data),
}

// ─── Gmail ───────────────────────────────────────────────────────────────────
export const gmailApi = {
  getAuthStatus: () => api.get('/gmail/auth/status'),
  /** Starts the loopback OAuth flow — the backend opens your browser. */
  connect: () => api.post('/gmail/auth/connect'),
  getConnectStatus: () => api.get('/gmail/auth/connect/status'),
  getAuthUrl: () => api.get('/gmail/auth/url'),
  authCallback: (authorization_code: string) =>
    api.post('/gmail/auth/callback', { authorization_code }),
  revokeAuth: () => api.post('/gmail/auth/revoke'),
  createDraft: (emailId: number) => api.post(`/gmail/drafts/${emailId}`),
  sendEmail: (emailId: number) => api.post(`/gmail/send/${emailId}`),
  getReplies: () => api.get('/gmail/replies'),
  checkReplies: () => api.post('/gmail/replies/check'),
  getSent: () => api.get('/gmail/sent'),
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export const reportsApi = {
  getDashboardStats: () => api.get('/reports/dashboard'),
  getFullReport: () => api.get('/reports/full'),
  getScoreBuckets: () => api.get('/reports/score-buckets'),
  exportLeads: () => api.get('/reports/export/leads', { responseType: 'blob' }),
  getAiSuggestions: (icp_description?: string) =>
    api.get('/reports/ai/suggestions', { params: icp_description ? { icp_description } : {} }),
}

// ─── Jobs (live scrape monitor) ──────────────────────────────────────────────
export const jobsApi = {
  getStatus: (kind: 'events' | 'leads', jobId: number) =>
    kind === 'events'
      ? api.get(`/events/scrape/status/${jobId}`)
      : api.get(`/leads/scrape/status/${jobId}`),
  getLogs: (jobId: number) => api.get(`/jobs/${jobId}/logs`),
  /** SSE stream URL for EventSource */
  streamUrl: (jobId: number) => `/api/v1/jobs/${jobId}/stream`,
}

// ─── AI status ───────────────────────────────────────────────────────────────
export const aiApi = {
  getStatus: () => api.get('/ai/status'),
}

// ─── Scheduler (automation) ──────────────────────────────────────────────────
export const schedulerApi = {
  list: () => api.get('/scheduler/tasks'),
  create: (data: object) => api.post('/scheduler/tasks', data),
  update: (id: number, data: object) => api.put(`/scheduler/tasks/${id}`, data),
  delete: (id: number) => api.delete(`/scheduler/tasks/${id}`),
  runNow: (id: number) => api.post(`/scheduler/tasks/${id}/run-now`, null, { timeout: 600000 }),
  getRuns: () => api.get('/scheduler/runs'),
}

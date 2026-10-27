import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Clock,
  Plus,
  Loader2,
  Play,
  Trash2,
  RefreshCw,
  Bot,
  CheckCircle2,
  XCircle,
  Zap,
  Users,
  Mail,
  CalendarDays,
  Pencil,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { schedulerApi, eventsApi } from '@/lib/api'
import { LiveJobMonitor, TrackedJob } from '@/components/jobs/LiveJobMonitor'
import { formatDate, truncate } from '@/lib/utils'
import toast from 'react-hot-toast'

const TASK_META: Record<string, { label: string; icon: React.ElementType; desc: string }> = {
  discover_events: {
    label: 'Discover + Collect Events',
    icon: CalendarDays,
    desc: 'Daily grounded web discovery for real trade shows per industry — optionally auto-collecting exhibitors for every new event found',
  },
  scrape_leads: {
    label: 'Collect Exhibitors',
    icon: Users,
    desc: 'Collect real exhibitors for one chosen event',
  },
  qualify_leads: {
    label: 'AI Qualify New Leads',
    icon: Zap,
    desc: 'Score all NEW leads 0–100 against your saved ICP',
  },
  check_replies: {
    label: 'Check Gmail Replies',
    icon: Mail,
    desc: 'Poll Gmail for real replies and mark leads RESPONDED',
  },
  generate_drafts: {
    label: 'Generate Email Drafts',
    icon: Mail,
    desc: 'Generate outreach drafts for QUALIFIED leads (lands in Pending Review)',
  },
}

const INDUSTRIES = [
  'Technology', 'Healthcare', 'Manufacturing', 'Retail', 'Finance',
  'Construction', 'Education', 'Food & Beverage', 'Automotive', 'Energy',
]

// World locations for the daily discovery — grouped, curated for trade shows
const LOCATIONS: { group: string; items: string[] }[] = [
  { group: 'North America', items: ['United States', 'United States (city-localized)', 'Canada', 'Mexico'] },
  { group: 'Europe', items: ['Germany', 'United Kingdom', 'France', 'Netherlands', 'Italy', 'Spain', 'Switzerland', 'Sweden', 'Turkey'] },
  { group: 'Asia', items: ['India', 'United Arab Emirates', 'Saudi Arabia', 'Singapore', 'China', 'Japan', 'South Korea', 'Hong Kong', 'Thailand', 'Indonesia'] },
  { group: 'Other regions', items: ['Brazil', 'South Africa', 'Australia', 'Worldwide'] },
  { group: 'Custom', items: ['Custom location...'] },
]

const CUSTOM_LOCATION = 'Custom location...'

type ConfigState = {
  industries: string[]
  industry: string
  location: string
  max_events: string
  auto_collect: boolean
  leads_per_event: string
  event_id: string
  max_leads: string
  icp: string
  sender_name: string
  sender_company: string
  sender_role: string
  limit: string
  advanced: string
}

const DEFAULT_CONFIG: ConfigState = {
  industries: ['Technology'],
  industry: 'Technology',
  location: 'United States',
  max_events: '10',
  auto_collect: false,
  leads_per_event: '20',
  event_id: '',
  max_leads: '50',
  icp: '',
  sender_name: '',
  sender_company: '',
  sender_role: 'Business Development',
  limit: '20',
  advanced: '',
}

function configFromTask(task: any): ConfigState {
  const c = task?.config_json || {}
  return {
    ...DEFAULT_CONFIG,
    industries: Array.isArray(c.industries) && c.industries.length ? c.industries : [c.industry || 'Technology'],
    industry: c.industry || 'Technology',
    location: c.location || 'United States',
    max_events: String(c.max_events ?? 10),
    auto_collect: !!c.auto_collect,
    leads_per_event: String(c.leads_per_event ?? 20),
    event_id: c.event_id != null ? String(c.event_id) : '',
    max_leads: String(c.max_leads ?? 50),
    icp: c.icp || '',
    sender_name: c.sender_name || '',
    sender_company: c.sender_company || '',
    sender_role: c.sender_role || 'Business Development',
    limit: String(c.limit ?? 20),
    advanced: Object.keys(c).length ? JSON.stringify(c, null, 0) : '',
  }
}

function buildConfig(form: { task_type: string; state: ConfigState }) {
  const s = form.state
  if (s.advanced.trim()) {
    try {
      return JSON.parse(s.advanced)
    } catch {
      throw new Error('Advanced config must be valid JSON')
    }
  }
  const cfg: Record<string, unknown> = {}
  if (form.task_type === 'discover_events') {
    if (!s.industries.length) throw new Error('Pick at least one industry')
    cfg.industries = s.industries
    cfg.location = s.location || 'United States'
    cfg.max_events = Number(s.max_events) || 10
    if (s.auto_collect) {
      cfg.auto_collect = true
      cfg.leads_per_event = Number(s.leads_per_event) || 20
    }
  } else if (form.task_type === 'scrape_leads') {
    if (!s.event_id) throw new Error('Pick an event')
    cfg.event_id = Number(s.event_id)
    cfg.max_leads = Number(s.max_leads) || 50
  } else if (form.task_type === 'qualify_leads') {
    if (s.icp.trim()) cfg.icp = s.icp.trim()
  } else if (form.task_type === 'generate_drafts') {
    if (s.sender_name) cfg.sender_name = s.sender_name
    if (s.sender_company) cfg.sender_company = s.sender_company
    if (s.sender_role) cfg.sender_role = s.sender_role
    cfg.limit = Number(s.limit) || 20
  }
  return cfg
}

export default function Automation() {
  const queryClient = useQueryClient()
  const [trackedJobs, setTrackedJobs] = useState<TrackedJob[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('tradehub_active_jobs') || '[]') as TrackedJob[]
    } catch {
      return []
    }
  })

  useEffect(() => {
    sessionStorage.setItem('tradehub_active_jobs', JSON.stringify(trackedJobs))
  }, [trackedJobs])

  const dismissJob = (jobId: number) => {
    setTrackedJobs(prev => {
      const next = prev.filter(j => j.jobId !== jobId)
      sessionStorage.setItem('tradehub_active_jobs', JSON.stringify(next))
      return next
    })
  }

  const [showCreate, setShowCreate] = useState(false)
  const [editingTask, setEditingTask] = useState<any | null>(null)
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState('discover_events')
  const [cfg, setCfg] = useState<ConfigState>({ ...DEFAULT_CONFIG })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['scheduled-tasks'],
    queryFn: () => schedulerApi.list(),
    refetchInterval: 30_000,
  })

  const { data: runsData } = useQuery({
    queryKey: ['scheduler-runs'],
    queryFn: () => schedulerApi.getRuns(),
    refetchInterval: 60_000,
  })

  const { data: eventsData } = useQuery({
    queryKey: ['events-for-automation'],
    queryFn: () => eventsApi.getAll({ limit: 200 }),
    staleTime: 60_000,
  })
  const events = eventsData?.data?.events || []

  const resetForm = () => {
    setFormName('')
    setFormType('discover_events')
    setCfg({ ...DEFAULT_CONFIG })
    setEditingTask(null)
  }

  const openCreate = () => {
    resetForm()
    setShowCreate(true)
  }

  const openEdit = (task: any) => {
    setEditingTask(task)
    setFormName(task.name)
    setFormType(task.task_type)
    setCfg(configFromTask(task))
    setHour(String(task.hour ?? 9))
    setMinute(String(task.minute ?? 0))
    setShowCreate(true)
  }

  const createMutation = useMutation({
    mutationFn: (payload: object) => schedulerApi.create(payload),
    onSuccess: () => {
      toast.success('Automation scheduled!')
      setShowCreate(false)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create automation'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: object }) => schedulerApi.update(id, payload),
    onSuccess: () => {
      toast.success('Automation updated')
      setShowCreate(false)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update automation'),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      schedulerApi.update(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] }),
    onError: () => toast.error('Failed to update'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => schedulerApi.delete(id),
    onSuccess: () => {
      toast.success('Automation deleted')
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
    },
  })

  const runNowMutation = useMutation({
    mutationFn: (args: { id: number; name: string }) => schedulerApi.runNow(args.id),
    onSuccess: (res: any, args) => {
      const jobId = res.data?.job_id
      if (jobId) {
        setTrackedJobs(prev => [
          { jobId, kind: 'events' as const, label: `${args.name} — run now`, status: 'running' },
          ...prev.filter(j => j.jobId !== jobId),
        ])
      }
      toast.success(`Started! Watch the run live below.`)
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
    },
    onError: (err: any) => toast.error(err?.message || err?.response?.data?.detail || 'Run failed to start'),
  })

  const tasks = data?.data || []
  const runs = runsData?.data || []

  const submit = () => {
    if (!formName.trim()) {
      toast.error('Give the automation a name')
      return
    }
    let config: Record<string, unknown>
    try {
      config = buildConfig({ task_type: formType, state: cfg })
    } catch (e: any) {
      toast.error(e?.message || 'Invalid config')
      return
    }
    const payload: Record<string, unknown> = {
      name: formName.trim(),
      task_type: formType,
      hour: Number(hour) || 9,
      minute: Number(minute) || 0,
      enabled: true,
      config_json: config,
    }
    if (editingTask) {
      updateMutation.mutate({ id: editingTask.id, payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const [hour, setHour] = useState('9')
  const [minute, setMinute] = useState('0')

  // Live schedule preview — recomputes on every hour/minute change
  const timePreview = (() => {
    const h = Math.min(23, Math.max(0, Number(hour) || 0))
    const m = Math.min(59, Math.max(0, Number(minute) || 0))
    const utcLabel = `Runs daily at ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`
    let localLabel = '——'
    let nextLabel = ''
    try {
      // Next occurrence in UTC
      const now = new Date()
      const next = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0,
      ))
      if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
      // same instant rendered in the viewer's timezone
      localLabel = `= ${next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} your local time (server saves UTC)`
      nextLabel = `Next run: ${next.toUTCString().replace(' GMT', ' UTC')}`
    } catch {
      // date math guard — never fatal
    }
    return { utcLabel, localLabel, nextLabel }
  })()

  const toggleIndustry = (ind: string) => {
    setCfg(c => {
      const has = c.industries.includes(ind)
      return { ...c, industries: has ? c.industries.filter(i => i !== ind) : [...c.industries, ind] }
    })
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* ── Live run monitor (Run Now / daily runs stream here) ──────────── */}
      <LiveJobMonitor jobs={trackedJobs} onDismiss={dismissJob} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1">
          Daily automations run the same pipeline as manual buttons — click "Run Now" and watch it live right here.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" onClick={openCreate} className="h-9 gap-2">
            <Plus className="w-3.5 h-3.5" /> New Automation
          </Button>
        </div>
      </div>

      {/* Task list */}
      {isLoading && tasks.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <Bot className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No automations yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create one — pick your industries and TradeHub auto-discovers real trade shows daily,
            then auto-collects exhibitors for every new event.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tasks.map((task: any) => {
            const meta = TASK_META[task.task_type] || { label: task.task_type, icon: Bot, desc: '' }
            const Icon = meta.icon
            const running = task.last_status === 'running'
            const cfgSummary = summarizeConfig(task)
            return (
              <Card key={task.id} className={running ? 'border-violet-500/40' : ''}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-violet-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{task.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{meta.label}</p>
                        {cfgSummary && (
                          <p className="text-[11px] text-muted-foreground/80 mt-1 truncate" title={cfgSummary}>
                            {cfgSummary}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={task.enabled ? 'success' : 'secondary'}
                      className="text-[10px] shrink-0"
                    >
                      {task.enabled ? 'Enabled' : 'Paused'}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Daily at {String(task.hour).padStart(2, '0')}:{String(task.minute).padStart(2, '0')} (UTC)
                    </span>
                    {task.last_run_at && (
                      <span className="flex items-center gap-1">
                        Last run: {formatDate(task.last_run_at)}
                        {task.last_status === 'completed' && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                        {task.last_status === 'failed' && <XCircle className="w-3 h-3 text-red-500" />}
                        {task.last_status === 'running' && <Loader2 className="w-3 h-3 animate-spin text-violet-500" />}
                      </span>
                    )}
                    {task.last_result && (
                      <span className="truncate max-w-xs" title={task.last_result}>
                        {truncate(task.last_result.replace(/[{}"[\]]/g, ''), 80)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => toggleMutation.mutate({ id: task.id, enabled: !task.enabled })}
                    >
                      {task.enabled ? 'Pause' : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      disabled={runNowMutation.isPending}
                      onClick={() => runNowMutation.mutate({ id: task.id, name: task.name })}
                    >
                      {task.last_status === 'running' || runNowMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      Run Now
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-violet-500 hover:text-violet-600"
                      onClick={() => openEdit(task)}
                      title="Edit automation (change industries, time...)"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 ml-auto text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete automation "${task.name}"?`)) deleteMutation.mutate(task.id)
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Recent runs */}
      {runs.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm font-semibold mb-3">Recent Runs</p>
            <div className="space-y-2">
              {runs.slice(0, 8).map((run: any, i: number) => (
                <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-border last:border-0">
                  {run.last_status === 'completed' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  ) : run.last_status === 'failed' ? (
                    <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500 shrink-0" />
                  )}
                  <span className="font-medium">{run.name}</span>
                  <span className="text-muted-foreground truncate" title={run.last_result || ''}>
                    {truncate((run.last_result || '').replace(/[{}"[\]]/g, ''), 70)}
                  </span>
                  <span className="ml-auto text-muted-foreground shrink-0">{formatDate(run.last_run_at)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create / Edit modal */}
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); resetForm() } }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-violet-500" />
              {editingTask ? 'Edit Automation' : 'New Daily Automation'}
            </DialogTitle>
            <DialogDescription>
              Runs every day at the chosen time (server/UTC). You can also trigger it manually with "Run Now".
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="e.g. Morning manufacturing + healthcare discovery"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Task</label>
              <Select value={formType} onValueChange={(v) => setFormType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_META).map(([key, meta]) => (
                    <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formType === 'discover_events' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Industries</label>
                  <div className="flex flex-wrap gap-1.5">
                    {INDUSTRIES.map((ind) => {
                      const active = cfg.industries.includes(ind)
                      return (
                        <button
                          key={ind}
                          type="button"
                          onClick={() => toggleIndustry(ind)}
                          className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                            active
                              ? 'bg-violet-500 text-white border-violet-500'
                              : 'text-muted-foreground border-border hover:border-violet-400'
                          }`}
                        >
                          {ind}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The automation discovers upcoming shows for EACH selected industry daily — click chips to add or remove industries anytime.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Location</label>
                    <Select
                      value={LOCATIONS.flatMap(g => g.items).includes(cfg.location) ? cfg.location : CUSTOM_LOCATION}
                      onValueChange={(v) => setCfg({ ...cfg, location: v === CUSTOM_LOCATION ? '' : v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Pick a market or region..." /></SelectTrigger>
                      <SelectContent>
                        {LOCATIONS.map(group => (
                          <div key={group.group}>
                            <p className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase text-muted-foreground/60">{group.group}</p>
                            {group.items.map(item => (
                              <SelectItem key={item} value={item}>{item}</SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                    {!LOCATIONS.flatMap(g => g.items).includes(cfg.location) && (
                      <Input
                        placeholder="e.g. Bangalore, Dubai (free text)"
                        value={cfg.location}
                        onChange={(e) => setCfg({ ...cfg, location: e.target.value })}
                        autoFocus
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Max events / industry</label>
                    <Select value={cfg.max_events} onValueChange={(v) => setCfg({ ...cfg, max_events: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <label className="flex items-start gap-2.5 p-3 rounded-lg border border-violet-500/30 bg-violet-500/5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-violet-500 mt-0.5"
                    checked={cfg.auto_collect}
                    onChange={(e) => setCfg({ ...cfg, auto_collect: e.target.checked })}
                  />
                  <span className="text-xs">
                    <span className="font-medium">Auto-collect exhibitors for newly discovered events</span>
                    <span className="block text-muted-foreground mt-0.5">
                      Fully hands-off: discovery → real exhibitor collection runs chained for every new event found (capped at 10 events/run).
                    </span>
                  </span>
                </label>

                {cfg.auto_collect && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Max exhibitors per event</label>
                    <Input
                      type="number" min={5} max={50} value={cfg.leads_per_event}
                      onChange={(e) => setCfg({ ...cfg, leads_per_event: e.target.value })}
                    />
                  </div>
                )}
              </>
            )}

            {formType === 'scrape_leads' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Event</label>
                <Select value={cfg.event_id} onValueChange={(v) => setCfg({ ...cfg, event_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick an event..." /></SelectTrigger>
                  <SelectContent>
                    {events.map((e: any) => (
                      <SelectItem key={e.id} value={String(e.id)}>{truncate(e.name, 45)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Max exhibitors</label>
                  <Input type="number" min={5} max={50} value={cfg.max_leads} onChange={(e) => setCfg({ ...cfg, max_leads: e.target.value })} />
                </div>
              </div>
            )}

            {formType === 'qualify_leads' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">ICP (optional — blank uses your saved profile ICP)</label>
                <Textarea
                  value={cfg.icp}
                  onChange={(e) => setCfg({ ...cfg, icp: e.target.value })}
                  rows={3}
                  className="text-sm resize-none"
                />
              </div>
            )}

            {formType === 'generate_drafts' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Name</label>
                    <Input className="h-8 text-xs" value={cfg.sender_name} onChange={(e) => setCfg({ ...cfg, sender_name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Company</label>
                    <Input className="h-8 text-xs" value={cfg.sender_company} onChange={(e) => setCfg({ ...cfg, sender_company: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Role</label>
                    <Input className="h-8 text-xs" value={cfg.sender_role} onChange={(e) => setCfg({ ...cfg, sender_role: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Max drafts per run</label>
                  <Input type="number" min={1} max={50} value={cfg.limit} onChange={(e) => setCfg({ ...cfg, limit: e.target.value })} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Hour (UTC)</label>
                <Input type="number" min={0} max={23} value={hour} onChange={(e) => setHour(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Minute</label>
                <Input type="number" min={0} max={59} value={minute} onChange={(e) => setMinute(e.target.value)} />
              </div>
            </div>

            {/* Live-updating schedule preview — reacts instantly to hour/minute edits */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 border border-border text-xs">
              <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-violet-500" />
              <div>
                <p className="font-medium text-foreground">{timePreview.utcLabel}</p>
                <p className="text-muted-foreground mt-0.5">{timePreview.localLabel}</p>
                <p className="text-muted-foreground mt-0.5">{timePreview.nextLabel}</p>
              </div>
            </div>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Advanced: raw JSON config</summary>
              <Textarea
                placeholder='{"industries": ["Technology", "Healthcare"], "location": "United States", "max_events": 10, "auto_collect": true}'
                value={cfg.advanced}
                onChange={(e) => setCfg({ ...cfg, advanced: e.target.value })}
                rows={3}
                className="mt-2 text-xs font-mono resize-none"
              />
              <p className="mt-1">Overrides the fields above. Valid JSON only.</p>
            </details>

            <p className="text-xs text-muted-foreground">{TASK_META[formType]?.desc}</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); resetForm() }}>Cancel</Button>
            <Button onClick={submit} disabled={createMutation.isPending || updateMutation.isPending} className="gap-2">
              {(createMutation.isPending || updateMutation.isPending) ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              {editingTask ? 'Save Changes' : 'Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function summarizeConfig(task: any): string {
  const c = task?.config_json || {}
  const parts: string[] = []
  if (Array.isArray(c.industries) && c.industries.length) parts.push(`industries: ${c.industries.slice(0, 3).join(', ')}${c.industries.length > 3 ? '…' : ''}`)
  if (c.location) parts.push(`location: ${c.location}`)
  if (c.auto_collect) parts.push(`auto-collect ${c.leads_per_event || 20}/event`)
  if (c.event_id) parts.push(`event #${c.event_id}`)
  if (c.icp) parts.push('custom ICP')
  if (parts.length === 0) return ''
  return parts.join(' · ')
}

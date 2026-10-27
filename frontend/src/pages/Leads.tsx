import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Users, Search, Loader2, Star, Mail, Phone, Globe, Zap,
  CheckCircle2, AlertCircle, RefreshCw, Building2, LayoutGrid,
  Table2, Download, Kanban,
  TrendingUp, Clock, XCircle, CheckSquare, Square, ExternalLink
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { leadsApi, eventsApi } from '@/lib/api'
import { formatScore, getScoreColor, truncate } from '@/lib/utils'
import toast from 'react-hot-toast'

const PRIORITY_COLORS: Record<string, any> = {
  high: 'destructive', HIGH: 'destructive',
  medium: 'warning', MEDIUM: 'warning',
  low: 'secondary', LOW: 'secondary',
}

const STATUS_META: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  new:          { color: 'info',        icon: Clock,         label: 'New' },
  qualified:    { color: 'success',     icon: CheckCircle2,  label: 'Qualified' },
  contacted:    { color: 'default',     icon: Mail,          label: 'Contacted' },
  responded:    { color: 'success',     icon: TrendingUp,    label: 'Responded' },
  closed:       { color: 'success',     icon: CheckCircle2,  label: 'Closed' },
  disqualified: { color: 'destructive', icon: XCircle,       label: 'Disqualified' },
}

const PIPELINE_COLUMNS = [
  { key: 'new',          label: 'New',          color: 'bg-blue-500' },
  { key: 'qualified',    label: 'Qualified',    color: 'bg-violet-500' },
  { key: 'contacted',    label: 'Contacted',    color: 'bg-amber-500' },
  { key: 'responded',    label: 'Responded',    color: 'bg-emerald-500' },
  { key: 'closed',       label: 'Closed',       color: 'bg-green-600' },
  { key: 'disqualified', label: 'Disqualified', color: 'bg-red-500' },
]

// ─── Lead Card (Grid) ─────────────────────────────────────────────────────────
function LeadCard({ lead, onQualify, onEmail, checked, onCheck }: {
  lead: any
  onQualify: (id: number) => void
  onEmail: (lead: any) => void
  checked: boolean
  onCheck: () => void
}) {
  const meta = STATUS_META[lead.status] || STATUS_META.new
  const StatusIcon = meta.icon

  return (
    <Card className="hover:shadow-md transition-all duration-200 group hover:border-violet-300/50">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={onCheck} className="shrink-0 mt-0.5" title={checked ? 'Deselect lead' : 'Select lead'}>
              {checked ? (
                <CheckSquare className="w-4 h-4 text-violet-500" />
              ) : (
                <Square className="w-4 h-4 text-muted-foreground/40 hover:text-muted-foreground" />
              )}
            </button>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-indigo-500/20 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{lead.company_name}</p>
              {lead.contact_name && (
                <p className="text-xs text-muted-foreground truncate">
                  {lead.contact_name}{lead.contact_designation && ` · ${lead.contact_designation}`}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {lead.priority && (
              <Badge variant={PRIORITY_COLORS[lead.priority] || 'outline'} className="text-[10px] capitalize">
                {lead.priority}
              </Badge>
            )}
            <Badge variant={meta.color as any} className="text-[10px] flex items-center gap-0.5">
              <StatusIcon className="w-2.5 h-2.5" />
              {meta.label}
            </Badge>
          </div>
        </div>

        {/* Score bar */}
        {lead.relevance_score != null && lead.relevance_score > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Star className="w-3 h-3" /> AI Score
              </span>
              <span className={`text-[11px] font-bold ${getScoreColor(lead.relevance_score)}`}>
                {formatScore(lead.relevance_score)}
              </span>
            </div>
            <Progress value={lead.relevance_score} className="h-1.5" />
          </div>
        )}

        {lead.business_category && (
          <p className="text-xs text-muted-foreground mb-2">{lead.business_category}</p>
        )}

        {lead.qualification_notes && (
          <p className="text-xs text-muted-foreground mb-3 line-clamp-2 italic bg-muted/30 rounded p-1.5">
            "{truncate(lead.qualification_notes, 100)}"
          </p>
        )}

        {/* Contact info */}
        <div className="flex items-center gap-3 flex-wrap">
          {lead.contact_email && (
            <a href={`mailto:${lead.contact_email}`} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <Mail className="w-3 h-3" />
              <span className="truncate max-w-[130px]">{lead.contact_email}</span>
            </a>
          )}
          {lead.contact_phone && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Phone className="w-3 h-3" />{lead.contact_phone}
            </span>
          )}
          {lead.company_website && (
            <a href={lead.company_website} target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <Globe className="w-3 h-3" /> Site
            </a>
          )}
          {lead.source_url && (
            <a href={lead.source_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-violet-500/80 hover:text-violet-500 flex items-center gap-1 transition-colors"
              title="Verified source link (where this lead data came from)">
              <ExternalLink className="w-3 h-3" /> Source
            </a>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border opacity-0 group-hover:opacity-100 transition-opacity">
          {lead.status === 'new' && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onQualify(lead.id)}>
              <Zap className="w-3 h-3" /> AI Qualify
            </Button>
          )}
          {lead.contact_email && (
            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => onEmail(lead)}>
              <Mail className="w-3 h-3" /> Draft Email
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Kanban Card ──────────────────────────────────────────────────────────────
function KanbanCard({ lead, onQualify, onEmail, checked, onCheck }: {
  lead: any; onQualify: (id: number) => void; onEmail: (lead: any) => void
  checked: boolean; onCheck: () => void
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 hover:shadow-sm hover:border-violet-300/50 transition-all group cursor-pointer">
      <div className="flex items-start justify-between gap-1 mb-2">
        <button onClick={onCheck} className="shrink-0 mt-0.5" title={checked ? 'Deselect lead' : 'Select lead'}>
          {checked ? (
            <CheckSquare className="w-3.5 h-3.5 text-violet-500" />
          ) : (
            <Square className="w-3 h-3 text-muted-foreground/40 hover:text-muted-foreground" />
          )}
        </button>
        <p className="text-xs font-semibold leading-tight flex-1">{lead.company_name}</p>
        {lead.relevance_score > 0 && (
          <span className={`text-[10px] font-bold shrink-0 ${getScoreColor(lead.relevance_score)}`}>
            {Math.round(lead.relevance_score)}
          </span>
        )}
      </div>
      {lead.contact_name && (
        <p className="text-[10px] text-muted-foreground mb-1.5">{lead.contact_name}</p>
      )}
      {lead.contact_email && (
        <p className="text-[10px] text-muted-foreground truncate mb-1.5">{lead.contact_email}</p>
      )}
      {lead.priority && (
        <Badge variant={PRIORITY_COLORS[lead.priority] || 'outline'} className="text-[9px] mb-2 capitalize">
          {lead.priority}
        </Badge>
      )}
      <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {lead.status === 'new' && (
          <button onClick={() => onQualify(lead.id)}
            className="text-[10px] text-violet-600 hover:text-violet-700 flex items-center gap-0.5">
            <Zap className="w-2.5 h-2.5" /> Qualify
          </button>
        )}
        {lead.contact_email && (
          <button onClick={() => onEmail(lead)}
            className="text-[10px] text-violet-600 hover:text-violet-700 flex items-center gap-0.5 ml-auto">
            <Mail className="w-2.5 h-2.5" /> Email
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Table Row ────────────────────────────────────────────────────────────────
function LeadTableRow({ lead, onQualify, onEmail, checked, onCheck }: {
  lead: any; onQualify: (id: number) => void; onEmail: (lead: any) => void
  checked: boolean; onCheck: () => void
}) {
  const meta = STATUS_META[lead.status] || STATUS_META.new
  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors group">
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-2">
          <button onClick={onCheck} title={checked ? 'Deselect lead' : 'Select lead'}>
            {checked ? (
              <CheckSquare className="w-4 h-4 text-violet-500" />
            ) : (
              <Square className="w-3.5 h-3.5 text-muted-foreground/40 hover:text-muted-foreground" />
            )}
          </button>
          <div>
            <p className="text-sm font-medium">{lead.company_name}</p>
            {lead.business_category && <p className="text-[10px] text-muted-foreground">{lead.business_category}</p>}
          </div>
        </div>
      </td>
      <td className="py-2.5 px-4">
        <div>
          <p className="text-xs">{lead.contact_name || '—'}</p>
          {lead.contact_email && <p className="text-[10px] text-muted-foreground">{lead.contact_email}</p>}
        </div>
      </td>
      <td className="py-2.5 px-4">
        <Badge variant={meta.color as any} className="text-[10px] capitalize">{meta.label}</Badge>
      </td>
      <td className="py-2.5 px-4">
        {lead.priority && (
          <Badge variant={PRIORITY_COLORS[lead.priority] || 'outline'} className="text-[10px] capitalize">{lead.priority}</Badge>
        )}
      </td>
      <td className="py-2.5 px-4 text-right">
        {lead.relevance_score > 0 ? (
          <span className={`text-xs font-bold ${getScoreColor(lead.relevance_score)}`}>
            {Math.round(lead.relevance_score)}
          </span>
        ) : '—'}
      </td>
      <td className="py-2.5 px-4">
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {lead.status === 'new' && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onQualify(lead.id)}>
              <Zap className="w-3 h-3 text-violet-500" />
            </Button>
          )}
          {lead.contact_email && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEmail(lead)}>
              <Mail className="w-3 h-3 text-violet-500" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── Export CSV helper (same column layout as the backend export) ────────────
function exportLeadsCSV(leads: any[]) {
  const headers = [
    'Company', 'Website', 'Contact Person', 'Designation', 'Email', 'Phone',
    'Industry', 'Business Category', 'Status', 'Priority', 'AI Score / 100',
    'AI Qualification Notes', 'Verified Source Link', 'Data Verified', 'Added On',
  ]
  const rows = leads.map(l => [
    l.company_name,
    l.company_website,
    l.contact_name,
    l.contact_designation,
    l.contact_email,
    l.contact_phone,
    (l.industry || '').toString(),
    l.business_category,
    (l.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    (l.priority || '').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    l.relevance_score != null ? Math.round(l.relevance_score) : '',
    l.qualification_notes,
    l.source_url,
    l.data_verified ? 'Yes' : 'No',
    l.created_at ? new Date(l.created_at).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
  ].map((v: any) => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(','))
  // \r\n + BOM keep Excel/Sheets happy
  const csv = '\ufeff' + [headers.join(','), ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `TradeHub_AI_Leads_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.success(`${leads.length} leads exported — ready for Excel/Sheets!`)
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Leads() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [minScore, setMinScore] = useState('25')
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [icpDescription, setIcpDescription] = useState('')
  const [eventFilter, setEventFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'grid' | 'table' | 'kanban'>('grid')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Load ICP from settings profile
  useEffect(() => {
    try {
      const profile = JSON.parse(localStorage.getItem('tradehub_company_profile') || '{}')
      if (profile.icp_description) setIcpDescription(profile.icp_description)
    } catch {
      // no saved ICP yet
    }
  }, [])

  const { data: eventsData } = useQuery({
    queryKey: ['events-list'],
    queryFn: () => eventsApi.getAll({ limit: 200 }),
    staleTime: 60_000,
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['leads', search, status, priority, minScore, eventFilter],
    queryFn: () =>
      leadsApi.getAll({
        search: search || undefined,
        status: status === 'all' ? undefined : status,
        priority: priority === 'all' ? undefined : priority,
        min_score: minScore ? Number(minScore) : undefined,
        event_id: eventFilter === 'all' ? undefined : Number(eventFilter),
        limit: 200,
      }),
    staleTime: 30_000,
  })

  const qualifyMutation = useMutation({
    mutationFn: (id: number) =>
      leadsApi.qualify(id, icpDescription ? { icp_description: icpDescription } : {}),
    onSuccess: () => { toast.success('Lead scored by Gemini'); queryClient.invalidateQueries({ queryKey: ['leads'] }) },
    onError: () => toast.error('Failed to qualify lead'),
  })

  const bulkQualifyMutation = useMutation({
    mutationFn: (payload: any) => leadsApi.bulkQualify(payload),
    onSuccess: (res: any) => {
      toast.success(res?.data?.message || `${res?.data?.qualified_count ?? 0} leads qualified`)
      setShowBulkModal(false)
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
    onError: (err: any) => toast.error(err?.message || 'Bulk qualify failed'),
  })

  const leads = data?.data?.leads || []
  const totalLeads = data?.data?.total || 0
  const events = eventsData?.data?.events || []

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allVisibleSelected = leads.length > 0 && leads.every((l: any) => selectedIds.has(l.id))
  const toggleSelectAll = () => {
    setSelectedIds(() => {
      if (allVisibleSelected) return new Set()
      return new Set(leads.map((l: any) => l.id))
    })
  }

  const handleDraftEmail = (lead: any) => {
    navigate(`/emails?lead_id=${lead.id}`)
  }

  // Kanban: group by status
  const kanbanGroups = PIPELINE_COLUMNS.map(col => ({
    ...col,
    leads: leads.filter((l: any) => l.status === col.key),
  }))

  return (
    <div className="space-y-5 animate-in fade-in duration-300">

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search leads..." value={search}
            onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-36 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="qualified">Qualified</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="responded">Responded</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="disqualified">Disqualified</SelectItem>
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="h-9 w-32 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5 h-9">
          <Star className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Input
            type="number" min={0} max={100}
            placeholder="Min score"
            value={minScore}
            onChange={e => setMinScore(e.target.value)}
            className="h-8 w-20 text-xs"
            title="Minimum AI score filter (empty = show all)"
          />
        </div>

        <Select value={eventFilter} onValueChange={setEventFilter}>
          <SelectTrigger className="h-9 w-44 text-xs"><SelectValue placeholder="Event" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            {events.map((e: any) => (
              <SelectItem key={e.id} value={String(e.id)}>{truncate(e.name, 30)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1 border border-border rounded-lg p-1">
          <button onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-violet-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            title="Grid view">
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setViewMode('kanban')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'kanban' ? 'bg-violet-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            title="Pipeline view">
            <Kanban className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setViewMode('table')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'table' ? 'bg-violet-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            title="Table view">
            <Table2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={() => exportLeadsCSV(leads)} className="h-9 gap-1.5" disabled={leads.length === 0}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          {selectedIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              className="h-9 gap-1.5"
              title="Clear selection"
            >
              <XCircle className="w-3.5 h-3.5" /> {selectedIds.size} selected
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" onClick={() => setShowBulkModal(true)} className="h-9 gap-2">
            <Zap className="w-3.5 h-3.5" /> Bulk AI Qualify
          </Button>
        </div>
      </div>

      {/* ── Summary bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted-foreground">{totalLeads} leads total</span>
        <span className="text-emerald-500 flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {leads.filter((l: any) => l.status === 'qualified').length} qualified
        </span>
        <span className="text-violet-500 flex items-center gap-1">
          <Mail className="w-3.5 h-3.5" />
          {leads.filter((l: any) => l.status === 'contacted').length} contacted
        </span>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>

      {/* ── Views ────────────────────────────────────────────────────────── */}
      {isLoading && leads.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <Users className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No leads found</p>
          <p className="text-xs text-muted-foreground mt-1">Go to Trade Shows → click ⚡ to scrape exhibitor leads</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {leads.map((lead: any) => (
            <LeadCard key={lead.id} lead={lead}
              checked={selectedIds.has(lead.id)} onCheck={() => toggleSelect(lead.id)}
              onQualify={id => qualifyMutation.mutate(id)} onEmail={handleDraftEmail} />
          ))}
        </div>

      ) : viewMode === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {kanbanGroups.map(col => (
            <div key={col.key} className="flex-shrink-0 w-64">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <span className="text-xs text-muted-foreground ml-auto bg-muted rounded-full px-2">
                  {col.leads.length}
                </span>
              </div>
              <div className="space-y-2 min-h-[200px]">
                {col.leads.length === 0 ? (
                  <div className="h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">Empty</span>
                  </div>
                ) : col.leads.map((lead: any) => (
                  <KanbanCard key={lead.id} lead={lead}
                    checked={selectedIds.has(lead.id)} onCheck={() => toggleSelect(lead.id)}
                    onQualify={id => qualifyMutation.mutate(id)} onEmail={handleDraftEmail} />
                ))}
              </div>
            </div>
          ))}
        </div>

      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="py-2.5 px-3 text-left text-xs">
                  <button onClick={toggleSelectAll} title={allVisibleSelected ? 'Deselect all' : 'Select all shown'}>
                    {allVisibleSelected ? (
                      <CheckSquare className="w-4 h-4 text-violet-500" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-muted-foreground/50" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground">Company</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground">Contact</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground">Status</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground">Priority</th>
                <th className="py-2.5 px-4 text-right text-xs font-semibold text-muted-foreground">Score</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead: any) => (
                <LeadTableRow key={lead.id} lead={lead}
                  checked={selectedIds.has(lead.id)} onCheck={() => toggleSelect(lead.id)}
                  onQualify={id => qualifyMutation.mutate(id)} onEmail={handleDraftEmail} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Bulk Qualify Modal ────────────────────────────────────────────── */}
      <Dialog open={showBulkModal} onOpenChange={setShowBulkModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-500" />
              Bulk AI Lead Qualification
            </DialogTitle>
            <DialogDescription>
              {selectedIds.size > 0
                ? `Score the ${selectedIds.size} selected lead${selectedIds.size !== 1 ? 's' : ''} with Gemini`
                : 'Select leads with the checkboxes first, or close and pick some'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ideal Customer Profile (ICP)</label>
              <Textarea
                placeholder="e.g., B2B manufacturers with 50-500 employees in the USA, decision-makers are VP Operations or CTO..."
                value={icpDescription}
                onChange={e => setIcpDescription(e.target.value)}
                rows={4}
                className="text-sm resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Tip: Save your ICP in <a href="/settings" className="text-violet-500 hover:underline">Settings</a> to auto-fill here.
              </p>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-500/10 text-xs text-violet-700 dark:text-violet-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>Gemini scores each lead 0–100 in batches. Qualification preserves pipeline status for already-contacted leads.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkModal(false)}>Cancel</Button>
            <Button
              onClick={() => bulkQualifyMutation.mutate({ icp_description: icpDescription, lead_ids: Array.from(selectedIds) })}
              disabled={bulkQualifyMutation.isPending || selectedIds.size === 0}
              className="gap-2"
            >
              {bulkQualifyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Qualify {selectedIds.size > 0 ? `${selectedIds.size} Leads` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

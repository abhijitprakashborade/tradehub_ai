import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Calendar,
  Search,
  RefreshCw,
  Loader2,
  MapPin,
  ExternalLink,
  Trash2,
  Users,
  Globe,
  Zap,
  AlertCircle,
  Radio,
  Plus,
  Pencil,
  LinkIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { eventsApi, leadsApi } from '@/lib/api'
import { LiveJobMonitor, TrackedJob } from '@/components/jobs/LiveJobMonitor'
import { formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

const INDUSTRIES = [
  'Technology', 'Healthcare', 'Manufacturing', 'Retail', 'Finance',
  'Construction', 'Education', 'Food & Beverage', 'Automotive', 'Energy',
]

// Rehydrate previously-started jobs (server is the source of truth)
const ACTIVE_JOBS_KEY = 'tradehub_active_jobs'

function loadActiveJobs(): TrackedJob[] {
  try {
    return JSON.parse(sessionStorage.getItem(ACTIVE_JOBS_KEY) || '[]') as TrackedJob[]
  } catch {
    return []
  }
}

function saveActiveJobs(jobs: TrackedJob[]) {
  sessionStorage.setItem(ACTIVE_JOBS_KEY, JSON.stringify(jobs))
}

// ─── Event Card ───────────────────────────────────────────────────────────────

function EventCard({
  event,
  onDelete,
  onScrapeLeads,
  onEdit,
}: {
  event: any
  onDelete: (id: number) => void
  onScrapeLeads: (event: any) => void
  onEdit: (event: any) => void
}) {
  const statusColors: Record<string, string> = {
    upcoming: 'success',
    ongoing: 'info',
    completed: 'secondary',
    cancelled: 'destructive',
  }

  return (
    <Card className="hover:shadow-md transition-shadow duration-200 group">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 mb-1">
              <h3 className="font-semibold text-sm leading-tight">{event.name}</h3>
              <Badge variant={statusColors[event.status] as any || 'outline'} className="shrink-0 text-[10px]">
                {event.status}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
              {event.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {event.location}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(event.start_date)}
                {event.end_date && ` – ${formatDate(event.end_date)}`}
              </span>
              {event.expected_exhibitors && (
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  ~{event.expected_exhibitors} exhibitors
                </span>
              )}
              {event.leads_count > 0 && (
                <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400 font-medium">
                  <Users className="w-3 h-3" />
                  {event.leads_count} leads
                </span>
              )}
            </div>

            {event.industry && (
              <Badge variant="outline" className="mt-2 text-[10px]">
                {event.industry}
              </Badge>
            )}

            {event.description && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {event.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {event.website && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => window.open(event.website, '_blank')}
                title="Open official website"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onEdit(event)}
              title="Edit event / add exhibitor directory URL"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-violet-500 hover:text-violet-600"
              onClick={() => onScrapeLeads(event)}
              title="Collect real exhibitor leads for this event"
            >
              <Zap className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onDelete(event.id)}
              title="Remove event"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {event.source_url && (
          <a
            href={event.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-[10px] text-muted-foreground hover:text-violet-500 transition-colors"
            title="Verified source link (where this event data came from)"
          >
            <LinkIcon className="w-3 h-3" />
            Source (verified)
          </a>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '',
  location: '',
  city: '',
  state: '',
  country: 'United States',
  industry: '',
  start_date: '',
  end_date: '',
  venue: '',
  website: '',
  exhibitor_directory_url: '',
  description: '',
  status: 'upcoming',
}

export default function Events() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('all')
  const [status, setStatus] = useState('all')
  const [showScrapeModal, setShowScrapeModal] = useState(false)
  const [showLeadModal, setShowLeadModal] = useState<any>(null)
  const [scrapeIndustry, setScrapeIndustry] = useState('Technology')
  const [scrapeLocation, setScrapeLocation] = useState('United States')
  const [maxEvents, setMaxEvents] = useState('10')
  const [activeJobs, setActiveJobs] = useState<TrackedJob[]>(() => loadActiveJobs())
  const [editingEvent, setEditingEvent] = useState<any | 'new' | null>(null)
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM)

  // Persist tracked jobs so the live monitor survives tab navigation
  useEffect(() => {
    saveActiveJobs(activeJobs)
  }, [activeJobs])

  const trackJob = (jobId: number, kind: 'events' | 'leads', label: string) => {
    setActiveJobs((prev) =>
      [{ jobId, kind, label, status: 'running' }, ...prev.filter((j) => j.jobId !== jobId)]
    )
  }

  const dismissJob = (jobId: number) => {
    setActiveJobs((prev) => {
      const next = prev.filter((j) => j.jobId !== jobId)
      saveActiveJobs(next)
      return next
    })
  }

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['events', search, industry, status],
    queryFn: () =>
      eventsApi.getAll({
        search: search || undefined,
        industry: industry === 'all' ? undefined : industry,
        status: status === 'all' ? undefined : status,
        limit: 100,
      }),
    staleTime: 30_000,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────
  const scrapeMutation = useMutation({
    mutationFn: (payload: any) => eventsApi.scrape(payload),
    onSuccess: (res) => {
      const jobId = res.data.job_id
      setShowScrapeModal(false)
      trackJob(jobId, 'events', `Discovering real ${scrapeIndustry} trade shows in ${scrapeLocation}`)
    },
    onError: () => toast.error('Failed to start discovery'),
  })

  const scrapeLeadsMutation = useMutation({
    mutationFn: (payload: any) => leadsApi.scrape(payload),
    onSuccess: (res, variables: any) => {
      const jobId = res.data.job_id
      setShowLeadModal(null)
      const eventName = showLeadModal?.name || `Event #${variables.event_id}`
      trackJob(jobId, 'leads', `Collecting real exhibitors for: ${eventName}`)
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail || 'Failed to start lead collection'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => eventsApi.delete(id),
    onSuccess: () => {
      toast.success('Event removed')
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['full-report'] })
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail || 'Failed to delete event'),
  })

  const saveEventMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number | null; payload: any }) =>
      id ? eventsApi.update(id, payload) : eventsApi.create(payload),
    onSuccess: () => {
      toast.success(editingEvent === 'new' ? 'Event created' : 'Event updated')
      setEditingEvent(null)
      queryClient.invalidateQueries({ queryKey: ['events'] })
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to save event'),
  })

  const openEdit = (event: any) => {
    setEditingEvent(event)
    setForm({
      name: event.name || '',
      location: event.location || '',
      city: event.city || '',
      state: event.state || '',
      country: event.country || 'United States',
      industry: event.industry || '',
      start_date: event.start_date || '',
      end_date: event.end_date || '',
      venue: event.venue || '',
      website: event.website || '',
      exhibitor_directory_url: event.exhibitor_directory_url || '',
      description: event.description || '',
      status: event.status || 'upcoming',
    })
  }

  const openCreate = () => {
    setEditingEvent('new')
    setForm(EMPTY_FORM)
  }

  const handleDelete = (id: number) => {
    if (confirm('Remove this event? Its leads stay in the Leads page but the event card will be hidden.')) {
      deleteMutation.mutate(id)
    }
  }

  const events = data?.data?.events || []
  const runningJobs = activeJobs.filter((j) => j.status === 'running' || j.status === 'pending')

  return (
    <div className="space-y-5 animate-in fade-in duration-300">

      {/* ── Live Job Tracker (real SSE stream) ───────────────────────────── */}
      <LiveJobMonitor jobs={activeJobs} onDismiss={dismissJob} />

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Select value={industry} onValueChange={setIndustry}>
          <SelectTrigger className="h-9 w-40 text-xs">
            <SelectValue placeholder="Industry" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Industries</SelectItem>
            {INDUSTRIES.map((i) => (
              <SelectItem key={i} value={i}>{i}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-36 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
            <SelectItem value="ongoing">Ongoing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9 gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={openCreate} className="h-9 gap-2">
            <Plus className="w-3.5 h-3.5" />
            Add Event
          </Button>
          <Button
            size="sm"
            onClick={() => setShowScrapeModal(true)}
            className="h-9 gap-2"
            disabled={runningJobs.length > 0}
          >
            {runningJobs.length > 0 ? (
              <>
                <Radio className="w-3.5 h-3.5 animate-pulse text-violet-300" />
                Working...
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5" />
                Discover Events
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── Count ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {events.length} event{events.length !== 1 ? 's' : ''} found
        </span>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>

      {/* ── Events Grid ──────────────────────────────────────────────────── */}
      {isLoading && events.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <Calendar className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No events found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Click "Discover Events" for grounded live web discovery, or add one manually
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {events.map((event: any) => (
            <EventCard
              key={event.id}
              event={event}
              onDelete={handleDelete}
              onScrapeLeads={(e) => setShowLeadModal(e)}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      {/* ── Scrape Events Modal ───────────────────────────────────────────── */}
      <Dialog open={showScrapeModal} onOpenChange={setShowScrapeModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-violet-500" />
              Discover Trade Shows
            </DialogTitle>
            <DialogDescription>
              Gemini + Google Search grounding scans the live web for REAL upcoming trade shows
              — every event saved carries a verifiable source link. Watch the search happen live.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Location</label>
              <Input
                placeholder="United States (or a city/region)"
                value={scrapeLocation}
                onChange={(e) => setScrapeLocation(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Industry</label>
              <Select value={scrapeIndustry} onValueChange={setScrapeIndustry}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((i) => (
                    <SelectItem key={i} value={i}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Max Events to Discover</label>
              <Select value={maxEvents} onValueChange={setMaxEvents}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 events</SelectItem>
                  <SelectItem value="10">10 events</SelectItem>
                  <SelectItem value="20">20 events</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-500/10 text-xs text-violet-700 dark:text-violet-300">
              <Radio className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                Live job feed shows every real Google Search query and page fetch. If fewer events
                can be verified, the job honestly reports fewer — nothing is invented.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScrapeModal(false)}>Cancel</Button>
            <Button
              onClick={() =>
                scrapeMutation.mutate({ industry: scrapeIndustry, location: scrapeLocation || 'United States', max_events: Number(maxEvents) })
              }
              disabled={scrapeMutation.isPending}
              className="gap-2"
            >
              {scrapeMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              Start Discovery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Scrape Leads Modal ────────────────────────────────────────────── */}
      {showLeadModal && (
        <Dialog open={!!showLeadModal} onOpenChange={() => setShowLeadModal(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-500" />
                Collect Real Exhibitors
              </DialogTitle>
              <DialogDescription>
                For: <strong>{showLeadModal.name}</strong> — real directory pages + grounded web
                search. Found companies keep their verified source links.
              </DialogDescription>
            </DialogHeader>

            <div className="py-2 space-y-3">
              {showLeadModal.exhibitor_directory_url ? (
                <p className="text-xs text-muted-foreground flex items-start gap-2">
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Directory URL: <span className="truncate">{showLeadModal.exhibitor_directory_url}</span>
                    <br />Grounded search runs as backup if the page blocks robots.
                  </span>
                </p>
              ) : (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>
                    No exhibitor directory URL set for this event — grounded search will find the
                    real exhibitor list. For best results, edit the event and paste the official
                    exhibitor-directory URL.
                  </p>
                </div>
              )}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-500/10 text-xs text-violet-700 dark:text-violet-300">
                <Radio className="w-4 h-4 shrink-0 mt-0.5" />
                <p>Watch the live job feed — real pages being fetched are listed as they happen.</p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowLeadModal(null)}>Cancel</Button>
              <Button
                onClick={() =>
                  scrapeLeadsMutation.mutate({
                    event_id: showLeadModal.id,
                    max_leads: 50,
                  })
                }
                disabled={scrapeLeadsMutation.isPending}
                className="gap-2"
              >
                {scrapeLeadsMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                Collect Exhibitors
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Create / Edit Event Modal ─────────────────────────────────────── */}
      <Dialog open={!!editingEvent} onOpenChange={(open) => { if (!open) setEditingEvent(null) }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-violet-500" />
              {editingEvent === 'new' ? 'Add Event Manually' : 'Edit Event'}
            </DialogTitle>
            <DialogDescription>
              All fields optional except the name. The exhibitor directory URL powers
              direct exhibitor scraping during lead collection.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Event Name *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. CES 2027" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Location</label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Las Vegas, Nevada, USA" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">City</label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">State</label>
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Industry</label>
              <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="Technology" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Status</label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="ongoing">Ongoing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Start Date</label>
              <Input value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} placeholder="Jan 06, 2027" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">End Date</label>
              <Input value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} placeholder="Jan 09, 2027" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Venue</label>
              <Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Las Vegas Convention Center" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Official Website</label>
              <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://..." />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Exhibitor Directory URL</label>
              <Input value={form.exhibitor_directory_url} onChange={(e) => setForm({ ...form, exhibitor_directory_url: e.target.value })} placeholder="https://event.com/exhibitors" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="resize-none" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEvent(null)}>Cancel</Button>
            <Button
              disabled={!form.name.trim() || saveEventMutation.isPending}
              onClick={() =>
                saveEventMutation.mutate({
                  id: editingEvent === 'new' ? null : editingEvent.id,
                  payload: {
                    ...form,
                    name: form.name.trim(),
                    country: form.country || 'United States',
                  },
                })
              }
              className="gap-2"
            >
              {saveEventMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {editingEvent === 'new' ? 'Create Event' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

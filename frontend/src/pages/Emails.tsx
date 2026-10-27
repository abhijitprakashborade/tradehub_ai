import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Mail,
  Search,
  Loader2,
  Send,
  Eye,
  CheckCircle2,
  XCircle,
  Zap,
  RefreshCw,
  Plus,
  Copy,
  AlertCircle,
  Inbox,
  GitBranch,
  MousePointerClick,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { emailsApi, leadsApi, gmailApi, eventsApi } from '@/lib/api'
import { formatDate, truncate } from '@/lib/utils'
import toast from 'react-hot-toast'

const EMAIL_STATUS_COLORS: Record<string, any> = {
  pending_review: 'warning',
  approved: 'success',
  skipped: 'destructive',
  draft: 'info',
  sent: 'default',
  failed: 'destructive',
}

const EMAIL_STATUS_ICONS: Record<string, React.ElementType> = {
  pending_review: AlertCircle,
  approved: CheckCircle2,
  skipped: XCircle,
  draft: GitBranch,
  sent: Send,
  failed: XCircle,
}

function EmailCard({ email, onApprove, onReject, onSend, onCreateDraft, onPreview }: {
  email: any
  onApprove: (id: number) => void
  onReject: (id: number) => void
  onSend: (id: number) => void
  onCreateDraft: (id: number) => void
  onPreview: (email: any) => void
}) {
  const StatusIcon = EMAIL_STATUS_ICONS[email.status] || Mail

  return (
    <Card className="hover:shadow-md transition-shadow group">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <Mail className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{email.subject || 'No Subject'}</p>
              <p className="text-xs text-muted-foreground truncate">
                To: {email.recipient_name || email.recipient_email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {email.ai_generated && (
              <Badge variant="outline" className="text-[10px] gap-0.5">
                <Zap className="w-2.5 h-2.5" /> AI
              </Badge>
            )}
            {email.status === 'sent' && (email.opens || 0) > 0 && (
              <Badge variant="outline" className="text-[10px] gap-0.5 text-blue-600 border-blue-300" title={`Open count (real tracking pixel)`}>
                <MousePointerClick className="w-2.5 h-2.5" /> {email.opens}
              </Badge>
            )}
            <Badge variant={EMAIL_STATUS_COLORS[email.status] || 'outline'} className="text-[10px] flex items-center gap-0.5">
              <StatusIcon className="w-2.5 h-2.5" />
              {email.status?.replace(/_/g, ' ')}
            </Badge>
          </div>
        </div>

        {email.body && (
          <p className="text-xs text-muted-foreground line-clamp-3 bg-muted/30 rounded p-2 mb-3">
            {truncate(email.body, 200)}
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{formatDate(email.created_at)}</span>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onPreview(email)}>
              <Eye className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => { navigator.clipboard.writeText(email.body || ''); toast.success('Copied!') }}
            >
              <Copy className="w-3 h-3" />
            </Button>

            {email.status === 'pending_review' && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-emerald-500 hover:text-emerald-600"
                  onClick={() => onApprove(email.id)}
                >
                  <CheckCircle2 className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive"
                  onClick={() => onReject(email.id)}
                >
                  <XCircle className="w-3 h-3" />
                </Button>
              </>
            )}

            {email.status === 'approved' && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1 px-2 text-violet-500"
                  onClick={() => onCreateDraft(email.id)}
                >
                  <GitBranch className="w-3 h-3" />
                  Draft
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1 px-2 text-emerald-500"
                  onClick={() => onSend(email.id)}
                >
                  <Send className="w-3 h-3" />
                  Send
                </Button>
              </>
            )}

            {email.status === 'draft' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1 px-2 text-emerald-500"
                onClick={() => onSend(email.id)}
              >
                <Send className="w-3 h-3" />
                Send
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Emails() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [previewEmail, setPreviewEmail] = useState<any>(null)
  const [generateLeadId, setGenerateLeadId] = useState('')
  const [generateContext, setGenerateContext] = useState('')
  const [generateTone, setGenerateTone] = useState('professional')
  const [generateTemplate] = useState('introduction')
  const [generateLanguage, setGenerateLanguage] = useState('English')
  const [senderName, setSenderName] = useState('')
  const [senderCompany, setSenderCompany] = useState('')
  const [senderRole, setSenderRole] = useState('')
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkContext, setBulkContext] = useState('')
  const [bulkEventId, setBulkEventId] = useState('')
  const [bulkLeadIds, setBulkLeadIds] = useState<Set<number>>(new Set())

  // Auto-load sender info from Settings profile
  useEffect(() => {
    try {
      const profile = JSON.parse(localStorage.getItem('tradehub_company_profile') || '{}')
      if (profile.sender_name) setSenderName(profile.sender_name)
      if (profile.company_name) setSenderCompany(profile.company_name)
      if (profile.sender_role) setSenderRole(profile.sender_role)
    } catch {
      // no saved profile yet
    }
  }, [])

  // Pre-fill lead from URL param
  useEffect(() => {
    const leadId = searchParams.get('lead_id')
    if (leadId) {
      setGenerateLeadId(leadId)
      setShowGenerateModal(true)
    }
  }, [searchParams])

  const { data: gmailStatus } = useQuery({
    queryKey: ['gmail-status'],
    queryFn: () => gmailApi.getAuthStatus(),
    staleTime: 60_000,
  })

  const { data: leadsData } = useQuery({
    queryKey: ['leads-for-email'],
    queryFn: () => leadsApi.getAll({ limit: 200 }),
    staleTime: 60_000,
  })

  const { data: eventsData } = useQuery({
    queryKey: ['events-for-bulk'],
    queryFn: () => eventsApi.getAll({ limit: 200 }),
    staleTime: 60_000,
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['emails', search, status],
    queryFn: () =>
      emailsApi.getAll({
        search: search || undefined,
        status: status === 'all' ? undefined : status,
        limit: 200,
      }),
    staleTime: 30_000,
  })

  const generateMutation = useMutation({
    mutationFn: (payload: any) => emailsApi.generate(payload),
    onSuccess: () => {
      toast.success('Email generated — now in Pending Review for your approval')
      setShowGenerateModal(false)
      queryClient.invalidateQueries({ queryKey: ['emails'] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
    },
    onError: (err: any) => toast.error(err?.message || err?.response?.data?.detail || 'Failed to generate email'),
  })

  const bulkGenerateMutation = useMutation({
    mutationFn: (payload: any) => emailsApi.bulkGenerate(payload),
    onSuccess: (res: any) => {
      toast.success(res?.data?.message || `Generated ${res?.data?.generated ?? 0} emails`)
      setShowBulkModal(false)
      setBulkLeadIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['emails'] })
    },
    onError: (err: any) => toast.error(err?.message || err?.response?.data?.detail || 'Bulk generation failed'),
  })

  const approveMutation = useMutation({
    mutationFn: (id: number) => emailsApi.approve(id),
    onSuccess: () => {
      toast.success('Email approved for sending!')
      queryClient.invalidateQueries({ queryKey: ['emails'] })
    },
    onError: (err: any) => toast.error(err?.message || err?.response?.data?.detail || 'Approve failed'),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: number) => emailsApi.reject(id),
    onSuccess: () => {
      toast.success('Email skipped')
      queryClient.invalidateQueries({ queryKey: ['emails'] })
    },
    onError: (err: any) => toast.error(err?.message || err?.response?.data?.detail || 'Reject failed'),
  })

  const createDraftMutation = useMutation({
    mutationFn: (id: number) => gmailApi.createDraft(id),
    onSuccess: () => {
      toast.success('Gmail draft created!')
      queryClient.invalidateQueries({ queryKey: ['emails'] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to create draft'),
  })

  const sendMutation = useMutation({
    mutationFn: (id: number) => gmailApi.sendEmail(id),
    onSuccess: () => {
      toast.success('Email sent via Gmail!')
      queryClient.invalidateQueries({ queryKey: ['emails'] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to send'),
  })

  const emails = data?.data?.emails || []
  const leads = leadsData?.data?.leads || []
  const events = eventsData?.data?.events || []
  const isGmailConnected = gmailStatus?.data?.authenticated

  const leadsInSelectedEvent = leads.filter(
    (l: any) => !l.emails_count && l.contact_email && (!bulkEventId || String(l.event_id) === bulkEventId)
  )

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Gmail auth warning */}
      {!isGmailConnected && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Gmail not connected</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect Gmail to send emails and create drafts. You can still generate and approve emails.
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 h-7 text-xs" onClick={() => navigate('/reports')}>
            Connect Gmail
          </Button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search emails..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-44 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending_review">Pending Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowBulkModal(true)} className="h-9 gap-2">
            <Zap className="w-3.5 h-3.5" />
            Bulk Generate
          </Button>
          <Button size="sm" onClick={() => setShowGenerateModal(true)} className="h-9 gap-2">
            <Plus className="w-3.5 h-3.5" />
            Generate Email
          </Button>
        </div>
      </div>

      {/* Count */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{emails.length} email{emails.length !== 1 ? 's' : ''}</span>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      </div>

      {/* Email grid */}
      {isLoading && emails.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : emails.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <Inbox className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No emails yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Generate AI-personalized emails from your qualified leads
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {emails.map((email: any) => (
            <EmailCard
              key={email.id}
              email={email}
              onApprove={(id) => approveMutation.mutate(id)}
              onReject={(id) => rejectMutation.mutate(id)}
              onSend={(id) => sendMutation.mutate(id)}
              onCreateDraft={(id) => createDraftMutation.mutate(id)}
              onPreview={(e) => setPreviewEmail(e)}
            />
          ))}
        </div>
      )}

      {/* Generate Email Modal */}
      <Dialog open={showGenerateModal} onOpenChange={setShowGenerateModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-500" />
              Generate AI Email
            </DialogTitle>
            <DialogDescription>
              Gemini AI will craft a personalized outreach email for the selected lead
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Lead *</label>
              <Select value={generateLeadId} onValueChange={setGenerateLeadId}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Select a lead..." />
                </SelectTrigger>
                <SelectContent>
                  {leads
                    .filter((l: any) => l.contact_email)
                    .map((l: any) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.company_name} — {l.contact_email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tone</label>
                <Select value={generateTone} onValueChange={setGenerateTone}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Language</label>
                <Select value={generateLanguage} onValueChange={setGenerateLanguage}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="English">🇺🇸 English</SelectItem>
                    <SelectItem value="Spanish">🇪🇸 Spanish</SelectItem>
                    <SelectItem value="French">🇫🇷 French</SelectItem>
                    <SelectItem value="Hindi">🇮🇳 Hindi</SelectItem>
                    <SelectItem value="German">🇩🇪 German</SelectItem>
                    <SelectItem value="Portuguese">🇧🇷 Portuguese</SelectItem>
                    <SelectItem value="Arabic">🇦🇪 Arabic</SelectItem>
                    <SelectItem value="Japanese">🇯🇵 Japanese</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Your Name</label>
                <Input placeholder="John Smith" value={senderName} onChange={e => setSenderName(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Company</label>
                <Input placeholder="Acme Corp" value={senderCompany} onChange={e => setSenderCompany(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Role</label>
                <Input placeholder="VP Sales" value={senderRole} onChange={e => setSenderRole(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Custom Notes (optional)</label>
              <Textarea
                placeholder="e.g., Mention their recent product launch, focus on cost savings, reference booth A-23..."
                value={generateContext}
                onChange={e => setGenerateContext(e.target.value)}
                rows={2}
                className="text-sm resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateModal(false)}>Cancel</Button>
            <Button
              disabled={!generateLeadId || generateMutation.isPending}
              onClick={() =>
                generateMutation.mutate({
                  lead_id: Number(generateLeadId),
                  custom_notes: generateContext
                    ? `[Template: ${generateTemplate}] [Language: ${generateLanguage}] ${generateContext}`
                    : `[Template: ${generateTemplate}] [Language: ${generateLanguage}]`,
                  sender_name: senderName || undefined,
                  sender_company: senderCompany || undefined,
                  sender_role: senderRole || undefined,
                  tone: generateTone,
                })
              }
              className="gap-2"
            >
              {generateMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Generate Modal */}
      <Dialog open={showBulkModal} onOpenChange={setShowBulkModal}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-500" />
              Bulk Email Generation
            </DialogTitle>
            <DialogDescription>
              Pick an event, select its qualified leads (✓ = no outreach email yet), and Gemini drafts
              each one. Every draft lands in Pending Review — you approve before anything is sent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Event</label>
              <Select value={bulkEventId} onValueChange={(v) => { setBulkEventId(v); setBulkLeadIds(new Set()) }}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="All events" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All events</SelectItem>
                  {events.map((e: any) => (
                    <SelectItem key={e.id} value={String(e.id)}>{truncate(e.name, 45)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  Qualified Leads without outreach ({leadsInSelectedEvent.length})
                </label>
                <button
                  className="text-xs text-violet-500 hover:underline"
                  onClick={() => setBulkLeadIds(new Set(leadsInSelectedEvent.map((l: any) => l.id)))}
                  disabled={leadsInSelectedEvent.length === 0}
                >
                  Select all
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
                {leadsInSelectedEvent.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3 text-center">
                    No qualified leads without outreach emails. Qualify or scrape leads first.
                  </p>
                ) : (
                  leadsInSelectedEvent.map((l: any) => (
                    <label key={l.id} className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-muted/40 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bulkLeadIds.has(l.id)}
                        onChange={() => {
                          setBulkLeadIds(prev => {
                            const next = new Set(prev)
                            if (next.has(l.id)) next.delete(l.id); else next.add(l.id)
                            return next
                          })
                        }}
                        className="accent-violet-500"
                      />
                      <span className="truncate flex-1">
                        {l.company_name} {l.contact_email && <span className="text-muted-foreground">— {l.contact_email}</span>}
                      </span>
                      <Badge variant="outline" className="text-[9px] shrink-0 capitalize">{l.priority}</Badge>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Your Name</label>
                <Input placeholder="John Smith" value={senderName} onChange={e => setSenderName(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Company</label>
                <Input placeholder="Acme Corp" value={senderCompany} onChange={e => setSenderCompany(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Role</label>
                <Input placeholder="VP Sales" value={senderRole} onChange={e => setSenderRole(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Context / Value Proposition</label>
              <Textarea
                placeholder="What should each email focus on? e.g., our SaaS integration platform that reduces manual data entry by 80% for manufacturers..."
                value={bulkContext}
                onChange={(e) => setBulkContext(e.target.value)}
                rows={2}
                className="text-sm resize-none"
              />
            </div>
            {bulkGenerateMutation.isPending && (
              <p className="text-xs text-violet-600 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating drafts one by one — this can take a while for large selections.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkModal(false)}>Cancel</Button>
            <Button
              disabled={bulkGenerateMutation.isPending || bulkLeadIds.size === 0}
              onClick={() =>
                bulkGenerateMutation.mutate({
                  lead_ids: Array.from(bulkLeadIds),
                  sender_name: senderName || 'Your Name',
                  sender_company: senderCompany || 'Your Company',
                  sender_role: senderRole || 'Business Development',
                  custom_notes: bulkContext || undefined,
                  tone: generateTone,
                })
              }
              className="gap-2"
            >
              {bulkGenerateMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              Generate {bulkLeadIds.size || ''} Draft{bulkLeadIds.size === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Preview Modal */}
      {previewEmail && (
        <Dialog open={!!previewEmail} onOpenChange={() => setPreviewEmail(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Email Preview
              </DialogTitle>
              <DialogDescription>
                To: {previewEmail.recipient_name || previewEmail.recipient_email}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto space-y-3 py-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</p>
                <p className="text-sm font-semibold">{previewEmail.subject}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Body</p>
                <div className="bg-muted/30 rounded-lg p-4 text-sm whitespace-pre-wrap">
                  {previewEmail.body}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { navigator.clipboard.writeText(previewEmail.body || ''); toast.success('Copied!') }}
                className="gap-2"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Body
              </Button>
              <Button onClick={() => setPreviewEmail(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

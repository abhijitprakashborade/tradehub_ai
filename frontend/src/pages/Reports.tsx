import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Zap,
  RefreshCw,
  Link,
  LogOut,
  User,
  Shield,
  MessageSquareReply,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { reportsApi, gmailApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

function GmailAuthCard() {
  const queryClient = useQueryClient()

  const { data: authStatus, isLoading } = useQuery({
    queryKey: ['gmail-status'],
    queryFn: () => gmailApi.getAuthStatus(),
    staleTime: 30_000,
  })

  const connectMutation = useMutation({
    mutationFn: () => gmailApi.connect(),
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail || 'Could not start the Gmail connection flow'),
  })

  // Poll the connect flow while the browser auth window is open
  const { data: connectStatus } = useQuery({
    queryKey: ['gmail-connect-status'],
    queryFn: () => gmailApi.getConnectStatus(),
    enabled: connectMutation.isSuccess || connectMutation.isPending,
    refetchInterval: (query) => {
      const st = query.state.data?.data?.status
      return st === 'connected' || st === 'error' ? false : 2000
    },
  })

  useEffect(() => {
    const st = connectStatus?.data?.status
    if (st === 'connected') {
      toast.success('Gmail connected successfully!')
      connectMutation.reset()
      queryClient.invalidateQueries({ queryKey: ['gmail-status'] })
      queryClient.invalidateQueries({ queryKey: ['emails'] })
    } else if (st === 'error') {
      toast.error(connectStatus?.data?.error || 'Gmail connection failed')
      connectMutation.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectStatus?.data?.status])

  const revokeMutation = useMutation({
    mutationFn: () => gmailApi.revokeAuth(),
    onSuccess: () => {
      toast.success('Gmail disconnected')
      queryClient.invalidateQueries({ queryKey: ['gmail-status'] })
    },
  })

  const connectState = connectStatus?.data
  const status = authStatus?.data
  const isAuthenticated = status?.authenticated
  const flowOpen = connectState?.status === 'awaiting_user' || connectState?.status === 'started'

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Gmail Integration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking status...
          </div>
        ) : isAuthenticated ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm font-medium">Connected</span>
            </div>
            {status?.user_email && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="w-3.5 h-3.5" />
                {status.user_email}
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
              <Shield className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              OAuth2 authenticated locally. Emails are sent on your behalf through your own Gmail account.
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-destructive border-destructive/50 hover:bg-destructive/10"
              onClick={() => revokeMutation.mutate()}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
              Disconnect Gmail
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <XCircle className="w-4 h-4" />
              <span className="text-sm">Not connected</span>
            </div>
            {status?.content_file_missing && (
              <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  <strong>First step needed:</strong> {status?.detail || 'Missing Gmail OAuth credentials file.'}
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              One-click connect: the backend opens Google sign-in in your browser and completes the
              OAuth loopback automatically — no copy/pasting codes.
            </p>

            {flowOpen ? (
              <div className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-lg p-3">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                Waiting for you to approve in the browser window...
              </div>
            ) : (
              <Button size="sm" onClick={() => connectMutation.mutate()} className="gap-2" disabled={connectMutation.isPending}>
                {connectMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Link className="w-3.5 h-3.5" />
                )}
                Connect Gmail
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AiSuggestionsCard() {
  const [icp, setIcp] = useState('')
  const [showInput, setShowInput] = useState(false)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['ai-suggestions', icp],
    queryFn: () => reportsApi.getAiSuggestions(icp || undefined),
    enabled: false,
    staleTime: 300_000,
  })

  const suggestions = data?.data?.suggestions || []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="w-4 h-4 text-violet-500" />
          AI Strategy Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Get Gemini AI recommendations for improving your lead generation strategy.
        </p>

        {!showInput ? (
          <Button size="sm" onClick={() => setShowInput(true)} className="gap-2">
            <Zap className="w-3.5 h-3.5" />
            Get Suggestions
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Your ICP (optional)</label>
              <Input
                value={icp}
                onChange={(e) => setIcp(e.target.value)}
                placeholder="e.g., B2B SaaS for enterprise logistics..."
                className="text-sm h-9"
              />
            </div>
            <Button size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
              {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Generate
            </Button>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="space-y-3 mt-2">
            {suggestions.map((s: any, i: number) => (
              <div key={i} className="rounded-lg border bg-muted/20 p-3 space-y-1">
                <p className="text-sm font-semibold">{s.title || s.recommendation || `Tip ${i + 1}`}</p>
                <p className="text-xs text-muted-foreground">{s.description || s.rationale || s}</p>
                {s.action && (
                  <Badge variant="outline" className="text-[10px] mt-1">{s.action}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RepliesCard() {
  const queryClient = useQueryClient()

  const { data: replies, isFetching, refetch } = useQuery({
    queryKey: ['gmail-replies'],
    queryFn: () => gmailApi.getReplies(),
    refetchInterval: 60_000,
  })

  const checkMutation = useMutation({
    mutationFn: () => gmailApi.checkReplies(),
    onSuccess: (res: any) => {
      const d = res.data
      if (d.connected) {
        toast.success(`${d.new_replies} new reply${d.new_replies === 1 ? '' : 's'} found (${d.inbox_checked ?? 0} inbox messages scanned)`)
      } else {
        toast.error(d.error || 'Gmail not connected')
      }
      queryClient.invalidateQueries({ queryKey: ['gmail-replies'] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
    },
    onError: () => toast.error('Reply check failed'),
  })

  const items = replies?.data || []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <MessageSquareReply className="w-4 h-4 text-violet-500" />
            Detected Replies
          </span>
          <Button
            variant="outline" size="sm" className="h-7 text-xs gap-1.5"
            onClick={() => checkMutation.mutate()} disabled={checkMutation.isPending}
          >
            {checkMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Check Now
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Matches real inbox replies to your sent outreach by Gmail thread. Leads are auto-marked RESPONDED.
        </p>
        {isFetching && items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading replies...
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <MessageSquareReply className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">
              No replies detected yet. Send outreach via Gmail, then run "Check Now" (or automate it daily).
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 10).map((r: any) => (
              <div key={r.id} className="flex items-start gap-2.5 rounded-lg border bg-muted/20 p-2.5">
                <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <MessageSquareReply className="w-3.5 h-3.5 text-emerald-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{r.sender || 'Unknown sender'}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.subject}</p>
                  {r.snippet && <p className="text-[10px] text-muted-foreground/80 truncate mt-0.5">{r.snippet}</p>}
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(r.received_at)}</span>
              </div>
            ))}
          </div>
        )}
        <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => refetch()}>
          Refresh list
        </Button>
      </CardContent>
    </Card>
  )
}

export default function Reports() {
  const { data: fullReport, isLoading, refetch } = useQuery({
    queryKey: ['full-report'],
    queryFn: () => reportsApi.getFullReport(),
    staleTime: 60_000,
  })

  const exportMutation = useMutation({
    mutationFn: () => reportsApi.exportLeads(),
    onSuccess: (response: any) => {
      const blob = new Blob([response.data], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `leads_export_${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Leads exported!')
    },
    onError: () => toast.error('Export failed'),
  })

  const r = fullReport?.data

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Pipeline analytics and integrations</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 h-9">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending} className="gap-2 h-9">
            <Download className="w-3.5 h-3.5" />
            Export Leads CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - stats */}
          <div className="lg:col-span-2 space-y-4">
            {/* Pipeline stats */}
            {r?.email_pipeline && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Email Pipeline Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {(r.email_pipeline || []).map((item: any) => (
                      <div key={item.status} className="text-center p-3 rounded-lg bg-muted/30">
                        <p className="text-2xl font-bold">{item.count}</p>
                        <p className="text-xs text-muted-foreground capitalize mt-1">
                          {String(item.status).replace(/_/g, ' ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Lead status breakdown */}
            {r?.leads_by_status && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Lead Status Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[...(r.leads_by_status || [])]
                      .sort((a, b) => b.count - a.count)
                      .map((item: any) => {
                        const total = (r.leads_by_status || []).reduce((sum: number, v: any) => sum + v.count, 0)
                        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
                        return (
                          <div key={item.status} className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground w-24 shrink-0 capitalize">
                              {String(item.status).toLowerCase()}
                            </span>
                            <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                              <div
                                className="h-2 bg-violet-500 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium w-12 text-right">{item.count}</span>
                          </div>
                        )
                      })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Events by industry */}
            {r?.events_by_industry && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Events by Industry</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[...(r.events_by_industry || [])]
                      .sort((a, b) => b.count - a.count)
                      .map((item: any) => (
                        <div key={item.industry} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 text-sm">
                          <span className="text-xs truncate text-muted-foreground">{item.industry}</span>
                          <Badge variant="outline" className="text-xs ml-2">{item.count}</Badge>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column - integrations */}
          <div className="space-y-4">
            <GmailAuthCard />
            <RepliesCard />
            <AiSuggestionsCard />
          </div>
        </div>
      )}
    </div>
  )
}

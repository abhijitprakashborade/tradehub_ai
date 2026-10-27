import React, { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Loader2, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { jobsApi } from '@/lib/api'

export interface TrackedJob {
  jobId: number
  kind: 'events' | 'leads'
  label: string
  status: string
}

interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  message: string
}

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-muted-foreground',
  warn: 'text-amber-500',
  error: 'text-red-500',
}

/**
 * Live scrape/automation monitor.
 * - Streams real job steps via SSE (GET /jobs/{id}/stream).
 * - Survives tab navigation: job state is hydrated from the backend on mount
 *   (server is the source of truth), then SSE reconnects.
 */
export function LiveJobMonitor({
  jobs,
  onDismiss,
}: {
  jobs: TrackedJob[]
  onDismiss: (jobId: number) => void
}) {
  const queryClient = useQueryClient()

  if (jobs.length === 0) return null

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <JobPanel key={job.jobId} job={job} onDismiss={onDismiss} queryClient={queryClient} />
      ))}
    </div>
  )
}

function JobPanel({
  job,
  onDismiss,
  queryClient,
}: {
  job: TrackedJob
  onDismiss: (jobId: number) => void
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<string>(job.status || 'pending')
  const [records, setRecords] = useState<{ found: number; saved: number }>({ found: 0, saved: 0 })
  const logRef = useRef<HTMLDivElement | null>(null)
  const esRef = useRef<EventSource | null>(null)

  // Hydrate full state from the server on mount (survives navigation)
  const { data: statusData } = useQuery({
    queryKey: ['job-status', job.kind, job.jobId],
    queryFn: () => jobsApi.getStatus(job.kind, job.jobId),
    refetchInterval: status === 'running' || status === 'pending' ? 3000 : false,
    staleTime: 5000,
  })

  useEffect(() => {
    const data = statusData?.data
    if (!data) return
    setStatus(data.status)
    setRecords({ found: data.records_found || 0, saved: data.records_saved || 0 })
    if (data.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: [job.kind === 'events' ? 'events' : 'leads'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['full-report'] })
    }
    // deps intentionally narrow: this effect only reacts to fresh status payloads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusData?.data])

  // Connect SSE once
  useEffect(() => {
    const source = new EventSource(jobsApi.streamUrl(job.jobId))
    esRef.current = source
    source.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data) as LogEntry
        setEntries((prev) => (prev.some(e => e.ts === entry.ts && e.message === entry.message) ? prev : [...prev, entry]))
      } catch { /* ignore malformed line */ }
    }
    source.addEventListener('end', (ev: MessageEvent) => {
      let endStatus: string | null = null
      try {
        const data = JSON.parse(ev.data) as { status: string | null }
        endStatus = data.status
      } catch { /* fall through to status endpoint */ }
      source.close()
      // Always reconcile counters/status from the DB once the job ends —
      // the count the SSE text shows is not the DB counter of record.
      jobsApi.getStatus(job.kind, job.jobId)
        .then(r => {
          const data = r.data
          setStatus(data.status || endStatus || 'completed')
          setRecords({ found: data.records_found || 0, saved: data.records_saved || 0 })
        })
        .catch(() => {
          if (endStatus) setStatus(endStatus)
        })
    })
    source.onerror = () => {
      // SSE closed prematurely — the status poller above keeps state fresh
    }
    return () => {
      source.close()
      esRef.current = null
    }
  }, [job.jobId, job.kind])

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [entries.length])

  const isRunning = status === 'running' || status === 'pending'
  const isDone = status === 'completed'
  const isFailed = status === 'failed'

  return (
    <div
      className={`relative rounded-xl border transition-all duration-300 ${
        isDone ? 'border-emerald-500/30 bg-emerald-500/5' : isFailed ? 'border-red-500/30 bg-red-500/5' : 'border-violet-500/30 bg-violet-500/5'
      }`}
    >
      <div className="flex items-start justify-between gap-3 p-4 pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {isRunning && (
            <span className="relative flex h-3 w-3 mt-0.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-violet-500"></span>
            </span>
          )}
          {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
          {isFailed && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold truncate">
                {isRunning ? 'Running — live from the web...' : isDone ? 'Completed' : isFailed ? 'Failed' : 'Starting...'}
              </p>
              <Badge
                variant="outline"
                className={`text-[10px] capitalize ${
                  isRunning ? 'text-violet-600 border-violet-400' : isDone ? 'text-emerald-600 border-emerald-400' : 'text-red-600 border-red-400'
                }`}
              >
                {status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{job.label}</p>
          </div>
        </div>

        {(isDone || isFailed) && (
          <button
            onClick={() => onDismiss(job.jobId)}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs shrink-0"
          >
            ✕
          </button>
        )}
      </div>

      {/* Real counters */}
      <div className="grid grid-cols-2 gap-3 px-4">
        <div className="bg-background/60 rounded-lg p-2.5 text-center">
          <p className="text-2xl font-bold tabular-nums text-foreground">{records.found}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Found</p>
        </div>
        <div className="bg-background/60 rounded-lg p-2.5 text-center">
          <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{records.saved}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Saved</p>
        </div>
      </div>

      {/* Terminal-style live log (real job steps via SSE) */}
      <div className="px-4 pb-2 pt-3">
        <div
          ref={logRef}
          className="max-h-48 overflow-y-auto rounded-lg bg-muted/40 border border-border/50 px-3 py-2 font-mono text-[11px] leading-relaxed space-y-0.5"
        >
          <div className="flex items-center gap-1.5 text-muted-foreground/70 mb-1">
            <Terminal className="w-3 h-3" />
            <span>live job feed</span>
            {isRunning && <Loader2 className="w-3 h-3 animate-spin ml-auto" />}
          </div>
          {entries.map((e, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-muted-foreground/50 shrink-0">{e.ts?.split('T')[1]?.slice(0, 8) || ''}</span>
              <span className={LEVEL_COLORS[e.level] || LEVEL_COLORS.info}>{e.message}</span>
            </div>
          ))}
          {entries.length === 0 && (
            <div className="text-muted-foreground/60">waiting for first steps...</div>
          )}
        </div>
      </div>

      {isDone && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 px-4 pb-3">
          ✓ Saved {records.saved} of {records.found} records. Lists refreshed automatically.
        </p>
      )}
      {isFailed && (
        <p className="text-xs text-red-500 px-4 pb-3">Job failed — see the log above for what happened.</p>
      )}
    </div>
  )
}

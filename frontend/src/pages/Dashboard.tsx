import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Calendar,
  Users,
  Mail,
  Loader2,
  AlertCircle,
  Zap,
  Target,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { reportsApi } from '@/lib/api'
import { formatNumber, formatDate } from '@/lib/utils'
import {
  LeadsByStatusChart,
  EmailPipelineChart,
  EventsByIndustryChart,
  LeadScoreDistChart,
} from '@/components/charts/StatsChart'

function StatCard({
  title,
  value,
  icon: Icon,
  color = 'violet',
}: {
  title: string
  value: string | number
  icon: React.ElementType
  color?: string
}) {
  const colorMap: Record<string, string> = {
    violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  }

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold text-foreground mt-1">{formatNumber(Number(value))}</p>
          </div>
          <div className={`p-2.5 rounded-xl ${colorMap[color] || colorMap.violet}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => reportsApi.getDashboardStats(),
    refetchInterval: 30_000,
  })

  const { data: fullReport } = useQuery({
    queryKey: ['full-report'],
    queryFn: () => reportsApi.getFullReport(),
    refetchInterval: 60_000,
  })

  // REAL score distribution from the backend
  const { data: bucketsData } = useQuery({
    queryKey: ['score-buckets'],
    queryFn: () => reportsApi.getScoreBuckets(),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-violet-500 mx-auto" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-muted-foreground">Failed to load dashboard data</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const s = stats?.data
  const r = fullReport?.data

  // Build chart data from array format [{status/industry, count}]
  const leadsByStatus: {name: string; value: number}[] = r?.leads_by_status
    ? r.leads_by_status.map((item: {status: string; count: number}) => ({ name: item.status, value: item.count }))
    : []

  const emailPipelineRaw = r?.email_pipeline || []
  const emailPipeline = emailPipelineRaw.length > 0
    ? [{
        name: 'Pipeline',
        pending: emailPipelineRaw.find((x: any) => x.status === 'pending_review')?.count || 0,
        approved: emailPipelineRaw.find((x: any) => x.status === 'approved')?.count || 0,
        sent: emailPipelineRaw.find((x: any) => x.status === 'sent')?.count || 0,
        failed: emailPipelineRaw.find((x: any) => x.status === 'failed')?.count || 0,
      }]
    : []

  const eventsByIndustry: {industry: string; count: number}[] = r?.events_by_industry
    ? r.events_by_industry
        .map((item: {industry: string; count: number}) => ({ industry: item.industry, count: item.count }))
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, 6)
    : []

  // Score distribution: REAL data from /reports/score-buckets
  const scoreDistribution = bucketsData?.data?.length
    ? bucketsData.data.map((b: any) => ({ range: b.range, count: b.count }))
    : []

  const conversionRate =
    s && s.total_leads > 0
      ? Math.round((s.contacted_leads / s.total_leads) * 100)
      : 0

  const emailSuccessRate =
    s && s.total_emails > 0
      ? Math.round((s.emails_sent / s.total_emails) * 100)
      : 0

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Welcome banner */}
      <div className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 p-6 text-white relative overflow-hidden">
        <div className="absolute right-0 top-0 w-48 h-48 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute right-12 bottom-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-5 h-5" />
            <span className="text-sm font-medium opacity-90">TradeHub AI — Active</span>
          </div>
          <h2 className="text-2xl font-bold mb-1">Your Pipeline at a Glance</h2>
          <p className="text-sm opacity-75">
            {s?.total_events || 0} events tracked ·{' '}
            {s?.qualified_leads || 0} qualified leads ·{' '}
            {s?.emails_sent || 0} emails sent
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Trade Shows" value={s?.total_events || 0} icon={Calendar} color="violet" />
        <StatCard title="Total Leads" value={s?.total_leads || 0} icon={Users} color="blue" />
        <StatCard title="Qualified Leads" value={s?.qualified_leads || 0} icon={Target} color="emerald" />
        <StatCard title="Emails Sent" value={s?.emails_sent || 0} icon={Mail} color="amber" />
      </div>

      {/* KPI progress row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-medium">Lead Conversion</span>
              </div>
              <span className="text-sm font-bold text-foreground">{conversionRate}%</span>
            </div>
            <Progress value={conversionRate} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {s?.contacted_leads || 0} of {s?.total_leads || 0} leads contacted
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-violet-500" />
                <span className="text-sm font-medium">Email Delivery</span>
              </div>
              <span className="text-sm font-bold text-foreground">{emailSuccessRate}%</span>
            </div>
            <Progress value={emailSuccessRate} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {s?.emails_sent || 0} of {s?.total_emails || 0} emails delivered
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium">AI Generated</span>
              </div>
              <span className="text-sm font-bold text-foreground">{s?.ai_generated_emails || 0}</span>
            </div>
            <Progress
              value={
                s && s.total_emails > 0
                  ? (s.ai_generated_emails / s.total_emails) * 100
                  : 0
              }
              className="h-2"
            />
            <p className="text-xs text-muted-foreground mt-2">
              AI-personalized outreach emails
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {leadsByStatus.length > 0 && <LeadsByStatusChart data={leadsByStatus} />}
        {emailPipeline.length > 0 && <EmailPipelineChart data={emailPipeline} />}
        {eventsByIndustry.length > 0 && <EventsByIndustryChart data={eventsByIndustry} />}
        <LeadScoreDistChart data={scoreDistribution} />
      </div>

      {/* Recent activity */}
      {r?.recent_activity && r.recent_activity.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {r.recent_activity.slice(0, 8).map((item: any, i: number) => {
                const isEmail = item.type === 'email_sent'
                const label = item.company || 'Unknown'
                const Icon = isEmail ? Mail : Users
                return (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-violet-500/10 flex items-center justify-center">
                        <Icon className="w-3.5 h-3.5 text-violet-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {isEmail ? 'Email sent' : `Lead added · ${item.status}` }
                          {item.score != null && !isEmail && ` · score ${Math.round(item.score)}`}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

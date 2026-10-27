import React, { useState } from 'react'
import {
  Building2, Mail, Save, CheckCircle2, AlertCircle,
  ExternalLink, TestTube,
  Zap, Loader2, KeyRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { gmailApi, aiApi } from '@/lib/api'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'

const PROFILE_KEY = 'tradehub_company_profile'

interface CompanyProfile {
  company_name: string
  products: string
  location: string
  target_market: string
  sender_name: string
  sender_role: string
  icp_description: string
  website: string
}

function loadProfile(): CompanyProfile {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}')
  } catch {
    return {} as CompanyProfile
  }
}

// ─── Section wrapper ─────────────────────────────────────────────────────────
function Section({ title, description, icon: Icon, children, badge }: {
  title: string
  description: string
  icon: React.ElementType
  children: React.ReactNode
  badge?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Icon className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="text-xs mt-0.5">{description}</CardDescription>
            </div>
          </div>
          {badge && (
            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-400">
              {badge}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

// ─── Field wrapper ────────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ─── Gmail steps ──────────────────────────────────────────────────────────────
function GmailSetupSteps() {
  return (
    <div className="space-y-3 mt-1">
      {[
        { n: 1, title: 'Create Google Cloud Project', detail: 'Go to console.cloud.google.com → New Project', free: true },
        { n: 2, title: 'Enable Gmail API', detail: 'APIs & Services → Enable APIs → Gmail API', free: true },
        { n: 3, title: 'Create OAuth Credentials', detail: 'APIs & Services → Credentials → OAuth 2.0 Client ID (Desktop app)', free: true },
        { n: 4, title: 'Download credentials.json', detail: 'Save it as: backend/credentials/gmail_credentials.json', free: false },
      ].map(step => (
        <div key={step.n} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/10">
          <div className="w-6 h-6 rounded-full bg-violet-500/10 flex items-center justify-center text-violet-600 text-xs font-bold shrink-0 mt-0.5">
            {step.n}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{step.title}</p>
              {step.free && <Badge variant="outline" className="text-[9px] text-emerald-600 border-emerald-400">Free</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────
export default function Settings() {
  const [profile, setProfile] = useState<CompanyProfile>(loadProfile)
  const [profileSaved, setProfileSaved] = useState(false)

  const { data: aiStatus, isFetching: testingGemini, refetch: refetchAi } = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => aiApi.getStatus(),
    enabled: false,
    staleTime: 0,
  })

  const { data: gmailStatus, refetch: refetchGmail } = useQuery({
    queryKey: ['gmail-status'],
    queryFn: () => gmailApi.getAuthStatus(),
    staleTime: 30_000,
  })

  const connectMutation = useMutation({
    mutationFn: () => gmailApi.connect(),
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Could not start Gmail connection'),
  })

  const { data: connectStatus } = useQuery({
    queryKey: ['gmail-connect-status'],
    queryFn: () => gmailApi.getConnectStatus(),
    enabled: connectMutation.isPending || connectMutation.isSuccess,
    refetchInterval: (query) => {
      const st = query.state.data?.data?.status
      return st === 'connected' || st === 'error' ? false : 2000
    },
  })

  const saveProfile = () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
    setProfileSaved(true)
    toast.success('Company profile saved!')
    setTimeout(() => setProfileSaved(false), 3000)
  }

  const revokeGmail = async () => {
    try {
      await gmailApi.revokeAuth()
      toast.success('Gmail disconnected')
      refetchGmail()
    } catch {
      toast.error('Failed to revoke Gmail')
    }
  }

  const isGmailConnected = gmailStatus?.data?.authenticated
  const ai = aiStatus?.data
  const gmailFlowOpen = ['started', 'awaiting_user'].includes(connectStatus?.data?.status)

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings & Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure your company profile, AI status, and Gmail integration</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Company Profile ─────────────────────────────────────────────── */}
        <Section icon={Building2} title="Your Company Profile" description="Used to personalize AI-generated emails and lead qualification">
          <div className="space-y-4">
            <Field label="Company Name">
              <Input
                placeholder="e.g. Acme Corp — Global Exports"
                value={profile.company_name || ''}
                onChange={e => setProfile(p => ({ ...p, company_name: e.target.value }))}
              />
            </Field>
            <Field label="Products / Services You Sell">
              <Input
                placeholder="e.g. Industrial machinery, software, leather goods"
                value={profile.products || ''}
                onChange={e => setProfile(p => ({ ...p, products: e.target.value }))}
              />
            </Field>
            <Field label="Your Location">
              <Input
                placeholder="e.g. Mumbai, India — 400001"
                value={profile.location || ''}
                onChange={e => setProfile(p => ({ ...p, location: e.target.value }))}
              />
            </Field>
            <Field label="Target Market / Ideal Buyers" hint="AI uses this to score and qualify leads">
              <Input
                placeholder="e.g. USA — Wholesale buyers, retail chains"
                value={profile.target_market || ''}
                onChange={e => setProfile(p => ({ ...p, target_market: e.target.value }))}
              />
            </Field>
            <Field label="Sender Name & Designation">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Your Name"
                  value={profile.sender_name || ''}
                  onChange={e => setProfile(p => ({ ...p, sender_name: e.target.value }))}
                />
                <Input
                  placeholder="VP of Sales"
                  value={profile.sender_role || ''}
                  onChange={e => setProfile(p => ({ ...p, sender_role: e.target.value }))}
                />
              </div>
            </Field>
            <Field label="ICP Description" hint="Ideal Customer Profile — used for AI lead scoring">
              <Textarea
                placeholder="B2B manufacturers and distributors with 50-500 employees seeking US buyers..."
                value={profile.icp_description || ''}
                onChange={e => setProfile(p => ({ ...p, icp_description: e.target.value }))}
                rows={3}
                className="text-sm resize-none"
              />
            </Field>
            <Button onClick={saveProfile} className="w-full gap-2" size="sm">
              {profileSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {profileSaved ? 'Profile Saved!' : 'Save Profile'}
            </Button>
          </div>
        </Section>

        {/* ── Right column ─────────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* AI Status (real probe) */}
          <Section icon={Zap} title="Gemini AI Status" description="Backend AI health — actually sends a test prompt to Gemini">
            <div className="space-y-3">
              {ai ? (
                <div
                  className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${
                    ai.ok
                      ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-red-500/5 border-red-500/30 text-red-700 dark:text-red-300'
                  }`}
                >
                  {ai.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <div>
                    <p className="font-semibold">
                      {ai.ok ? `Working — model ${ai.model} (${ai.latency_ms}ms)` : 'Gemini test failed'}
                    </p>
                    {!ai.ok && <p className="mt-1 break-words">{ai.error || ai.model}</p>}
                    {!ai.configured && <p className="mt-1">Set GEMINI_API_KEY in backend/.env and restart the backend.</p>}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Not tested yet — run the test.</p>
              )}
              <Button
                onClick={() => refetchAi()}
                disabled={testingGemini}
                className="w-full gap-2"
                size="sm"
              >
                {testingGemini ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
                {testingGemini ? 'Pinging Gemini for real...' : 'Test Gemini Connection'}
              </Button>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground">
                <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  The Gemini key lives server-side in <code>backend/.env</code> (GEMINI_API_KEY) — never in the browser.
                  Get a free key at{' '}
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-violet-600 hover:underline inline-flex items-center gap-0.5">
                    AI Studio <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </span>
              </div>
            </div>
          </Section>

          {/* Gmail Integration */}
          <Section
            icon={Mail}
            title="Gmail Integration (Free)"
            description="Send emails directly from your Gmail account"
            badge="One-time setup"
          >
            {isGmailConnected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Gmail Connected ✓</p>
                    <p className="text-xs text-muted-foreground">{gmailStatus?.data?.user_email}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={revokeGmail} className="w-full gap-2 text-destructive hover:text-destructive">
                  Disconnect Gmail
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>Gmail requires Google Cloud OAuth (free, one-time setup)</p>
                </div>

                <GmailSetupSteps />

                {gmailFlowOpen ? (
                  <div className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-lg p-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    Waiting for you to approve in the browser window...
                  </div>
                ) : (
                  <Button onClick={() => connectMutation.mutate()} className="w-full gap-2" size="sm" disabled={connectMutation.isPending}>
                    {connectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    Connect Gmail Account
                  </Button>
                )}
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* ── Quick Start Guide ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-violet-500" />
            <CardTitle className="text-sm">Quick Start Guide</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { step: '1', title: 'Discover Events', desc: 'Go to Trade Shows → Discover Events for grounded live web discovery by industry', href: '/events' },
              { step: '2', title: 'Find Exhibitors', desc: 'Click ⚡ on any event to collect real exhibitors with verified source links', href: '/events' },
              { step: '3', title: 'AI Qualify Leads', desc: 'Go to Leads → select leads → Bulk AI Qualify against your ICP', href: '/leads' },
              { step: '4', title: 'Generate Emails', desc: 'Go to Outreach → Generate Email → approve → Gmail draft/send', href: '/emails' },
            ].map(item => (
              <a
                key={item.step}
                href={item.href}
                className="block p-3 rounded-xl border border-border hover:border-violet-400 hover:bg-violet-500/5 transition-all group"
              >
                <div className="w-6 h-6 rounded-full bg-violet-500/10 text-violet-600 text-xs font-bold flex items-center justify-center mb-2 group-hover:bg-violet-500 group-hover:text-white transition-colors">
                  {item.step}
                </div>
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.desc}</p>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

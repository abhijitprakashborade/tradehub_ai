import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Moon, Sun, Bell, Search, Building2, Calendar, Loader2, X, MessageSquareReply,
  Settings, User, BriefcaseBusiness, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useThemeStore } from '@/store/themeStore'
import { eventsApi, leadsApi, gmailApi } from '@/lib/api'
import { truncate } from '@/lib/utils'

const pageTitles: Record<string, { title: string; description: string }> = {
  '/': { title: 'Dashboard', description: 'Overview of your trade show pipeline' },
  '/events': { title: 'Trade Shows', description: 'Discover and manage industry events' },
  '/leads': { title: 'Leads', description: 'Qualified prospects from trade shows' },
  '/emails': { title: 'Outreach', description: 'AI-generated email campaigns' },
  '/automation': { title: 'Automation', description: 'Daily scheduled pipeline tasks' },
  '/reports': { title: 'Reports', description: 'Analytics and performance insights' },
  '/settings': { title: 'Settings', description: 'Profile, AI status and integrations' },
}

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem('tradehub_company_profile') || '{}')
  } catch {
    return {}
  }
}

export function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggle } = useThemeStore()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [showBell, setShowBell] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [profile, setProfile] = useState(loadProfile)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const bellRef = useRef<HTMLDivElement | null>(null)
  const profileRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  // Re-read profile when the settings page is left (it may have been edited)
  useEffect(() => {
    setProfile(loadProfile())
  }, [location.pathname])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowResults(false)
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setShowBell(false)
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Real quick search across events + leads
  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ['header-search', debounced],
    queryFn: () =>
      Promise.all([
        eventsApi.getAll({ search: debounced, limit: 4 }),
        leadsApi.getAll({ search: debounced, limit: 4 }),
      ]),
    enabled: debounced.length >= 2,
    staleTime: 10_000,
  })

  const { data: bellData } = useQuery({
    queryKey: ['header-bell'],
    queryFn: () => gmailApi.getReplies(),
    refetchInterval: 120_000,
  })

  const events = debounced.length >= 2 ? searchData?.[0]?.data?.events || [] : []
  const leads = debounced.length >= 2 ? searchData?.[1]?.data?.leads || [] : []
  const replies = bellData?.data || []
  const replyCount = replies.length
  const initials =
    ((profile.sender_name || profile.company_name || 'TH') as string)
      .split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase() || 'TH'

  const pageInfo = pageTitles[location.pathname] ?? {
    title: 'TradeHub AI',
    description: 'Trade show intelligence platform',
  }

  return (
    <header className="h-16 border-b border-border bg-background/80 backdrop-blur-sm flex items-center justify-between px-6 sticky top-0 z-10">
      {/* Page title */}
      <div>
        <h1 className="text-lg font-semibold text-foreground">{pageInfo.title}</h1>
        <p className="text-xs text-muted-foreground hidden sm:block">{pageInfo.description}</p>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-2">
        {/* Quick search — real, searches events + leads */}
        <div className="relative hidden md:block" ref={searchRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search events & leads..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setShowResults(true)
            }}
            onFocus={() => setShowResults(true)}
            className="pl-9 h-8 w-56 text-xs bg-muted/50 border-transparent focus-visible:bg-background focus-visible:border-input"
          />
          {query && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => { setQuery(''); setDebounced(''); setShowResults(false) }}
            >
              <X className="w-3 h-3" />
            </button>
          )}

          {showResults && debounced.length >= 2 && (
            <div className="absolute right-0 mt-1 w-80 rounded-lg border border-border bg-popover shadow-lg z-50 max-h-80 overflow-y-auto">
              {searching ? (
                <div className="flex items-center gap-2 justify-center p-4 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching...
                </div>
              ) : events.length === 0 && leads.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center p-4">No matches for "{truncate(debounced, 24)}"</p>
              ) : (
                <div className="py-1">
                  {events.length > 0 && (
                    <>
                      <p className="px-3 py-1 text-[10px] font-semibold uppercase text-muted-foreground/60">Events</p>
                      {events.map((e: any) => (
                        <button
                          key={`e${e.id}`}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/40 text-left"
                          onClick={() => { setShowResults(false); navigate('/events') }}
                        >
                          <Calendar className="w-3 h-3 text-violet-500 shrink-0" />
                          <span className="truncate">{e.name}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {leads.length > 0 && (
                    <>
                      <p className="px-3 py-1 text-[10px] font-semibold uppercase text-muted-foreground/60">Leads</p>
                      {leads.map((l: any) => (
                        <button
                          key={`l${l.id}`}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/40 text-left"
                          onClick={() => { setShowResults(false); navigate('/leads') }}
                        >
                          <Building2 className="w-3 h-3 text-emerald-500 shrink-0" />
                          <span className="truncate">{l.company_name}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notifications — real detected replies (shows state even when empty) */}
        <div className="relative" ref={bellRef}>
          <Button variant="ghost" size="icon" className="w-8 h-8 relative" onClick={() => setShowBell(s => !s)}
            title="Reply notifications">
            <Bell className="w-4 h-4" />
            {replyCount > 0 && (
              <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-violet-500 text-white text-[9px] flex items-center justify-center">
                {replyCount > 9 ? '9+' : replyCount}
              </span>
            )}
            <span className="sr-only">Notifications</span>
          </Button>
          {showBell && (
            <div className="absolute right-0 mt-1 w-72 rounded-lg border border-border bg-popover shadow-lg z-50 p-2">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground/60 px-1 pb-1 flex items-center gap-1">
                <MessageSquareReply className="w-3 h-3" />
                Reply notifications ({replyCount})
              </p>
              {replyCount === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground text-center">
                  No reply notifications yet.
                  <span className="block mt-1 text-muted-foreground/70">
                    When a prospect replies to your outreach mail, it shows here (checks every 2 min).
                  </span>
                </p>
              ) : (
                <>
                  {replies.slice(0, 5).map((r: any) => (
                    <Link key={r.id} to="/reports" className="block px-2 py-1.5 text-xs rounded hover:bg-muted/40">
                      <p className="truncate font-medium">{r.sender || 'Unknown'}</p>
                      <p className="truncate text-muted-foreground">{r.subject}</p>
                    </Link>
                  ))}
                  <Link to="/reports" className="block px-2 pt-2 pb-1 text-[11px] text-violet-500 hover:underline">
                    View all replies →
                  </Link>
                </>
              )}
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={toggle} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4" />}
        </Button>

        {/* Profile — real user info from Settings */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setShowProfile(s => !s)}
            title="Your profile"
            className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-semibold shadow-sm hover:ring-2 hover:ring-violet-300 transition-all"
          >
            {initials}
          </button>
          {showProfile && (
            <div className="absolute right-0 mt-1 w-64 rounded-lg border border-border bg-popover shadow-lg z-50 p-3">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{profile.sender_name || 'Your Name'}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {profile.sender_role ? `${profile.sender_role}` : 'Set your role in Settings'}
                  </p>
                </div>
              </div>
              <div className="py-2 space-y-1.5">
                {(profile.company_name || profile.products) && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <BriefcaseBusiness className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{profile.company_name || 'Company not set'}</span>
                      {profile.products && <span className="block truncate">{profile.products}</span>}
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <User className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    <span className="block truncate">{profile.target_market || 'Target market not set'}</span>
                    {profile.icp_description && <span className="block truncate">ICP configured ✓</span>}
                  </span>
                </div>
                {!profile.sender_name && (
                  <Link to="/settings" className="block rounded-lg border border-violet-500/40 bg-violet-500/5 p-2 text-[11px] text-violet-600 dark:text-violet-300 hover:bg-violet-500/10">
                    Complete your profile in Settings →
                  </Link>
                )}
              </div>
              <Link to="/settings" className="flex items-center gap-2 px-2 py-2 text-xs rounded hover:bg-muted/40 border-t border-border">
                <Settings className="w-3.5 h-3.5" />
                Settings & Integrations
                <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

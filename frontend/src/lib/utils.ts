import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return '0'
  return Math.round(score).toString()
}

export function getScoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-500'
  if (score >= 50) return 'text-amber-500'
  return 'text-rose-500'
}

export function getScoreBg(score: number): string {
  if (score >= 75) return 'bg-emerald-500'
  if (score >= 50) return 'bg-amber-500'
  return 'bg-rose-500'
}

export function getPriorityClass(priority: string): string {
  switch (priority?.toLowerCase()) {
    case 'high': return 'priority-high'
    case 'medium': return 'priority-medium'
    case 'low': return 'priority-low'
    default: return 'priority-medium'
  }
}

export function getStatusClass(status: string): string {
  const statusKey = status?.toLowerCase().replace(' ', '_')
  return `status-${statusKey}`
}

export function truncate(text: string, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toString()
}

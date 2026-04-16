import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { InboxConfig } from './types.js'
import { DEFAULT_CONFIG } from './types.js'

const CONFIG_PATH = join(homedir(), '.config', 'inb0x', 'config.json')

export function loadConfig(): InboxConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<InboxConfig>
    return {
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        ...parsed.notifications,
      },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: InboxConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}

export function shouldNotify(
  config: InboxConfig,
  from: string,
  labels: string[],
  subject: string,
): boolean {
  const { notifications } = config

  // VIP always breaks through
  if (notifications.vip.some(v => from.toLowerCase().includes(v.toLowerCase()))) {
    return true
  }

  // Keyword filter — always notify if subject matches
  if (notifications.keywords.some(kw => subject.toLowerCase().includes(kw.toLowerCase()))) {
    return true
  }

  // Quiet hours check
  if (notifications.quiet_hours) {
    const now = new Date()
    const hours = now.getHours()
    const minutes = now.getMinutes()
    const current = hours * 60 + minutes
    const [startH, startM] = notifications.quiet_hours.start.split(':').map(Number)
    const [endH, endM] = notifications.quiet_hours.end.split(':').map(Number)
    const start = startH * 60 + startM
    const end = endH * 60 + endM

    if (start > end) {
      // Overnight: e.g., 22:00 - 07:00
      if (current >= start || current < end) return false
    } else {
      if (current >= start && current < end) return false
    }
  }

  // Category filter
  const categoryLabels = labels
    .filter(l => l.startsWith('CATEGORY_'))
    .map(l => l.replace('CATEGORY_', '').toLowerCase())

  // If no category labels, treat as primary
  if (categoryLabels.length === 0) categoryLabels.push('primary')

  return categoryLabels.some(c => notifications.categories.includes(c))
}

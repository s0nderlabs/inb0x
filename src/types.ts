export interface InboxConfig {
  notifications: {
    categories: string[]
    vip: string[]
    keywords: string[]
    quiet_hours: { start: string; end: string } | null
    digest: boolean
    digest_interval_minutes: number
  }
}

export const DEFAULT_CONFIG: InboxConfig = {
  notifications: {
    categories: ['primary'],
    vip: [],
    keywords: [],
    quiet_hours: null,
    digest: false,
    digest_interval_minutes: 15,
  },
}

export interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export function toolResult(text: string, isError?: boolean): ToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError } : {}) }
}

export function toolError(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

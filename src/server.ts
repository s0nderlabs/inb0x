import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { toolResult, toolError } from './types.js'
import * as gmail from './gmail.js'
import { loadConfig, saveConfig } from './config.js'
import { resolveSavePath, uniquePath } from './paths.js'
import { resolveAttachment, type AttachmentInput, type ResolvedAttachment } from './mime.js'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

const CHANNEL_NAME = 'inb0x'
const CHANNEL_VERSION = '0.3.0'

const ATTACHMENTS_SCHEMA = {
  type: 'array' as const,
  description: 'Files to attach. Each entry needs either `path` (preferred — file on disk, supports `~/...`, absolute, or relative) or `data` (inline base64 with required `filename`). `filename` overrides the path basename. `mime_type` overrides extension-based detection.',
  items: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Path to a file on disk' },
      data: { type: 'string', description: 'Inline base64-encoded bytes (requires filename)' },
      filename: { type: 'string', description: 'Display filename (overrides path basename; required when using data)' },
      mime_type: { type: 'string', description: 'Override MIME type (defaults to lookup by extension, fallback application/octet-stream)' },
    },
  },
}

export function createServer(userEmail: string) {
  const mcp = new Server(
    { name: CHANNEL_NAME, version: CHANNEL_VERSION },
    {
      capabilities: {
        tools: {},
        experimental: { 'claude/channel': {} },
      },
      instructions: [
        `Connected to Gmail as: ${userEmail}`,
        'Real-time email notifications arrive as <channel source="email" from="..." subject="..." ts="...">.',
        '',
        'Available tools:',
        '- email__search: Search emails using Gmail query syntax',
        '- email__read: Read a full thread or message',
        '- email__send: Compose and send a new email (supports attachments: array of {path}|{data,filename})',
        '- email__reply: Reply to a thread (supports attachments)',
        '- email__forward: Forward a message (supports attachments; original attachments NOT auto-included)',
        '- email__trash: Batch trash messages (up to 1000)',
        '- email__archive: Batch archive (remove from inbox)',
        '- email__spam: Batch mark as spam',
        '- email__label: Batch add/remove labels',
        '- email__mark_read: Batch mark as read',
        '- email__unsubscribe: Parse List-Unsubscribe header and execute',
        '- email__filters: Create/list/delete Gmail filters',
        '- email__stats: Inbox count, unread, category breakdown',
        '- email__cleanup: Smart bulk operations (search + batch modify)',
        '- email__subscriptions: List subscription senders with unsubscribe info',
        '- email__config: View or update notification settings (VIP, keywords, categories, quiet hours)',
        '- email__attachments: List attachments on a message or thread',
        '- email__download_attachment: Download an attachment to a local file',
      ].join('\n'),
    },
  )

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'email__search',
        description: 'Search emails using Gmail query syntax. Returns message previews.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Gmail search query (e.g., "from:foo@bar.com", "is:unread", "subject:invoice older_than:7d")' },
            max_results: { type: 'number', description: 'Max results to return (default: 20, max: 100)' },
            page_token: { type: 'string', description: 'Pagination token from previous search' },
          },
          required: ['query'],
        },
      },
      {
        name: 'email__read',
        description: 'Read a full email thread or single message with body content.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            id: { type: 'string', description: 'Message ID or Thread ID' },
            type: { type: 'string', enum: ['message', 'thread'], description: 'Whether to read a single message or full thread (default: thread)' },
          },
          required: ['id'],
        },
      },
      {
        name: 'email__send',
        description: 'Compose and send a new email. Optionally attach files via `attachments` (file paths or inline base64 data).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            to: { type: 'string', description: 'Recipient email address(es), comma-separated' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email body (plain text)' },
            cc: { type: 'string', description: 'CC recipients, comma-separated' },
            bcc: { type: 'string', description: 'BCC recipients, comma-separated' },
            attachments: { ...ATTACHMENTS_SCHEMA },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      {
        name: 'email__reply',
        description: 'Reply to an email thread. Maintains In-Reply-To and References headers. Optionally attach files via `attachments`.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            thread_id: { type: 'string', description: 'Thread ID to reply to' },
            body: { type: 'string', description: 'Reply body (plain text)' },
            attachments: { ...ATTACHMENTS_SCHEMA },
          },
          required: ['thread_id', 'body'],
        },
      },
      {
        name: 'email__forward',
        description: 'Forward an email to another address. Note: original attachments are NOT auto-included — pass them explicitly via `attachments` (use email__download_attachment first if you need to re-send a downloaded file).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            message_id: { type: 'string', description: 'Message ID to forward' },
            to: { type: 'string', description: 'Recipient email address' },
            body: { type: 'string', description: 'Optional message to prepend' },
            attachments: { ...ATTACHMENTS_SCHEMA },
          },
          required: ['message_id', 'to'],
        },
      },
      {
        name: 'email__trash',
        description: 'Batch trash emails. Accepts up to 1000 message IDs per call.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            message_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of message IDs to trash',
            },
          },
          required: ['message_ids'],
        },
      },
      {
        name: 'email__archive',
        description: 'Batch archive emails (remove INBOX label).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            message_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of message IDs to archive',
            },
          },
          required: ['message_ids'],
        },
      },
      {
        name: 'email__spam',
        description: 'Batch mark emails as spam.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            message_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of message IDs to mark as spam',
            },
          },
          required: ['message_ids'],
        },
      },
      {
        name: 'email__label',
        description: 'Batch add or remove labels from emails.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            message_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of message IDs',
            },
            add: {
              type: 'array',
              items: { type: 'string' },
              description: 'Label IDs to add',
            },
            remove: {
              type: 'array',
              items: { type: 'string' },
              description: 'Label IDs to remove',
            },
          },
          required: ['message_ids'],
        },
      },
      {
        name: 'email__mark_read',
        description: 'Batch mark emails as read.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            message_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of message IDs to mark as read',
            },
          },
          required: ['message_ids'],
        },
      },
      {
        name: 'email__unsubscribe',
        description: 'Unsubscribe from a mailing list. Reads the List-Unsubscribe header and executes it (mailto or returns URL).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            message_id: { type: 'string', description: 'Message ID from the sender to unsubscribe from' },
          },
          required: ['message_id'],
        },
      },
      {
        name: 'email__filters',
        description: 'Create, list, or delete Gmail filters.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            action: { type: 'string', enum: ['list', 'create', 'delete'], description: 'Action to perform' },
            filter_id: { type: 'string', description: 'Filter ID (for delete)' },
            from: { type: 'string', description: 'From address pattern (for create)' },
            to: { type: 'string', description: 'To address pattern (for create)' },
            subject: { type: 'string', description: 'Subject pattern (for create)' },
            query: { type: 'string', description: 'Gmail query (for create)' },
            add_label: { type: 'string', description: 'Label to add (for create)' },
            remove_label: { type: 'string', description: 'Label to remove (for create)' },
            archive: { type: 'boolean', description: 'Auto-archive matching messages (for create)' },
            trash: { type: 'boolean', description: 'Auto-trash matching messages (for create)' },
            mark_read: { type: 'boolean', description: 'Auto-mark-read matching messages (for create)' },
          },
          required: ['action'],
        },
      },
      {
        name: 'email__stats',
        description: 'Get inbox statistics: total count, unread, category breakdown.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'email__cleanup',
        description: 'Smart bulk operation: search for emails matching a query and apply an action (trash, archive, spam, mark_read) to all results.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Gmail search query (e.g., "from:spam@example.com older_than:30d")' },
            action: { type: 'string', enum: ['trash', 'archive', 'spam', 'mark_read'], description: 'Action to apply to matching messages' },
            max_messages: { type: 'number', description: 'Maximum messages to process (default: 500, max: 5000)' },
          },
          required: ['query', 'action'],
        },
      },
      {
        name: 'email__subscriptions',
        description: 'List subscription senders. Finds emails with List-Unsubscribe headers, groups by sender, shows counts and unsubscribe method.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            max_scan: { type: 'number', description: 'Maximum messages to scan (default: 200)' },
          },
          required: [],
        },
      },
      {
        name: 'email__attachments',
        description: 'List attachments on a message or across an entire thread. Returns filenames, mime types, sizes, and attachment IDs (use these with email__download_attachment).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            id: { type: 'string', description: 'Message ID or Thread ID' },
            type: { type: 'string', enum: ['message', 'thread'], description: 'Whether `id` refers to a message or full thread (default: message)' },
            include_inline: { type: 'boolean', description: 'Include inline parts (embedded images referenced by HTML cid:). Default: false.' },
          },
          required: ['id'],
        },
      },
      {
        name: 'email__download_attachment',
        description: 'Download an attachment from a message to a local file. Identify the attachment by attachment_id (preferred), filename, or zero-based index within the message. The save destination can be an absolute path, a directory (the original filename is appended), or omitted to default to ~/Downloads.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            message_id: { type: 'string', description: 'Gmail message ID that holds the attachment' },
            attachment_id: { type: 'string', description: 'Attachment ID from email__attachments (preferred selector)' },
            filename: { type: 'string', description: 'Match attachment by exact filename (case-insensitive). Used if attachment_id is omitted.' },
            index: { type: 'number', description: 'Zero-based index within listAttachments order. Used if attachment_id and filename are both omitted.' },
            save_path: { type: 'string', description: 'Where to save. Absolute path, directory path, or `~/...`. Defaults to ~/Downloads/<filename>. If the path is an existing directory or ends with "/", the original filename is appended.' },
            overwrite: { type: 'boolean', description: 'Overwrite an existing file at the target path. Default: false (a numeric suffix is added to avoid collisions).' },
          },
          required: ['message_id'],
        },
      },
      {
        name: 'email__config',
        description: 'View or update notification settings (VIP list, keyword filters, categories, quiet hours, digest mode).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            action: { type: 'string', enum: ['get', 'set'], description: 'Get current config or set a value' },
            categories: {
              type: 'array',
              items: { type: 'string' },
              description: 'Gmail categories to notify for (e.g., ["primary", "updates"]). Empty array = VIP/keywords only.',
            },
            vip: {
              type: 'array',
              items: { type: 'string' },
              description: 'VIP email addresses — always notify regardless of category or quiet hours',
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Subject keywords — always notify if subject contains any of these',
            },
            quiet_start: { type: 'string', description: 'Quiet hours start (e.g., "22:00"). Set both start and end, or omit to disable.' },
            quiet_end: { type: 'string', description: 'Quiet hours end (e.g., "07:00")' },
            digest: { type: 'boolean', description: 'Enable digest mode (batch notifications)' },
            digest_interval: { type: 'number', description: 'Digest interval in minutes (default: 15)' },
          },
          required: ['action'],
        },
      },
    ],
  }))

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>

    try {
      switch (req.params.name) {
        case 'email__search':
          return await handleSearch(args)
        case 'email__read':
          return await handleRead(args)
        case 'email__send':
          return await handleSend(args)
        case 'email__reply':
          return await handleReply(args)
        case 'email__forward':
          return await handleForward(args)
        case 'email__trash':
          return await handleTrash(args)
        case 'email__archive':
          return await handleArchive(args)
        case 'email__spam':
          return await handleSpam(args)
        case 'email__label':
          return await handleLabel(args)
        case 'email__mark_read':
          return await handleMarkRead(args)
        case 'email__unsubscribe':
          return await handleUnsubscribe(args)
        case 'email__filters':
          return await handleFilters(args)
        case 'email__stats':
          return await handleStats()
        case 'email__cleanup':
          return await handleCleanup(args)
        case 'email__subscriptions':
          return await handleSubscriptions(args)
        case 'email__attachments':
          return await handleAttachments(args)
        case 'email__download_attachment':
          return await handleDownloadAttachment(args)
        case 'email__config':
          return handleConfig(args)
        default:
          return toolError(`Unknown tool: ${req.params.name}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return toolError(`${req.params.name} failed: ${msg}`)
    }
  })

  return mcp
}

// ── Tool Handlers ─────────────────────────────────────────────────

async function handleSearch(args: Record<string, unknown>) {
  const query = args.query as string
  const maxResults = Math.min((args.max_results as number) ?? 20, 100)
  const pageToken = args.page_token as string | undefined

  const { messages, nextPageToken } = await gmail.searchMessages(query, maxResults, pageToken)

  if (messages.length === 0) {
    return toolResult('No messages found.')
  }

  // Fetch metadata for each message
  const detailed = await Promise.all(
    messages.map(m => gmail.getMessage(m.id!, 'metadata')),
  )

  const lines = detailed.map(m => gmail.formatMessagePreview(m))
  let text = `Found ${messages.length} message(s):\n\n${lines.join('\n\n')}`

  if (nextPageToken) {
    text += `\n\n--- More results available. Use page_token: "${nextPageToken}" ---`
  }

  return toolResult(text)
}

async function handleRead(args: Record<string, unknown>) {
  const id = args.id as string
  const type = (args.type as string) ?? 'thread'

  if (type === 'message') {
    const msg = await gmail.getMessage(id)
    return toolResult(gmail.formatMessage(msg))
  }

  // Thread
  const thread = await gmail.getThread(id)
  const messages = thread.messages ?? []

  if (messages.length === 0) {
    return toolResult('Empty thread.')
  }

  const formatted = messages.map(m => gmail.formatMessage(m))
  return toolResult(`Thread (${messages.length} message(s)):\n\n${'='.repeat(60)}\n\n${formatted.join(`\n\n${'='.repeat(60)}\n\n`)}`)
}

async function resolveAttachmentsArg(
  raw: unknown,
): Promise<{ resolved?: ResolvedAttachment[]; error?: string }> {
  if (raw == null) return { resolved: undefined }
  if (!Array.isArray(raw)) return { error: 'attachments must be an array' }
  if (raw.length === 0) return { resolved: undefined }
  try {
    const resolved = await Promise.all(
      (raw as AttachmentInput[]).map(a => resolveAttachment(a)),
    )
    return { resolved }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function attachmentSummary(atts: ResolvedAttachment[] | undefined): string {
  if (!atts || atts.length === 0) return ''
  const total = atts.reduce((n, a) => n + a.bytes.length, 0)
  return ` with ${atts.length} attachment(s), ${gmail.formatBytes(total)} total`
}

async function handleSend(args: Record<string, unknown>) {
  const to = args.to as string
  const subject = args.subject as string
  const body = args.body as string
  const cc = args.cc as string | undefined
  const bcc = args.bcc as string | undefined

  const { resolved, error } = await resolveAttachmentsArg(args.attachments)
  if (error) return toolError(`attachments: ${error}`)

  const msg = await gmail.sendMessage(to, subject, body, cc, bcc, resolved)
  return toolResult(`Email sent to ${to}${attachmentSummary(resolved)}. Message ID: ${msg.id}`)
}

async function handleReply(args: Record<string, unknown>) {
  const threadId = args.thread_id as string
  const body = args.body as string

  const { resolved, error } = await resolveAttachmentsArg(args.attachments)
  if (error) return toolError(`attachments: ${error}`)

  const thread = await gmail.getThread(threadId)
  const messages = thread.messages ?? []

  if (messages.length === 0) {
    return toolError('Thread has no messages')
  }

  const lastMsg = messages[messages.length - 1]
  const from = gmail.getHeader(lastMsg, 'From')
  const subject = gmail.getHeader(lastMsg, 'Subject')
  const msgId = gmail.getHeader(lastMsg, 'Message-ID')
  const refs = gmail.getHeader(lastMsg, 'References')

  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`
  const references = refs ? `${refs} ${msgId}` : msgId

  const msg = await gmail.replyToThread(threadId, msgId, from, replySubject, body, references, resolved)
  return toolResult(`Reply sent to ${from}${attachmentSummary(resolved)}. Message ID: ${msg.id}`)
}

async function handleForward(args: Record<string, unknown>) {
  const messageId = args.message_id as string
  const to = args.to as string
  const body = args.body as string | undefined

  const { resolved, error } = await resolveAttachmentsArg(args.attachments)
  if (error) return toolError(`attachments: ${error}`)

  const msg = await gmail.forwardMessage(messageId, to, body, resolved)
  return toolResult(`Message forwarded to ${to}${attachmentSummary(resolved)}. Message ID: ${msg.id}`)
}

async function handleTrash(args: Record<string, unknown>) {
  const ids = args.message_ids as string[]
  await gmail.batchTrash(ids)
  return toolResult(`Trashed ${ids.length} message(s).`)
}

async function handleArchive(args: Record<string, unknown>) {
  const ids = args.message_ids as string[]
  await gmail.batchArchive(ids)
  return toolResult(`Archived ${ids.length} message(s).`)
}

async function handleSpam(args: Record<string, unknown>) {
  const ids = args.message_ids as string[]
  await gmail.batchSpam(ids)
  return toolResult(`Marked ${ids.length} message(s) as spam.`)
}

async function handleLabel(args: Record<string, unknown>) {
  const ids = args.message_ids as string[]
  const add = args.add as string[] | undefined
  const remove = args.remove as string[] | undefined

  await gmail.batchModify(ids, add, remove)

  const parts: string[] = []
  if (add?.length) parts.push(`added labels: ${add.join(', ')}`)
  if (remove?.length) parts.push(`removed labels: ${remove.join(', ')}`)

  return toolResult(`Modified ${ids.length} message(s): ${parts.join('; ')}.`)
}

async function handleMarkRead(args: Record<string, unknown>) {
  const ids = args.message_ids as string[]
  await gmail.batchMarkRead(ids)
  return toolResult(`Marked ${ids.length} message(s) as read.`)
}

async function handleUnsubscribe(args: Record<string, unknown>) {
  const messageId = args.message_id as string
  const msg = await gmail.getMessage(messageId)

  const listUnsub = gmail.getHeader(msg, 'List-Unsubscribe')
  const listUnsubPost = gmail.getHeader(msg, 'List-Unsubscribe-Post')

  if (!listUnsub) {
    return toolError('No List-Unsubscribe header found. This sender may not support unsubscribe.')
  }

  // Parse the header — can contain mailto: and/or https: URLs
  const urls = listUnsub.match(/<([^>]+)>/g)?.map(u => u.slice(1, -1)) ?? []
  const mailto = urls.find(u => u.startsWith('mailto:'))
  const https = urls.find(u => u.startsWith('http'))

  // Try one-click POST first (RFC 8058)
  if (https && listUnsubPost) {
    try {
      const resp = await fetch(https, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: listUnsubPost,
      })
      if (resp.ok) {
        return toolResult(`Unsubscribed via one-click POST to ${https}`)
      }
    } catch {}
  }

  // Try mailto
  if (mailto) {
    const parsed = new URL(mailto)
    const toAddr = parsed.pathname
    const subject = parsed.searchParams.get('subject') ?? 'unsubscribe'
    const body = parsed.searchParams.get('body') ?? 'unsubscribe'

    await gmail.sendMessage(toAddr, subject, body)
    return toolResult(`Unsubscribe email sent to ${toAddr}`)
  }

  // Fall back to returning the URL
  if (https) {
    return toolResult(`Cannot auto-unsubscribe. Visit this URL to unsubscribe:\n${https}`)
  }

  return toolError('Could not parse List-Unsubscribe header.')
}

async function handleFilters(args: Record<string, unknown>) {
  const action = args.action as string

  if (action === 'list') {
    const filters = await gmail.listFilters()
    if (filters.length === 0) {
      return toolResult('No filters configured.')
    }
    const lines = filters.map(f => {
      const criteria = f.criteria ?? {}
      const filterAction = f.action ?? {}
      const parts: string[] = []
      if (criteria.from) parts.push(`from:${criteria.from}`)
      if (criteria.to) parts.push(`to:${criteria.to}`)
      if (criteria.subject) parts.push(`subject:${criteria.subject}`)
      if (criteria.query) parts.push(`query:${criteria.query}`)

      const actions: string[] = []
      if (filterAction.addLabelIds?.length) actions.push(`+labels: ${filterAction.addLabelIds.join(', ')}`)
      if (filterAction.removeLabelIds?.length) actions.push(`-labels: ${filterAction.removeLabelIds.join(', ')}`)

      return `[${f.id}] ${parts.join(', ')} → ${actions.join('; ')}`
    })
    return toolResult(`Filters (${filters.length}):\n${lines.join('\n')}`)
  }

  if (action === 'delete') {
    const filterId = args.filter_id as string
    if (!filterId) return toolError('filter_id is required for delete')
    await gmail.deleteFilter(filterId)
    return toolResult(`Filter ${filterId} deleted.`)
  }

  if (action === 'create') {
    const criteria: Record<string, string> = {}
    if (args.from) criteria.from = args.from as string
    if (args.to) criteria.to = args.to as string
    if (args.subject) criteria.subject = args.subject as string
    if (args.query) criteria.query = args.query as string

    const filterAction: Record<string, unknown> = {}
    if (args.add_label) filterAction.addLabelIds = [args.add_label as string]
    if (args.remove_label) filterAction.removeLabelIds = [args.remove_label as string]
    if (args.archive) filterAction.removeLabelIds = [...(filterAction.removeLabelIds as string[] ?? []), 'INBOX']
    if (args.trash) filterAction.addLabelIds = [...(filterAction.addLabelIds as string[] ?? []), 'TRASH']
    if (args.mark_read) filterAction.removeLabelIds = [...(filterAction.removeLabelIds as string[] ?? []), 'UNREAD']

    const filter = await gmail.createFilter(criteria, filterAction)
    return toolResult(`Filter created. ID: ${filter.id}`)
  }

  return toolError('Invalid action. Use: list, create, delete')
}

async function handleStats() {
  const profile = await gmail.getProfile()

  // Get counts by searching
  const inboxResult = await gmail.searchMessages('in:inbox', 1)
  const unreadResult = await gmail.searchMessages('is:unread in:inbox', 1)

  // Category counts
  const categories = ['primary', 'social', 'promotions', 'updates', 'forums']
  const categoryCounts: Record<string, number> = {}

  await Promise.all(
    categories.map(async (cat) => {
      const result = await gmail.searchMessages(`category:${cat} in:inbox`, 1)
      categoryCounts[cat] = result.messages.length > 0 ? result.messages.length : 0
    }),
  )

  // Note: message.list only returns up to maxResults, so counts are estimates
  // Use profile for total messages/threads
  let text = `Email: ${profile.emailAddress}\n`
  text += `Total messages: ${profile.messagesTotal}\n`
  text += `Total threads: ${profile.threadsTotal}\n`
  text += `History ID: ${profile.historyId}\n`
  text += `\nNote: Gmail API does not provide exact inbox/unread counts.\n`
  text += `Use email__search with specific queries for precise filtering.`

  return toolResult(text)
}

async function handleCleanup(args: Record<string, unknown>) {
  const query = args.query as string
  const action = args.action as string
  const maxMessages = Math.min((args.max_messages as number) ?? 500, 5000)

  // Collect all matching message IDs
  const allIds: string[] = []
  let pageToken: string | undefined

  while (allIds.length < maxMessages) {
    const batchSize = Math.min(100, maxMessages - allIds.length)
    const { messages, nextPageToken } = await gmail.searchMessages(query, batchSize, pageToken)

    for (const m of messages) {
      if (m.id) allIds.push(m.id)
    }

    if (!nextPageToken || allIds.length >= maxMessages) break
    pageToken = nextPageToken
  }

  if (allIds.length === 0) {
    return toolResult(`No messages found matching: ${query}`)
  }

  // Apply action
  switch (action) {
    case 'trash':
      await gmail.batchTrash(allIds)
      break
    case 'archive':
      await gmail.batchArchive(allIds)
      break
    case 'spam':
      await gmail.batchSpam(allIds)
      break
    case 'mark_read':
      await gmail.batchMarkRead(allIds)
      break
    default:
      return toolError(`Invalid action: ${action}`)
  }

  return toolResult(`${action}: ${allIds.length} message(s) matching "${query}"`)
}

async function handleSubscriptions(args: Record<string, unknown>) {
  const maxScan = Math.min((args.max_scan as number) ?? 200, 500)

  // Search for emails with "unsubscribe" (Gmail indexes List-Unsubscribe headers and body text)
  const allIds: string[] = []
  let pageToken: string | undefined

  while (allIds.length < maxScan) {
    const batchSize = Math.min(100, maxScan - allIds.length)
    const { messages, nextPageToken } = await gmail.searchMessages('unsubscribe', batchSize, pageToken)

    for (const m of messages) {
      if (m.id) allIds.push(m.id)
    }

    if (!nextPageToken || allIds.length >= maxScan) break
    pageToken = nextPageToken
  }

  if (allIds.length === 0) {
    return toolResult('No subscription emails found.')
  }

  // Fetch headers for each message (metadata only — fast)
  const senderMap = new Map<string, {
    count: number
    lastDate: string
    unsubMethod: 'mailto' | 'https' | 'one-click' | 'none'
    sampleMessageId: string
  }>()

  // Process in batches to avoid rate limits
  const batchSize = 20
  for (let i = 0; i < allIds.length; i += batchSize) {
    const batch = allIds.slice(i, i + batchSize)
    const messages = await Promise.all(
      batch.map(id => gmail.getMessage(id, 'metadata')),
    )

    for (const msg of messages) {
      const from = gmail.getHeader(msg, 'From')
      const date = gmail.getHeader(msg, 'Date')
      const listUnsub = gmail.getHeader(msg, 'List-Unsubscribe')
      const listUnsubPost = gmail.getHeader(msg, 'List-Unsubscribe-Post')

      // Extract email address from "Name <email>" format
      const emailMatch = from.match(/<([^>]+)>/)
      const senderEmail = emailMatch ? emailMatch[1] : from
      const senderKey = senderEmail.toLowerCase()

      let method: 'mailto' | 'https' | 'one-click' | 'none' = 'none'
      if (listUnsub) {
        if (listUnsubPost) method = 'one-click'
        else if (listUnsub.includes('mailto:')) method = 'mailto'
        else if (listUnsub.includes('http')) method = 'https'
      }

      const existing = senderMap.get(senderKey)
      if (existing) {
        existing.count++
        // Keep the most recent date
        if (date > existing.lastDate) existing.lastDate = date
        // Upgrade method if better
        if (method !== 'none' && existing.unsubMethod === 'none') {
          existing.unsubMethod = method
          existing.sampleMessageId = msg.id!
        }
      } else {
        senderMap.set(senderKey, {
          count: 1,
          lastDate: date,
          unsubMethod: method,
          sampleMessageId: msg.id!,
        })
      }
    }
  }

  // Sort by count descending
  const sorted = [...senderMap.entries()].sort((a, b) => b[1].count - a[1].count)

  const lines = sorted.map(([sender, info]) => {
    const method = info.unsubMethod === 'none' ? 'no unsub header' : info.unsubMethod
    return `${sender}\n  ${info.count} emails | last: ${info.lastDate} | unsub: ${method} | msg_id: ${info.sampleMessageId}`
  })

  return toolResult(
    `Subscriptions (${sorted.length} senders from ${allIds.length} scanned emails):\n\n${lines.join('\n\n')}`,
  )
}

async function handleAttachments(args: Record<string, unknown>) {
  const id = args.id as string
  const type = (args.type as string) ?? 'message'
  const includeInline = (args.include_inline as boolean) ?? false

  const messages = type === 'thread'
    ? (await gmail.getThread(id)).messages ?? []
    : [await gmail.getMessage(id)]

  if (messages.length === 0) return toolResult('No messages found.')

  const sections: string[] = []
  let total = 0
  for (const msg of messages) {
    const atts = gmail.listAttachments(msg).filter(a => includeInline || !a.inline)
    if (atts.length === 0) continue
    total += atts.length
    const subject = gmail.getHeader(msg, 'Subject') || '(no subject)'
    const from = gmail.getHeader(msg, 'From')
    const lines = atts.map((a, idx) => gmail.formatAttachmentLine(a, idx, { multiline: true }))
    sections.push(
      `Message ${msg.id} — ${subject}\n  From: ${from}\n${lines.join('\n')}`,
    )
  }

  if (total === 0) {
    const hint = includeInline ? '' : ' (try include_inline:true to also list embedded images)'
    return toolResult(`No attachments found${hint}.`)
  }

  const header = type === 'thread'
    ? `Thread ${id}: ${total} attachment(s) across ${sections.length} message(s)`
    : `Message ${id}: ${total} attachment(s)`
  return toolResult(`${header}\n\n${sections.join('\n\n')}\n\nDownload with: email__download_attachment {message_id, attachment_id}`)
}

async function handleDownloadAttachment(args: Record<string, unknown>) {
  const messageId = args.message_id as string
  const attachmentId = args.attachment_id as string | undefined
  const filename = args.filename as string | undefined
  const index = args.index as number | undefined
  const savePath = args.save_path as string | undefined
  const overwrite = (args.overwrite as boolean) ?? false

  if (!messageId) return toolError('message_id is required')
  if (!attachmentId && !filename && index === undefined) {
    return toolError('Provide one of: attachment_id, filename, or index')
  }

  const msg = await gmail.getMessage(messageId)
  const available = gmail.listAttachments(msg)
  const att = gmail.findAttachment(available, { attachmentId, filename, index })
  if (!att) {
    if (available.length === 0) {
      return toolError(`Message ${messageId} has no attachments.`)
    }
    const list = available.map((a, i) => gmail.formatAttachmentLine(a, i)).join('\n')
    return toolError(`Attachment not found. Available:\n${list}`)
  }

  const data = await gmail.getAttachmentData(att.messageId, att.attachmentId)
  const target = await resolveSavePath(savePath, att.filename)
  const finalPath = await uniquePath(target, overwrite)

  await mkdir(dirname(finalPath), { recursive: true })
  await writeFile(finalPath, data)

  return toolResult(
    `Saved ${att.filename} (${att.mimeType}, ${gmail.formatBytes(data.length)}) to:\n${finalPath}`,
  )
}

function handleConfig(args: Record<string, unknown>) {
  const action = args.action as string
  const config = loadConfig()

  if (action === 'get') {
    return toolResult(JSON.stringify(config, null, 2))
  }

  if (action === 'set') {
    if (args.categories !== undefined) config.notifications.categories = args.categories as string[]
    if (args.vip !== undefined) config.notifications.vip = args.vip as string[]
    if (args.keywords !== undefined) config.notifications.keywords = args.keywords as string[]
    if (args.quiet_start && args.quiet_end) {
      config.notifications.quiet_hours = {
        start: args.quiet_start as string,
        end: args.quiet_end as string,
      }
    } else if (args.quiet_start === '' || args.quiet_end === '') {
      config.notifications.quiet_hours = null
    }
    if (args.digest !== undefined) config.notifications.digest = args.digest as boolean
    if (args.digest_interval !== undefined) config.notifications.digest_interval_minutes = args.digest_interval as number

    saveConfig(config)
    return toolResult(`Config updated:\n${JSON.stringify(config, null, 2)}`)
  }

  return toolError('Invalid action. Use: get, set')
}

// ── MCP Connection ────────────────────────────────────────────────

export async function connectMcp(userEmail: string) {
  const transport = new StdioServerTransport()
  const mcp = createServer(userEmail)
  await mcp.connect(transport)
  return mcp
}

export function notifyInbound(
  mcp: Server,
  from: string,
  subject: string,
  preview: string,
  messageUid: string,
) {
  // Extract just the email address for the user field
  const emailMatch = from.match(/<([^>]+)>/)
  const senderEmail = emailMatch ? emailMatch[1] : from
  const senderName = from.replace(/<[^>]+>/, '').trim() || senderEmail

  // Clean for XML safety
  const cleanUser = senderName.replace(/['"&<>]/g, '')
  const cleanSubject = subject.replace(/['"&<>]/g, '')

  // Content is what shows in the notification body
  // User is what shows after "email ·" in the header (like attn shows "agent_id · user")
  mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content: `${cleanSubject}${preview ? `\n${preview}` : ''}`,
      meta: {
        user: cleanUser,
        from: senderEmail.replace(/['"&<>]/g, ''),
        subject: cleanSubject,
        uid: messageUid,
        ts: new Date().toISOString(),
      },
    },
  }).catch((err) => {
    process.stderr.write(`inb0x: failed to deliver notification: ${err}\n`)
  })
}

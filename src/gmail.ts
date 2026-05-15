import { google, type gmail_v1 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

let gmailClient: gmail_v1.Gmail | null = null

export function initGmail(auth: OAuth2Client) {
  gmailClient = google.gmail({ version: 'v1', auth })
}

function gmail(): gmail_v1.Gmail {
  if (!gmailClient) throw new Error('Gmail client not initialized')
  return gmailClient
}

// ── Search ────────────────────────────────────────────────────────

export async function searchMessages(
  query: string,
  maxResults = 20,
  pageToken?: string,
): Promise<{ messages: gmail_v1.Schema$Message[]; nextPageToken?: string }> {
  const res = await gmail().users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
    pageToken,
  })
  return {
    messages: res.data.messages ?? [],
    nextPageToken: res.data.nextPageToken ?? undefined,
  }
}

// ── Read ──────────────────────────────────────────────────────────

export async function getMessage(
  id: string,
  format: 'full' | 'metadata' | 'minimal' = 'full',
): Promise<gmail_v1.Schema$Message> {
  const res = await gmail().users.messages.get({ userId: 'me', id, format })
  return res.data
}

export async function getThread(id: string): Promise<gmail_v1.Schema$Thread> {
  const res = await gmail().users.threads.get({ userId: 'me', id, format: 'full' })
  return res.data
}

// ── Send ──────────────────────────────────────────────────────────

export async function sendMessage(
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string,
): Promise<gmail_v1.Schema$Message> {
  const lines = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ]
  const raw = Buffer.from(lines.join('\r\n')).toString('base64url')
  const res = await gmail().users.messages.send({ userId: 'me', requestBody: { raw } })
  return res.data
}

// ── Reply ─────────────────────────────────────────────────────────

export async function replyToThread(
  threadId: string,
  messageId: string,
  to: string,
  subject: string,
  body: string,
  references: string,
): Promise<gmail_v1.Schema$Message> {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${messageId}`,
    `References: ${references}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ]
  const raw = Buffer.from(lines.join('\r\n')).toString('base64url')
  const res = await gmail().users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId },
  })
  return res.data
}

// ── Forward ───────────────────────────────────────────────────────

export async function forwardMessage(
  originalMessageId: string,
  to: string,
  body?: string,
): Promise<gmail_v1.Schema$Message> {
  const original = await getMessage(originalMessageId)
  const headers = original.payload?.headers ?? []
  const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

  const subject = getHeader('Subject').startsWith('Fwd:')
    ? getHeader('Subject')
    : `Fwd: ${getHeader('Subject')}`

  const originalBody = extractBody(original)
  const forwardBody = [
    ...(body ? [body, '', ''] : []),
    '---------- Forwarded message ----------',
    `From: ${getHeader('From')}`,
    `Date: ${getHeader('Date')}`,
    `Subject: ${getHeader('Subject')}`,
    `To: ${getHeader('To')}`,
    '',
    originalBody,
  ].join('\r\n')

  return sendMessage(to, subject, forwardBody)
}

// ── Batch Modify ──────────────────────────────────────────────────

export async function batchModify(
  ids: string[],
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<void> {
  // Gmail API limits batchModify to 1000 messages
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000)
    await gmail().users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: chunk,
        addLabelIds,
        removeLabelIds,
      },
    })
  }
}

export async function batchTrash(ids: string[]): Promise<void> {
  // No batchTrash in API, use batchModify to add TRASH label
  await batchModify(ids, ['TRASH'], ['INBOX'])
}

export async function batchArchive(ids: string[]): Promise<void> {
  await batchModify(ids, undefined, ['INBOX'])
}

export async function batchSpam(ids: string[]): Promise<void> {
  await batchModify(ids, ['SPAM'], ['INBOX'])
}

export async function batchMarkRead(ids: string[]): Promise<void> {
  await batchModify(ids, undefined, ['UNREAD'])
}

// ── Attachments ───────────────────────────────────────────────────

export interface AttachmentInfo {
  messageId: string
  attachmentId: string
  filename: string
  mimeType: string
  size: number
  partId: string
  inline: boolean
  contentId: string
}

function walkParts(root: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!root) return []
  const out: gmail_v1.Schema$MessagePart[] = []
  const visit = (p: gmail_v1.Schema$MessagePart) => {
    out.push(p)
    if (p.parts?.length) for (const child of p.parts) visit(child)
  }
  visit(root)
  return out
}

export function listAttachments(message: gmail_v1.Schema$Message): AttachmentInfo[] {
  const messageId = message.id ?? ''
  const out: AttachmentInfo[] = []
  for (const part of walkParts(message.payload)) {
    const attachmentId = part.body?.attachmentId ?? ''
    if (!attachmentId) continue
    const disposition = getHeader(part, 'Content-Disposition').split(';')[0]?.trim().toLowerCase() ?? ''
    out.push({
      messageId,
      attachmentId,
      filename: part.filename || `untitled-${part.partId ?? out.length}`,
      mimeType: part.mimeType ?? 'application/octet-stream',
      size: part.body?.size ?? 0,
      partId: part.partId ?? '',
      inline: disposition === 'inline',
      contentId: getHeader(part, 'Content-Id').replace(/^<|>$/g, ''),
    })
  }
  return out
}

export async function getAttachmentData(
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const res = await gmail().users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  })
  const data = res.data.data
  if (!data) throw new Error(`Attachment ${attachmentId} returned no data`)
  return Buffer.from(data, 'base64url')
}

export function findAttachment(
  atts: AttachmentInfo[],
  selector: { attachmentId?: string; filename?: string; index?: number },
): AttachmentInfo | null {
  if (selector.attachmentId) {
    return atts.find(a => a.attachmentId === selector.attachmentId) ?? null
  }
  if (selector.filename) {
    const want = selector.filename.toLowerCase()
    return atts.find(a => a.filename.toLowerCase() === want) ?? null
  }
  if (typeof selector.index === 'number') {
    return atts[selector.index] ?? null
  }
  return null
}

// ── Labels ────────────────────────────────────────────────────────

export async function listLabels(): Promise<gmail_v1.Schema$Label[]> {
  const res = await gmail().users.labels.list({ userId: 'me' })
  return res.data.labels ?? []
}

// ── Profile ───────────────────────────────────────────────────────

export async function getProfile(): Promise<gmail_v1.Schema$Profile> {
  const res = await gmail().users.getProfile({ userId: 'me' })
  return res.data
}

// ── Filters ───────────────────────────────────────────────────────

export async function listFilters(): Promise<gmail_v1.Schema$Filter[]> {
  const res = await gmail().users.settings.filters.list({ userId: 'me' })
  return res.data.filter ?? []
}

export async function createFilter(
  criteria: gmail_v1.Schema$FilterCriteria,
  action: gmail_v1.Schema$FilterAction,
): Promise<gmail_v1.Schema$Filter> {
  const res = await gmail().users.settings.filters.create({
    userId: 'me',
    requestBody: { criteria, action },
  })
  return res.data
}

export async function deleteFilter(id: string): Promise<void> {
  await gmail().users.settings.filters.delete({ userId: 'me', id })
}

// ── Helpers ───────────────────────────────────────────────────────

export function extractBody(message: gmail_v1.Schema$Message): string {
  const payload = message.payload
  if (!payload) return ''

  // Simple body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8')
  }

  // Multipart — find text/plain first, then text/html
  const parts = payload.parts ?? []
  const textPart = parts.find(p => p.mimeType === 'text/plain')
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, 'base64url').toString('utf8')
  }

  const htmlPart = parts.find(p => p.mimeType === 'text/html')
  if (htmlPart?.body?.data) {
    const html = Buffer.from(htmlPart.body.data, 'base64url').toString('utf8')
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  }

  // Nested multipart (e.g., multipart/alternative inside multipart/mixed)
  for (const part of parts) {
    if (part.parts) {
      const nested = part.parts.find(p => p.mimeType === 'text/plain')
      if (nested?.body?.data) {
        return Buffer.from(nested.body.data, 'base64url').toString('utf8')
      }
    }
  }

  return ''
}

function isMessage(
  source: gmail_v1.Schema$Message | gmail_v1.Schema$MessagePart,
): source is gmail_v1.Schema$Message {
  return (source as gmail_v1.Schema$Message).threadId !== undefined
    || (source as gmail_v1.Schema$Message).payload !== undefined
}

export function getHeader(
  source: gmail_v1.Schema$Message | gmail_v1.Schema$MessagePart,
  name: string,
): string {
  const headers = isMessage(source) ? source.payload?.headers : source.headers
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

export function formatAttachmentLine(
  att: AttachmentInfo,
  idx: number,
  opts: { multiline?: boolean } = {},
): string {
  const flags = att.inline ? ' (inline)' : ''
  const head = `  [${idx}] ${att.filename} — ${att.mimeType} — ${formatBytes(att.size)}${flags}`
  return opts.multiline
    ? `${head}\n      attachment_id: ${att.attachmentId}`
    : `${head} — attachment_id: ${att.attachmentId}`
}

export function formatAttachmentManifest(atts: AttachmentInfo[]): string {
  if (atts.length === 0) return ''
  const lines = atts.map((a, i) => formatAttachmentLine(a, i))
  return `Attachments (${atts.length}):\n${lines.join('\n')}`
}

export function formatMessage(message: gmail_v1.Schema$Message): string {
  const labels = (message.labelIds ?? []).join(', ')
  const body = extractBody(message)
  const manifest = formatAttachmentManifest(listAttachments(message))

  const lines = [
    `From: ${getHeader(message, 'From')}`,
    `To: ${getHeader(message, 'To')}`,
    `Subject: ${getHeader(message, 'Subject')}`,
    `Date: ${getHeader(message, 'Date')}`,
    `Labels: ${labels}`,
    `Message ID: ${message.id}`,
    `Thread ID: ${message.threadId}`,
    '',
    body,
  ]
  if (manifest) lines.push('', manifest)
  return lines.join('\n')
}

export function formatMessagePreview(message: gmail_v1.Schema$Message): string {
  const from = getHeader(message, 'From')
  const subject = getHeader(message, 'Subject')
  const date = getHeader(message, 'Date')
  const snippet = message.snippet ?? ''
  const unread = (message.labelIds ?? []).includes('UNREAD') ? ' [UNREAD]' : ''

  return `[${message.id}] ${from} — ${subject}${unread}\n  Thread: ${message.threadId} | ${date}\n  ${snippet}`
}

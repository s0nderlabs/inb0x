import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import { expandPath } from './paths.js'

export interface AttachmentInput {
  path?: string
  data?: string
  filename?: string
  mime_type?: string
}

export interface ResolvedAttachment {
  filename: string
  mimeType: string
  bytes: Buffer
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
}

export function mimeTypeFor(filename: string): string {
  const ext = extname(filename).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export async function resolveAttachment(att: AttachmentInput): Promise<ResolvedAttachment> {
  const hasPath = typeof att.path === 'string' && att.path.length > 0
  const hasData = typeof att.data === 'string' && att.data.length > 0
  if (hasPath && hasData) {
    throw new Error('attachment: provide either path or data, not both')
  }
  if (!hasPath && !hasData) {
    throw new Error('attachment: provide either path or data')
  }
  if (hasPath) {
    const bytes = await readFile(expandPath(att.path!))
    const filename = att.filename ?? basename(att.path!)
    const mimeType = att.mime_type ?? mimeTypeFor(filename)
    return { filename, mimeType, bytes }
  }
  if (!att.filename) {
    throw new Error('attachment with inline data must include filename')
  }
  const bytes = Buffer.from(att.data!, 'base64')
  return {
    filename: att.filename,
    mimeType: att.mime_type ?? mimeTypeFor(att.filename),
    bytes,
  }
}

function isAsciiPrintable(s: string): boolean {
  // ASCII printable without controls, quotes, or CRLF (safe for unquoted/quoted header param)
  return /^[\x20-\x7e]*$/.test(s) && !/["\\\r\n]/.test(s)
}

export function encodeAttachmentFilenameParam(name: string): string {
  if (isAsciiPrintable(name)) return `filename="${name}"`
  const encoded = encodeURIComponent(name).replace(/'/g, '%27')
  return `filename*=UTF-8''${encoded}`
}

export function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function wrapBase64(b64: string, width = 76): string {
  const chunks: string[] = []
  for (let i = 0; i < b64.length; i += width) chunks.push(b64.slice(i, i + width))
  return chunks.join('\r\n')
}

function randomBoundary(): string {
  const rand = Math.random().toString(36).slice(2, 14)
  const stamp = Date.now().toString(36)
  return `=_inb0x_${stamp}_${rand}`
}

export interface MimeBuildOpts {
  headers: Record<string, string | undefined>
  body: string
  attachments?: ResolvedAttachment[]
}

export function buildMimeMessage(opts: MimeBuildOpts): string {
  const { headers, body, attachments = [] } = opts

  const headerLines: string[] = []
  for (const [k, v] of Object.entries(headers)) {
    if (v == null || v === '') continue
    headerLines.push(k.toLowerCase() === 'subject' ? `${k}: ${encodeHeaderValue(v)}` : `${k}: ${v}`)
  }
  headerLines.push('MIME-Version: 1.0')

  if (attachments.length === 0) {
    headerLines.push('Content-Type: text/plain; charset=utf-8')
    headerLines.push('Content-Transfer-Encoding: 8bit')
    return `${headerLines.join('\r\n')}\r\n\r\n${body}`
  }

  const boundary = randomBoundary()
  headerLines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)

  const parts: string[] = []
  parts.push(`--${boundary}`)
  parts.push('Content-Type: text/plain; charset=utf-8')
  parts.push('Content-Transfer-Encoding: 8bit')
  parts.push('')
  parts.push(body)

  for (const att of attachments) {
    const fnParam = encodeAttachmentFilenameParam(att.filename)
    parts.push(`--${boundary}`)
    parts.push(`Content-Type: ${att.mimeType}; ${fnParam}`)
    parts.push('Content-Transfer-Encoding: base64')
    parts.push(`Content-Disposition: attachment; ${fnParam}`)
    parts.push('')
    parts.push(wrapBase64(att.bytes.toString('base64')))
  }
  parts.push(`--${boundary}--`)

  return `${headerLines.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`
}

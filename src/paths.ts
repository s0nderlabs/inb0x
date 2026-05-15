import { homedir } from 'node:os'
import { isAbsolute, resolve, join, dirname, basename, extname, sep } from 'node:path'
import { stat } from 'node:fs/promises'

export function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1))
  }
  return isAbsolute(p) ? p : resolve(process.cwd(), p)
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/\.\.+/g, '.')
    .trim()
  return cleaned || 'attachment'
}

export async function uniquePath(target: string, overwrite: boolean): Promise<string> {
  if (overwrite) return target
  try {
    await stat(target)
  } catch {
    return target
  }
  const dir = dirname(target)
  const ext = extname(target)
  const stem = basename(target, ext)
  for (let i = 1; i < 1000; i++) {
    const candidate = join(dir, `${stem} (${i})${ext}`)
    try { await stat(candidate) } catch { return candidate }
  }
  throw new Error(`Could not find a unique filename near ${target}`)
}

export async function resolveSavePath(savePath: string | undefined, attachmentName: string): Promise<string> {
  const safeName = sanitizeFilename(attachmentName)

  if (!savePath) {
    return join(homedir(), 'Downloads', safeName)
  }

  const expanded = expandPath(savePath)
  const endsWithSep = expanded.endsWith('/') || expanded.endsWith('\\') || expanded.endsWith(sep)

  let isDir = false
  try {
    const s = await stat(expanded)
    isDir = s.isDirectory()
  } catch {
    isDir = endsWithSep
  }

  return isDir ? join(expanded, safeName) : expanded
}

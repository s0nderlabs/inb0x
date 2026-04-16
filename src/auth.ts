import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { homedir, platform } from 'os'
import { google } from 'googleapis'

const SCOPES = ['https://mail.google.com/']
const REDIRECT_PORT = 18023
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`
const ENV_DIR = join(homedir(), '.config', 'inb0x')
const ENV_PATH = join(ENV_DIR, '.env')

const isMac = platform() === 'darwin'

// ── Credential Storage ────────────────────────────────────────────
// macOS: Keychain (secure, native)
// Linux/Windows: .env file at ~/.config/inb0x/.env

function credGet(key: string): string | null {
  // 1. Environment variable (highest priority — works for MCP env config)
  const envKey = `INB0X_${key.replace('dev.inb0x-', '').replace(/-/g, '_').toUpperCase()}`
  if (process.env[envKey]) return process.env[envKey]!

  // 2. macOS Keychain
  if (isMac) {
    try {
      return execSync(`security find-generic-password -s ${key} -w 2>/dev/null`, {
        encoding: 'utf8',
      }).trim()
    } catch {}
  }

  // 3. .env file fallback
  try {
    const env = readFileSync(ENV_PATH, 'utf8')
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^([^=]+)=(.*)$/)
      if (match && match[1] === envKey) return match[2]
    }
  } catch {}

  return null
}

function credSet(key: string, value: string): void {
  const envKey = `INB0X_${key.replace('dev.inb0x-', '').replace(/-/g, '_').toUpperCase()}`

  // macOS: store in Keychain
  if (isMac) {
    try {
      execSync(`security delete-generic-password -s ${key} 2>/dev/null`)
    } catch {}
    execSync(
      `security add-generic-password -a inb0x -s ${key} -w "${value.replace(/"/g, '\\"')}"`,
    )
    return
  }

  // Non-mac: store in .env file
  mkdirSync(ENV_DIR, { recursive: true })

  let lines: string[] = []
  try {
    lines = readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
  } catch {}

  // Update or append
  let found = false
  lines = lines.map(line => {
    if (line.startsWith(`${envKey}=`)) {
      found = true
      return `${envKey}=${value}`
    }
    return line
  })
  if (!found) lines.push(`${envKey}=${value}`)

  // Remove empty trailing lines
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  writeFileSync(ENV_PATH, lines.join('\n') + '\n')
  try { chmodSync(ENV_PATH, 0o600) } catch {}
}

// ── OAuth2 ────────────────────────────────────────────────────────

export async function getOAuth2Client() {
  const clientId = credGet('dev.inb0x-client-id')
  const clientSecret = credGet('dev.inb0x-client-secret')

  if (!clientId || !clientSecret) {
    const instructions = isMac
      ? 'Store them with:\n' +
        '  security add-generic-password -a inb0x -s dev.inb0x-client-id -w "YOUR_CLIENT_ID"\n' +
        '  security add-generic-password -a inb0x -s dev.inb0x-client-secret -w "YOUR_CLIENT_SECRET"'
      : 'Store them in ~/.config/inb0x/.env:\n' +
        '  INB0X_CLIENT_ID=YOUR_CLIENT_ID\n' +
        '  INB0X_CLIENT_SECRET=YOUR_CLIENT_SECRET\n' +
        'Or set them as environment variables in your .mcp.json env block.'

    throw new Error(`Missing OAuth credentials.\n${instructions}`)
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)

  // Check for existing refresh token
  const refreshToken = credGet('dev.inb0x-refresh-token')

  if (refreshToken) {
    oauth2.setCredentials({ refresh_token: refreshToken })
    try {
      await oauth2.getAccessToken()
      process.stderr.write('inb0x: authenticated (cached token)\n')
      return oauth2
    } catch (err) {
      process.stderr.write('inb0x: cached token invalid, re-authenticating...\n')
    }
  }

  // First-run: need to authorize
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })

  process.stderr.write('inb0x: opening browser for authorization...\n')
  process.stderr.write(`inb0x: if browser doesn't open, visit:\n${authUrl}\n`)

  // Open browser — platform-aware
  try {
    if (isMac) execSync(`open "${authUrl}"`)
    else if (platform() === 'linux') execSync(`xdg-open "${authUrl}"`)
    else if (platform() === 'win32') execSync(`start "${authUrl}"`)
  } catch {}

  const code = await waitForAuthCode()
  const { tokens } = await oauth2.getToken(code)

  if (tokens.refresh_token) {
    credSet('dev.inb0x-refresh-token', tokens.refresh_token)
    const store = isMac ? 'Keychain' : ENV_PATH
    process.stderr.write(`inb0x: refresh token stored in ${store}\n`)
  }

  oauth2.setCredentials(tokens)
  process.stderr.write('inb0x: authenticated successfully\n')

  return oauth2
}

function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.stop()
      reject(new Error('OAuth authorization timed out after 5 minutes'))
    }, 5 * 60 * 1000)

    const server = Bun.serve({
      port: REDIRECT_PORT,
      fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          if (error) {
            clearTimeout(timeout)
            server.stop()
            reject(new Error(`OAuth error: ${error}`))
            return new Response(
              '<html><body><h1>Authorization failed</h1><p>You can close this tab.</p></body></html>',
              { headers: { 'Content-Type': 'text/html' } },
            )
          }

          if (code) {
            clearTimeout(timeout)
            server.stop()
            resolve(code)
            return new Response(
              '<html><body><h1>Authorization successful</h1><p>You can close this tab and return to Claude Code.</p></body></html>',
              { headers: { 'Content-Type': 'text/html' } },
            )
          }
        }

        return new Response('Not found', { status: 404 })
      },
    })

    process.stderr.write(`inb0x: waiting for authorization on port ${REDIRECT_PORT}...\n`)
  })
}

export function getAccessToken(oauth2: InstanceType<typeof google.auth.OAuth2>): string | null {
  return oauth2.credentials?.access_token ?? null
}

export function getUserEmail(oauth2: InstanceType<typeof google.auth.OAuth2>): Promise<string> {
  const gmailClient = google.gmail({ version: 'v1', auth: oauth2 })
  return gmailClient.users.getProfile({ userId: 'me' }).then(r => r.data.emailAddress ?? 'unknown')
}

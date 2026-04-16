import { ImapFlow } from 'imapflow'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { notifyInbound } from './server.js'
import { loadConfig, shouldNotify } from './config.js'
import type { OAuth2Client } from 'google-auth-library'

let imapClient: ImapFlow | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let running = false

export function startImap(
  oauth2: OAuth2Client,
  userEmail: string,
  mcp: Server,
) {
  running = true
  connect(oauth2, userEmail, mcp)
}

export function stopImap() {
  running = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (imapClient) {
    try { imapClient.close() } catch {}
    imapClient = null
  }
}

async function connect(
  oauth2: OAuth2Client,
  userEmail: string,
  mcp: Server,
) {
  if (!running) return

  try {
    // Get fresh access token
    const { token } = await oauth2.getAccessToken()
    if (!token) {
      process.stderr.write('inb0x: imap: no access token available\n')
      scheduleReconnect(oauth2, userEmail, mcp)
      return
    }

    process.stderr.write(`inb0x: imap: connecting as ${userEmail}...\n`)

    imapClient = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: userEmail,
        accessToken: token,
      },
      logger: false,
    })

    imapClient.on('close', () => {
      process.stderr.write('inb0x: imap: connection closed\n')
      if (running) scheduleReconnect(oauth2, userEmail, mcp)
    })

    imapClient.on('error', (err: Error) => {
      process.stderr.write(`inb0x: imap: error: ${err.message}\n`)
    })

    await imapClient.connect()
    process.stderr.write('inb0x: imap: connected successfully\n')

    // Listen for new messages BEFORE opening mailbox
    imapClient.on('exists', async (data: { path: string; count: number; prevCount: number }) => {
      process.stderr.write(`inb0x: imap: exists event — count: ${data.count}, prev: ${data.prevCount}\n`)

      if (data.count <= data.prevCount) return

      try {
        // Fetch the newest messages using sequence numbers
        const range = `${data.prevCount + 1}:*`
        process.stderr.write(`inb0x: imap: fetching range ${range}\n`)

        for await (const msg of imapClient!.fetch(range, {
          envelope: true,
          flags: true,
        })) {
          const from = msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name || ''} <${msg.envelope.from[0].address || ''}>`
            : 'unknown'
          const subject = msg.envelope?.subject ?? '(no subject)'
          const fromAddr = msg.envelope?.from?.[0]?.address ?? ''

          process.stderr.write(`inb0x: imap: new email from ${fromAddr}: ${subject}\n`)

          const config = loadConfig()

          // For IMAP, we don't have Gmail category labels easily
          // Default to allowing all through and let the config filter by VIP/keywords
          // Pass empty labels so shouldNotify defaults to 'primary' (which is in the default config)
          if (!shouldNotify(config, fromAddr, [], subject)) {
            process.stderr.write(`inb0x: imap: filtered out by config\n`)
            continue
          }

          const msgUid = msg.uid?.toString() ?? msg.seq?.toString() ?? ''

          notifyInbound(mcp, from, subject, '', msgUid)
          process.stderr.write(`inb0x: imap: notification sent\n`)
        }
      } catch (err) {
        process.stderr.write(
          `inb0x: imap: fetch error: ${err instanceof Error ? err.message : err}\n`,
        )
      }
    })

    // Open INBOX — ImapFlow enters IDLE automatically when mailbox is open and idle
    const lock = await imapClient.getMailboxLock('INBOX')
    process.stderr.write('inb0x: imap: INBOX locked, IDLE active\n')

    // Keep alive — release lock only on disconnect
    await new Promise<void>((resolve) => {
      imapClient!.on('close', () => {
        lock.release()
        resolve()
      })
    })
  } catch (err) {
    process.stderr.write(
      `inb0x: imap: connect failed: ${err instanceof Error ? err.message : err}\n`,
    )
    if (running) scheduleReconnect(oauth2, userEmail, mcp)
  }
}

function scheduleReconnect(
  oauth2: OAuth2Client,
  userEmail: string,
  mcp: Server,
) {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    process.stderr.write('inb0x: imap: reconnecting...\n')
    connect(oauth2, userEmail, mcp)
  }, 10_000)
}

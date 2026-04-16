#!/usr/bin/env bun
import { getOAuth2Client, getUserEmail } from './auth.js'
import { initGmail } from './gmail.js'
import { connectMcp } from './server.js'
import { startImap, stopImap } from './imap.js'

process.on('unhandledRejection', (err) => {
  process.stderr.write(`inb0x: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', (err) => {
  process.stderr.write(`inb0x: uncaught exception: ${err}\n`)
})

// 1. Authenticate
const oauth2 = await getOAuth2Client()
const userEmail = await getUserEmail(oauth2)
process.stderr.write(`inb0x: logged in as ${userEmail}\n`)

// 2. Initialize Gmail API client
initGmail(oauth2)

// 3. Connect MCP server (stdio)
const mcp = await connectMcp(userEmail)
process.stderr.write('inb0x: mcp connected\n')

// 4. Start IMAP IDLE for real-time notifications
startImap(oauth2, userEmail, mcp)

// 5. Shutdown handling
process.stdin.resume()

let shuttingDown = false
function shutdown(reason: string) {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write(`inb0x: shutting down (${reason})\n`)
  setTimeout(() => process.exit(0), 3000)
  try { stopImap() } catch {}
  process.exit(0)
}

process.stdin.on('end', () => shutdown('stdin end'))
process.stdin.on('close', () => shutdown('stdin close'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Parent PID watchdog — safety net for orphan prevention
const parentPid = process.ppid
if (parentPid && parentPid > 1) {
  setInterval(() => {
    try { process.kill(parentPid, 0) }
    catch { shutdown('parent died') }
  }, 5000)
}

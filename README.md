# inb0x

Full-power Gmail plugin for Claude Code. Real-time email notifications via channels, batch operations, send/reply, smart cleanup. Replaces the limited official Gmail MCP.

## What It Does

- **Real-time push** — IMAP IDLE delivers new emails as channel notifications the moment they land
- **16 tools** — search, read, send, reply, forward, batch trash/archive/spam/label, unsubscribe, filters, cleanup, subscriptions, config
- **Batch-first** — every modification tool handles up to 1000 messages per call via Gmail's `batchModify`
- **Smart unsubscribe** — parses `List-Unsubscribe` headers, auto-executes one-click POST or mailto
- **Configurable notifications** — VIP list, keyword filters, category filters, quiet hours, digest mode

## Install

```bash
claude plugin install inb0x@s0nderlabs
```

Or from the s0nderlabs marketplace:

```bash
claude plugin marketplace add s0nderlabs/s0nderlabs-marketplace
claude plugin install inb0x@s0nderlabs
```

## Setup

### 1. Google Cloud OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use existing)
3. Enable the **Gmail API**
4. Go to **Google Auth Platform** → configure OAuth consent screen (External, add your email as test user)
5. Go to **Clients** → Create OAuth Client ID (type: **Desktop app**)
6. Copy the Client ID and Client Secret

### 2. Store Credentials

**macOS (Keychain):**

```bash
security add-generic-password -a inb0x -s dev.inb0x-client-id -w "YOUR_CLIENT_ID"
security add-generic-password -a inb0x -s dev.inb0x-client-secret -w "YOUR_CLIENT_SECRET"
```

**Linux/Windows (.env file):**

Create `~/.config/inb0x/.env`:

```
INB0X_CLIENT_ID=YOUR_CLIENT_ID
INB0X_CLIENT_SECRET=YOUR_CLIENT_SECRET
```

**Or via environment variables** in your `.mcp.json`:

```json
{
  "mcpServers": {
    "inb0x": {
      "env": {
        "INB0X_CLIENT_ID": "YOUR_CLIENT_ID",
        "INB0X_CLIENT_SECRET": "YOUR_CLIENT_SECRET"
      }
    }
  }
}
```

### 3. First Run

On first launch, inb0x opens your browser for Google OAuth authorization. Sign in, click "Allow", and the refresh token is stored automatically. Subsequent runs authenticate silently.

> **Note:** Google may show "This app isn't verified" — click **Advanced** → **Go to [app name] (unsafe)**. This is normal for testing-mode OAuth apps.

> **Upgrading from 0.1.0?** 0.1.1 adds the `gmail.settings.basic` scope required by `email__filters`. Google won't silently upgrade existing tokens, so delete the cached refresh token and re-authenticate:
>
> ```bash
> security delete-generic-password -s dev.inb0x-refresh-token   # macOS
> # or remove INB0X_REFRESH_TOKEN from ~/.config/inb0x/.env       (Linux/Windows)
> ```

## Tools

| Tool | Description |
|------|-------------|
| `email__search` | Search using Gmail query syntax, paginated |
| `email__read` | Read full thread or single message |
| `email__send` | Compose and send (to, cc, bcc, attachments) |
| `email__reply` | Reply in-thread with proper headers (attachments supported) |
| `email__forward` | Forward a message (attachments supported; original attachments NOT auto-included) |
| `email__trash` | Batch trash (up to 1000/call) |
| `email__archive` | Batch remove from inbox |
| `email__spam` | Batch mark as spam |
| `email__label` | Batch add/remove labels |
| `email__mark_read` | Batch mark as read |
| `email__unsubscribe` | Auto one-click POST, mailto, or return URL |
| `email__filters` | Create/list/delete Gmail filters |
| `email__stats` | Inbox count, total messages/threads |
| `email__cleanup` | Compound: search + batch action |
| `email__subscriptions` | Scan senders with unsub method info |
| `email__config` | View/update notification settings |
| `email__attachments` | List attachments on a message or whole thread |
| `email__download_attachment` | Save an attachment to disk (defaults to `~/Downloads`) |

## Channel Notifications

When loaded with `--channels`, inb0x uses IMAP IDLE to push real-time email notifications:

```
← inb0x · John Doe: Meeting tomorrow at 3pm
```

### Notification Filtering

Configure via the `email__config` tool or `~/.config/inb0x/config.json`:

```json
{
  "notifications": {
    "categories": ["primary"],
    "vip": ["boss@company.com"],
    "keywords": ["urgent", "payment"],
    "quiet_hours": { "start": "23:00", "end": "07:00" },
    "digest": false,
    "digest_interval_minutes": 15
  }
}
```

- **categories** — Gmail categories to notify for. Empty = VIP/keywords only
- **vip** — always notify, regardless of category or quiet hours
- **keywords** — notify if subject contains any keyword
- **quiet_hours** — suppress notifications during this window
- **digest** — batch notifications into periodic summaries

## Skills

| Skill | Description |
|-------|-------------|
| `/inb0x:inbox` | Quick inbox overview |
| `/inb0x:notify` | Configure notification settings |
| `/inb0x:cleanup` | Guided email cleanup wizard |

## vs Official Gmail MCP

| Feature | Official MCP | inb0x |
|---------|-------------|-------|
| Send email | Draft only | Full send |
| Batch operations | One at a time | 1000/call |
| Real-time push | No (polling) | IMAP IDLE |
| Unsubscribe | No | Auto one-click |
| Bulk cleanup | No | search + batch |
| Filters | No | Create/list/delete |
| Stats | No | Yes |

## Architecture

```
Claude Code Session (--channels plugin:email)
    |
    v
MCP Server (Bun + TypeScript)
    |
    |-- CHANNEL: IMAP IDLE → real-time notifications
    |   |-- XOAUTH2 (same OAuth token as API)
    |   |-- Configurable filters
    |   +-- Auto-reconnect
    |
    +-- TOOLS: Gmail API (OAuth2)
        |-- 16 tools covering full email management
        +-- Batch-first design
```

## Development

```bash
bun install
bun run src/index.ts
```

Load as dev channel:

```bash
claude --dangerously-load-development-channels server:inb0x
```

## License

Apache-2.0

## Author

Built by [elpabl0](https://github.com/alkautsarf) under [s0nderlabs](https://github.com/s0nderlabs).

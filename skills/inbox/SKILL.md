---
name: inbox
description: Quick inbox overview — message counts, unread, recent emails. Use when user asks about their inbox status, email count, or wants a summary.
user-invocable: true
allowed-tools:
  - mcp__inb0x__email__stats
  - mcp__inb0x__email__search
  - mcp__inb0x__email__config
---

# inb0x Stats

Show a quick inbox overview.

## Steps

1. Call `email__stats` to get total message/thread counts
2. Call `email__search` with `is:unread in:inbox` (max 5) to show recent unread
3. Call `email__config` with `action: "get"` to show notification settings
4. Present a clean summary:

```
inb0x — alkautsarsol22@gmail.com
────────────────────────────────
Messages:  7,371
Threads:   6,503

Recent unread (5):
  • Muhammad Alkautsar — Re: testing
  • ETHGlobal Team — Don't forget to finish applying...
  • Supabase — Security vulnerabilities detected
  ...

Notifications:
  Categories: primary
  VIP: alkautsarf22@gmail.com
  Keywords: urgent, payment, hackathon
  Quiet: 23:00 – 07:00
```

## Examples

```
/inb0x:stats     → full inbox overview
```

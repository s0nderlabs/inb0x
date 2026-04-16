---
name: cleanup
description: Guided email cleanup — scan subscriptions, identify junk senders, unsubscribe and bulk trash. Use when user asks to clean up email, unsubscribe from things, or declutter their inbox.
user-invocable: true
allowed-tools:
  - mcp__inb0x__email__subscriptions
  - mcp__inb0x__email__unsubscribe
  - mcp__inb0x__email__cleanup
  - mcp__inb0x__email__search
  - mcp__inb0x__email__stats
  - mcp__inb0x__email__trash
  - mcp__inb0x__email__filters
---

# inb0x Cleanup Wizard

Guided email cleanup flow. Parse `$ARGUMENTS` for options.

## Default flow (no arguments)

1. Call `email__stats` to show current inbox size
2. Call `email__subscriptions` with `max_scan: 500` to find subscription senders
3. Present the results grouped by recommendation:
   - **Unsubscribe + Trash** — high-volume senders the user likely doesn't read (marketing, newsletters, promos)
   - **Keep** — transactional emails, account notifications, things that look important
   - **Ask user** — anything ambiguous

4. Wait for the user to confirm which senders to nuke
5. For each confirmed sender:
   - Call `email__unsubscribe` with a sample message ID
   - Call `email__cleanup` to trash all emails from that sender
6. Optionally create Gmail filters to auto-trash future emails from those senders
7. Show before/after stats

## IMPORTANT

- **Never auto-trash without user confirmation.** Always present the list and wait.
- **Never touch hackathon, payment, KYC, or account security emails.** When in doubt, put it in the "Ask user" category.
- **Check email content before recommending** — a sender named "noreply@company.com" could be receipts or spam. Look at subject lines.
- Use `email__search` to investigate any sender before recommending action.

## With arguments

### `scan [count]`
Just scan and report subscriptions without taking action. Default scan: 200 messages.

### `from:<sender>`
Clean up all emails from a specific sender: unsubscribe + trash.

### `promotions [days]`
Trash all promotions older than N days (default: 30).

## Examples

```
/inb0x:cleanup                    → full guided cleanup
/inb0x:cleanup scan 500           → scan 500 emails for subscriptions
/inb0x:cleanup from:spam@co.com   → nuke specific sender
/inb0x:cleanup promotions 7       → trash promotions older than 7 days
```

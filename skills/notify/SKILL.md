---
name: notify
description: View or update inb0x email notification settings — VIP list, keyword filters, categories, quiet hours, digest mode. Use when user asks to configure notifications, filter emails, set VIP senders, or manage quiet hours.
user-invocable: true
allowed-tools:
  - mcp__inb0x__email__config
---

# inb0x Notification Config

View or update email notification settings. Parse `$ARGUMENTS` to determine the action.

## Commands

### No arguments / `show`
Call `email__config` with `action: "get"` and display the current settings in a readable format:

```
inb0x Notification Settings
───────────────────────────
Categories:  primary
VIP:         alkautsarf22@gmail.com, boss@company.com
Keywords:    urgent, payment, hackathon
Quiet hours: 23:00 – 07:00
Digest:      off
```

### `vip add <email>`
Get current config, append the email to the VIP list, save.

### `vip remove <email>`
Get current config, remove the email from the VIP list, save.

### `vip only`
Set categories to `[]` so only VIP senders and keyword matches trigger notifications.

### `keyword add <word>`
Get current config, append the keyword, save.

### `keyword remove <word>`
Get current config, remove the keyword, save.

### `quiet <start> <end>`
Set quiet hours. Example: `/inb0x:notify quiet 22:00 07:00`

### `quiet off`
Disable quiet hours.

### `categories <list>`
Set notification categories. Example: `/inb0x:notify categories primary,updates`

### `digest on [interval]`
Enable digest mode with optional interval in minutes.

### `digest off`
Disable digest mode.

### `reset`
Reset to defaults: categories=["primary"], empty VIP/keywords, no quiet hours, no digest.

## Examples

```
/inb0x:notify                              → show current settings
/inb0x:notify vip add boss@company.com     → add VIP sender
/inb0x:notify vip remove spam@example.com  → remove VIP sender
/inb0x:notify vip only                     → VIP-only mode
/inb0x:notify keyword add invoice          → add keyword filter
/inb0x:notify quiet 23:00 07:00            → set quiet hours
/inb0x:notify quiet off                    → disable quiet hours
/inb0x:notify categories primary,updates   → set categories
/inb0x:notify digest on 15                 → enable 15-min digest
/inb0x:notify reset                        → reset to defaults
```

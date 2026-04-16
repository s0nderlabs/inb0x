# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-04-16

### Added

- MCP server with 16 Gmail tools (search, read, send, reply, forward, trash, archive, spam, label, mark_read, unsubscribe, filters, stats, cleanup, subscriptions, config)
- IMAP IDLE for real-time email notifications via Claude Code channels
- Configurable notification filtering (VIP list, keyword filters, categories, quiet hours, digest mode)
- OAuth2 authentication with macOS Keychain storage and .env file fallback for Linux/Windows
- First-run browser-based OAuth flow with local callback server
- Batch-first design — all modification tools accept arrays, up to 1000 messages per call
- Smart unsubscribe — auto one-click POST (RFC 8058), mailto fallback, URL return
- Compound cleanup tool — search + batch action in one call
- Subscription scanner — groups by sender with unsubscribe method info
- Skills: `/inb0x:inbox`, `/inb0x:notify`, `/inb0x:cleanup`
- Plugin manifest for Claude Code marketplace distribution

[0.1.0]: https://github.com/s0nderlabs/inb0x/releases/tag/v0.1.0

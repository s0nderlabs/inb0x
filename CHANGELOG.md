# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-05-15

### Added

- `email__send`, `email__reply`, and `email__forward` now accept an `attachments` array. Each entry takes either `path` (file on disk, supports `~/...`, absolute, or relative) or `data` (inline base64 with required `filename`). Optional `filename` overrides the path basename; optional `mime_type` overrides the extension-based lookup.
- New module `src/mime.ts` builds RFC-compliant MIME messages: multipart/mixed for messages with attachments, single-part text/plain otherwise. Handles RFC 2047 base64-encoded-words for non-ASCII subjects, RFC 2231 `filename*=UTF-8''...` for non-ASCII attachment filenames, and 76-char base64 line wrapping for binary payloads.
- Built-in MIME-type lookup for ~30 common extensions (pdf, xlsx, docx, csv, png/jpg/svg, mp3/mp4, zip, etc.). Unknown extensions fall back to `application/octet-stream`.
- `email__forward` documentation now notes that original attachments are NOT auto-included — pass them explicitly via the new `attachments` field (use `email__download_attachment` first if you want to re-send a downloaded file).

## [0.2.0] - 2026-05-15

### Added

- `email__attachments` tool — lists every attachment on a message, or across an entire thread. Returns filename, mime type, size, attachment ID, and an `inline` flag for embedded images. Optional `include_inline` opts in to listing cid-referenced images.
- `email__download_attachment` tool — fetches an attachment via the Gmail attachments API and writes it to disk. Identify the attachment by `attachment_id` (preferred), `filename`, or zero-based `index`. The `save_path` argument accepts an absolute path, a directory (the original filename is appended), or `~/...`. Defaults to `~/Downloads/<filename>`. Collisions are resolved with a numeric suffix unless `overwrite: true`.
- `formatMessage` now appends an "Attachments (n):" manifest with attachment IDs, so `email__read` exposes downloadable handles inline.

## [0.1.1] - 2026-04-17

### Fixed

- Gmail filter creation failed with "Insufficient Permission" because the OAuth client only requested the legacy `https://mail.google.com/` scope. Google now enforces per-endpoint scope checks and `users.settings.filters` requires `https://www.googleapis.com/auth/gmail.settings.basic` explicitly. Added the settings scope alongside the legacy scope. Existing users must delete their cached refresh token (`security delete-generic-password -s dev.inb0x-refresh-token` on macOS) and re-authenticate to pick up the new scope — Google will not silently upgrade existing tokens.

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

[0.3.0]: https://github.com/s0nderlabs/inb0x/releases/tag/v0.3.0
[0.2.0]: https://github.com/s0nderlabs/inb0x/releases/tag/v0.2.0
[0.1.1]: https://github.com/s0nderlabs/inb0x/releases/tag/v0.1.1
[0.1.0]: https://github.com/s0nderlabs/inb0x/releases/tag/v0.1.0

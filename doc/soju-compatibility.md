# Gamja compatibility with soju-rs

## Versions checked

- Gamja commit `37c6ee94bf217fbf6ecf18a1e277fed8cef61c6d` (replacement v0.99.62).
- [soju-rs v0.99.24](https://github.com/pbtrung/soju-rs/releases/tag/v0.99.24),
  commit `6b9bf15898da370b7a00e14025a72829de342f71`, also the current `main`
  during this check.
- Native x86-64 musl release archive verified against GitHub's SHA-256 digest:
  `03bacc0e98328b31d0eb02059da1929a37934708528c160f8c7bb0ef7d2b7d6d`.

## Native interoperability results

All seven scenarios passed using the actual soju-rs binary, a fresh temporary
SQLite database, Chromium, and a simulated IRC upstream reached through a
loopback TCP/WebSocket bridge. Each browser context had independent storage.
Only temporary test listeners and accounts were used; no Docker was used.

| Scenario                                                                              | Result                                                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Browser WebSocket connection and SASL PLAIN login                                     | Passed                                                          |
| Create two bouncer networks and attach both through one physical WebSocket            | Passed; two `BOUNCER ATTACH` commands and one browser WebSocket |
| Join a channel, receive and send messages, display echoes and the channel placeholder | Passed                                                          |
| Pin, mute, and unmute using target metadata                                           | Passed                                                          |
| Search real SQLite message history from Gamja                                         | Passed                                                          |
| Open an independent browser context and reload history and pinned metadata            | Passed                                                          |
| Deliver unread messages and synchronize `MARKREAD` across two clients                 | Passed                                                          |

Temporary harnesses, logs, databases, and downloaded binaries were removed
after the checks at the user's request. The results summarized here are retained;
raw session artifacts are no longer available.

## Source review

The server's capability advertisement, welcome burst, network tagging, metadata,
search criteria, read markers, multiline capabilities, SASL exchange, Web Push
registration, and WebSocket framing were compared with Gamja's implementation.
No additional core incompatibility was identified in this check. The prior
[unread and multiplex audit](soju-protocol-audit.md) documents five issues
already fixed in the checked Gamja version.

Gamja requests capabilities the server advertises and enables optional features
accordingly. soju-rs can remove upstream-dependent capabilities with `CAP DEL`
or introduce them with `CAP NEW`; Gamja updates its capability state for both.
The client also falls back to target-by-target search when soju-rs requires an
`in` parameter for searches across open conversations.

## Limits

This confirms the tested client/bouncer combinations, not every deployment:

- The upstream IRC server was simulated, rather than Ergo or a public network.
- The native run used local plain WebSockets. Production TLS certificates,
  reverse proxies, browser origin restrictions, and mutual TLS were not tested.
- SASL EXTERNAL and OAUTHBEARER were reviewed in source, but the native run used
  PLAIN authentication only.
- Real Web Push delivery, upstream-specific multiline/redaction behavior, and
  Turso-backed storage were not exercised in the native scenarios.
- All-conversation search covers conversations known to Gamja when using the
  fallback required by soju-rs's mandatory search target.

## IRCv3 compatibility checks

The soju-rs repository's `tests/compat/ircv3spec.py` was run separately against the
native soju-rs binary over loopback TCP, using the same simulated upstream.
It checks CAP 302, SASL 3.2 chunking and aborts, labeled responses, batches,
server-time, extended-join, echo and client tags, read markers, history,
metadata, and bouncer-network commands.

The unmodified script reported 28/32 because its initial `CAP LS 302` read
consumes only one reply line. soju-rs correctly splits its capability list,
leaving the second `LS` line to be mistaken for the next command's response;
four subsequent assertions are therefore misaligned. The
[IRCv3 CAP specification](https://ircv3.net/specs/extensions/capability-negotiation.html#multiline-replies-to-cap-ls-and-cap-list)
allows these replies and requires CAP 302 clients to handle their continuation.
Gamja already handles this and has a regression test for it.

A temporary copy of the script was corrected to consume all `LS` lines until
the continuation asterisk is absent. All **32/32 checks passed** with that
harness correction. The original upstream script and product code were not
changed. The temporary corrected script and raw results were removed during
cleanup.

Gamja's related IRC parser, client, multiplex, audit-regression and controller
tests were also run: **263/263 passed**. These tests plus the native bouncer
checks are targeted compatibility coverage, not certification of every IRCv3
extension. No Docker was used.

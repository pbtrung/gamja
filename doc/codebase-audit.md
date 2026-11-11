# Codebase audit — 2026-11-11

The audit combined source review with reproductions of failure paths, followed
by dependency, unit/component, coverage, production-build and browser checks.
The starting point was `9e72da2`, with 687 passing tests. The final suite has
725 passing tests, including 38 new regression and recovery cases.

## Scope and approach

Review focused on persisted data and cross-tab state, incoming/outgoing IRC
messages, registration and keepalive, request correlation, history pagination
and reconnect backlogs, read markers, message submission, OAuth, and message
rendering. The existing protocol/property tests, history tests, service-worker
and push tests, state reducers, forms, accessibility tests, and desktop/mobile
flows were also exercised through the full suites.

New cases assert observable outcomes: a reply survives a failed send, a closed
conversation stays closed after a late response, queued searches recover after
errors/timeouts and stop at connection boundaries, and rerendered controls call
the latest handler. They do not assert the extracted files' internal structure.

## Findings and fixes

| Area                      | Before                                                                                         | Resolution                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| JSON persistence          | `false`, `0` and empty strings removed their storage entry                                     | Only null/undefined remove an entry                                                                   |
| Buffer schema             | Malformed receipts and server references reached unread tracking                               | Validate receipt timestamps, known receipt keys and server reference types when loading               |
| UI preferences            | Corrupt collapsed-network lists could crash startup; recent-reaction lists were also unchecked | Validate persisted string arrays before use                                                           |
| Storage failures          | Failed writes cleared the dirty set, losing the retry state                                    | Report write success and keep pending changes on failure                                              |
| Cross-tab storage         | `localStorage.clear()` events left cached buffers stale                                        | Handle null storage-event keys and ignore other storage areas                                         |
| IRC serialization         | Invalid command tokens and prefix line breaks could alter wire structure                       | Reject malformed commands and unsafe prefixes before sending                                          |
| IRC parsing               | Lowercase command names bypassed command handlers                                              | Normalize incoming command names to uppercase                                                         |
| IRC tags                  | Prototype-named tags were lost; formatting enumerated inherited properties                     | Parse into a null-prototype dictionary and serialize own entries                                      |
| Keepalive                 | Valid single-parameter PONG replies were ignored                                               | Match the last parameter for explicit and lag-check pings                                             |
| Read markers              | Invalid timestamps could become persisted read/delivery receipts                               | Drop invalid or missing read-marker bounds and targets                                                |
| Message submission        | A synchronous send failure cleared the reply and escaped submission handling                   | Report failure, return false, and retain the reply until the send succeeds                            |
| Late backlog responses    | A closed private conversation could reopen when its request completed                          | Check the original buffer's existence before applying results                                         |
| Deferred backlog recovery | Failed requests lost their lower bound and retry state                                         | Restore the deferred request after failure                                                            |
| Concurrent searches       | Unlabeled result batches could satisfy multiple searches                                       | Serialize searches, continue after failures/timeouts, and reject queued work after socket replacement |
| OAuth discovery           | Metadata for a different issuer was accepted                                                   | Require the returned issuer to equal the configured issuer                                            |
| OAuth schemas             | A string response-type list or a truthy non-boolean token activity flag could be accepted      | Require an array of supported response types and `active === true`                                    |
| Memoized rows             | Changed action/nick callbacks could remain stale                                               | Include callback identities and server identity/case mapping in row comparisons                       |
| Browser assertions        | Two selectors expected the old unread-banner wording                                           | Match the documented `N new since …` wording while retaining timer/scroll assertions                  |

OAuth checks follow [RFC 8414 §3.3](https://www.rfc-editor.org/rfc/rfc8414.html#section-3.3)
and [RFC 7662 §2.2](https://www.rfc-editor.org/rfc/rfc7662.html#section-2.2).
The configured issuer must now match exactly, including trailing slashes; see
[configuration](config-file.md).

Regression coverage is in `test/audit-edge-cases.test.ts`,
`test/lib/search-queue.test.ts`, `test/lib/oauth2.test.ts` and
`test/components/MessageList.test.tsx`. The new failing scenarios were run
against the previous behavior before their fixes were applied. Recovery and
success cases supplement those reproductions.

## Module boundaries

Existing public imports and controller method signatures remain available.
Implementations were split by responsibility:

- `store/`: JSON items, schema validation/merging, and buffer persistence.
- `app/backlog/`: bounds/pagination, unread snapshots, and gap recovery.
- `app/messaging/`: transmission and composer commands/completion.
- `components/buffers/BufferItem.tsx`: a row, independently of list filtering.
- `components/messages/ReplyQuote.tsx` and `Sender.tsx`: reply navigation and
  sender decorations, independently of row layouts.
- `lib/client/lifecycle.ts`: opening, reconnecting and resetting connections.
- `lib/irc/tags.ts`: tag parsing and escaping, independently of message framing.

| Entry module                | Lines before audit | Lines after split |
| --------------------------- | -----------------: | ----------------: |
| `app/backlog.ts`            |                459 |               209 |
| `app/messaging.ts`          |                366 |               165 |
| `store.ts`                  |                382 |                46 |
| `components/BufferList.tsx` |                337 |               137 |
| `lib/client/connection.ts`  |                396 |               342 |

The line counts describe entry modules, not a reduction in total functionality
or total source size. Files with cohesive responsibilities were retained.

## Dependencies and verification

All compatible direct packages were checked against npm's latest stable tag.
Updates include jsdom 31, Playwright 1.65, Vite 8.3.8, its React plugin 6.3,
Zustand 5.1, Lucide 1.72, Prettier 3.10, typescript-eslint 8.72.2, ws 8.22.2,
and testing-library/user-event 14.6.9.

TypeScript 7.0.2 already runs typechecking via the `typescript7` alias.
The `typescript` package remains at 6.0.3 because the latest typescript-eslint
requires `>=4.8.4 <6.1.0` and uses its compiler API. An attempted direct 7.x
upgrade was rejected by npm's peer dependency resolver. Forced peer resolution
was not used. A minimatch 11.0.8 override removes the inherited lint-tooling
advisory; the full lint check verifies its use with this configuration.

Final checks:

- `npm run check`: TypeScript 7, ESLint with zero warnings, Prettier, and
  725 tests across 45 test files pass.
- `npm run build`: the production application and service worker bundle.
- `npm run coverage`: 89.96% statements, 83.35% branches, 90.12% functions,
  and 90.01% lines. Global floors increased to 89/82/89/89 respectively.
- `npm run e2e -- --workers=4`: 64 desktop/mobile browser tests pass;
  10 opt-in screenshot-generation tests remain skipped by their configuration.
- `npm audit`: zero reported vulnerabilities after the minimatch override.
- `npm outdated`: only the documented TypeScript 6 compiler-API compatibility
  dependency remains behind its latest tag.

## Limits

This is not a proof that every defect has been eliminated. Browser checks use
Chromium and the repository's fake IRC server; real bouncers, production OAuth
providers, platform push services and other browser engines were not exercised
against live accounts. Coverage excludes `src/main.tsx` under the existing
configuration. The optional screenshot generators do not provide a visual
snapshot regression gate. Registry/advisory results reflect the audit date.

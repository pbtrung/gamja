# [gamja]

A modern IRC web client, built with React, TypeScript and Vite. Works best
with the [soju] IRC bouncer. Fork of [upstream gamja].

## Usage

Requires an IRC WebSocket server, and Node.js 22.22, 24.15 or 26+ to build.

Build gamja with [Vite]:

    npm install
    npm run build

Then [configure an HTTP server] to serve the files in `dist/`. The version
shown in Settings → About is the latest git tag; set `GAMJA_VERSION` to override it
when building outside a git checkout.

To make a release, run `tools/release.sh vX.Y.Z [notes.md]` from a clean
tree. It tags HEAD before building, so that About shows the new
tag, checks `version.json` and zips `dist/` as `gamja-vX.Y.Z.zip`. With a release
notes file, it also pushes the tag to the `github` remote and publishes the
release on GitHub with `gh`. If it fails before pushing, the tag it created
is deleted again.

### Development server

    npm run dev

If you don't have an IRC WebSocket server at hand, the development server can
proxy `/socket` to an IRC server over TLS (`host` or `host:port`, port 6697 by
default; `npm run dev` only). For instance, to run gamja on Libera Chat:

    GAMJA_IRC_SERVER=irc.libera.chat npm run dev

To try gamja without an IRC server, run the fake IRC server used by the
end-to-end tests and point gamja at it:

    node e2e/fake-ircd.ts 8081

and, with `npm run dev` running, open
<http://localhost:8080/?server=ws://localhost:8081>. Log in as `alice` with
password `secret` to try SASL, and set `FAKE_BOUNCER=1` to emulate a soju
bouncer (which requires logging in).

### With soju

On top of chat history and read markers, gamja supports soju's bouncer
networks, search, Web Push notifications, detaching channels
(`/detach`, joining reattaches) and pinning, muting and blocking (`/pin`,
`/mute`, `/block` or the buffer header buttons), synced across clients.
While the page stays hidden for a while (a minute by default, see the
settings), gamja tells soju it's away (`draft/pre-away`), so soju can mark
you away once all your clients are.

When reconnecting, gamja only loads the missed messages of the open buffer
(the latest 200 by default, see the settings); other buffers load theirs once
opened. It still shows which buffers have unread messages and mentions: with
soju-rs, the bouncer tells it (`soju.im/unread`), even for conversations
read on another device. With other servers, buffers with messages after
their read marker are unread, and private ones count as mentions; a mention
in a channel then only shows once opened. If more were missed, a "Load missed messages"
button where they're missing loads the others. The server's CHATHISTORY limit (e.g. soju-rs's
`chathistory-limit`) only changes how many requests that takes.

Opening a buffer and scrolling back load the configured number of messages
(200 by default), paginating within the server's limit. The new-message pill
shows e.g. `200+ new since 10:30`: `+` means older unread messages may remain.
Its initial count stays steady while older pages load; the divider shows
`400 loaded · more available · since 10:30`, and switches to an exact count once
the opening read boundary or the end of stored history is reached. These
counts stay relative to the read marker captured when the conversation was
opened. Live read markers continue to advance while reading at the bottom,
and hold while scrolled up; they don't reset the opening counts. The pill appears only when
opening a buffer and hides after eight seconds, or when clicked or dismissed.
The divider hides after eight continuous seconds fully in view. Scrolling it
off screen or clipping it restarts that reading time when it comes fully back
into view, as does returning from a hidden browser tab. Loading another history
page gives the updated progress a fresh eight seconds. The pill's timer pauses
while the browser page is hidden.
On mobile, the divider uses `200 loaded · more` with `since 10:30` on a
smaller second line; the full wording stays on one line on desktop.
When the opening read marker is more than 24 hours old, both indicators add
the date in DD/MM/YY format, e.g. `08/11/26 10:30`. The mobile pill stays on
one line with a compact label such as `200+ new · 08/11/26 10:30`.
History loading stops at 2,000 buffered messages, or one configured page if
that is larger, and shows when that limit or the end of history is reached.

### Settings

Settings, opened from the header of any buffer, are stored per browser:

- **Appearance**: theme, message layout (comfortable, compact, columns or
  bubbles), timestamps, day separators, wrapped line indent (compact layout),
  an input that touches the chat pane's edges (on by
  default), nick colors, channel modes before nicks, and for the
  columns layout the nick alignment, column width, repeated nicks and
  brackets.
- **Messages**: buffer text size (10–20 px, default 15 px), seconds in the
  time indicator, 12-hour clock, member list,
  chat events (joins, parts, quits and nick changes), missed messages to load
  per buffer (100–4000, default 200), and typing notifications
  (showing who is typing, sharing when you are).
- **Notifications**: desktop notifications, away in the background (never, 1,
  5 or 15 minutes) and, with soju, Web Push notifications.
- **About**: Gamja version and the installed versions of runtime dependencies
  and Vite.

### Checks

    npm run typecheck   # TypeScript
    npm run lint        # ESLint
    npm run format      # Prettier (format:check only checks)
    npm test            # Vitest unit and component tests
    npm run coverage    # Vitest with coverage report
    npm run check       # typecheck, lint, format:check and test
    npm run e2e         # Playwright end-to-end tests against a fake IRC server

`typecheck` uses TypeScript 7, while ESLint's type-aware rules (on `src/`:
floating and misused promises, awaiting non-promises) still run on
TypeScript 6 until typescript-eslint supports 7. The `minimatch` override
keeps lint tooling on the patched 11.x release until its dependencies
update their supported range.

The end-to-end tests use the system Chromium (`/usr/bin/chromium`,
`chromium-browser` or `google-chrome`) when present, otherwise Playwright's
Chromium (override with `CHROMIUM_PATH`).

## Configuration

gamja can be configured via a [configuration file] and via [URL parameters].

## License

AGPLv3, see LICENSE.

Copyright (C) 2020 The gamja Contributors

[gamja]: https://github.com/pbtrung/gamja
[upstream gamja]: https://codeberg.org/emersion/gamja
[soju]: https://soju.im
[Vite]: https://vite.dev
[configure an HTTP server]: doc/setup.md
[configuration file]: doc/config-file.md
[URL parameters]: doc/url-params.md

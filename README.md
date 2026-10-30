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

When reconnecting, gamja loads the latest missed messages of the open buffer
and of private conversations (200 by default, see the settings). Other
channels with missed messages are marked unread, and load theirs once
opened: a connect doesn't query the server's history of every busy channel.
Mentions in them only show once opened; the "load missed channel messages
when opened" setting loads them all on reconnect instead. If more were missed, a "Load missed messages"
button where they're missing loads the others, and the read marker doesn't
move past them until then. The server's CHATHISTORY limit (e.g. soju-rs's
`chathistory-limit`) only changes how many requests that takes.

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
  per buffer on connect (100–4000, default 200), loading those of other
  channels when opened (default), and typing notifications
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
TypeScript 6 until typescript-eslint supports 7.

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

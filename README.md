# [gamja]

A modern IRC web client, built with React, TypeScript and Vite. Works best
with the [soju] IRC bouncer.

## Usage

Requires an IRC WebSocket server.

Build gamja with [Vite]:

    npm install
    npm run build

Then [configure an HTTP server] to serve the files in `dist/`.

### Development server

    npm run dev

If you don't have an IRC WebSocket server at hand, the development server can
proxy `/socket` to an IRC server over TLS. For instance, to run gamja on Libera
Chat:

    GAMJA_IRC_SERVER=irc.libera.chat npm run dev

To try gamja without an IRC server, run the fake IRC server used by the
end-to-end tests and point gamja at it:

    node e2e/fake-ircd.ts 8081
    open http://localhost:8080/?server=ws://localhost:8081

### Checks

    npm run typecheck   # TypeScript
    npm run lint        # ESLint
    npm run format      # Prettier
    npm test            # Vitest unit and component tests
    npm run coverage    # Vitest with coverage report
    npm run check       # all of the above
    npm run e2e         # Playwright end-to-end tests against a fake IRC server

The end-to-end tests use Playwright's Chromium, or the system Chromium if it
isn't installed (override with `CHROMIUM_PATH`).

## Configuration

gamja can be configured via a [configuration file] and via [URL parameters].

## License

AGPLv3, see LICENSE.

Copyright (C) 2020 The gamja Contributors

[gamja]: https://codeberg.org/emersion/gamja
[soju]: https://soju.im
[Vite]: https://vite.dev
[configure an HTTP server]: doc/setup.md
[configuration file]: doc/config-file.md
[URL parameters]: doc/url-params.md

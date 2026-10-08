# [gamja]

A simple IRC web client.

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

### Checks

    npm run typecheck   # TypeScript
    npm run lint        # ESLint
    npm run format      # Prettier
    npm test            # Vitest
    npm run check       # all of the above

## Configuration

gamja can be configured via a [configuration file] and via [URL parameters].

## License

AGPLv3, see LICENSE.

Copyright (C) 2020 The gamja Contributors

[gamja]: https://codeberg.org/emersion/gamja
[Vite]: https://vite.dev
[configure an HTTP server]: doc/setup.md
[configuration file]: doc/config-file.md
[URL parameters]: doc/url-params.md

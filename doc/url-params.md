# URL parameters

gamja settings can be overridden using URL query parameters:

- `server`: path or URL to the WebSocket server. Ignored if `server.url` is set
  in the [configuration file], unless empty (which reveals the server field in
  the connect form). Using it disables the `server.auth` setting.
- `nick`: nickname to use by default when connecting to the server. If the
  character `*` appears in the string, it will be replaced with a randomly
  generated value.
- `channels`: comma-separated list of channels to join (`#` needs to be escaped)
- `open`: [IRC URL] to open. Supports both channels (e.g. `ircs://irc.libera.chat/#soju`)
  and users (e.g. `ircs://irc.libera.chat/emersion`). If the server is not a
  bouncer, the hostname can be left empty (e.g. `ircs:///emersion`). The full
  URL needs to be escaped.
- `debug`: enable debug logs if set to `1`, disable debug logs if set to `0`
  (enabled by default in development builds)

Alternatively, a buffer can be opened with the URL fragment: `#/<channel or
nick>` (e.g. `#/#gamja`), or `#//<host>/<channel or nick>` for a network of a
bouncer.

[IRC URL]: https://datatracker.ietf.org/doc/html/draft-butcher-irc-url-04
[configuration file]: config-file.md

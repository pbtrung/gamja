# URL parameters

gamja settings can be overridden using URL query parameters:

- `server`: path or URL to the WebSocket server
- `nick`: nickname to use by default when connecting to the server. If the
  character `*` appears in the string, it will be replaced with a randomly
  generated value.
- `channels`: comma-separated list of channels to join (`#` needs to be escaped)
- `open`: [IRC URL] to open. Supports both channels (e.g. `ircs://irc.libera.chat/#soju`)
  and users (e.g. `ircs://irc.libera.chat/emersion`). If the server is not a
  bouncer, the hostname can be left empty (e.g. `ircs:///emersion`). The full
  URL needs to be escaped.
- `debug`: enable debug logs if set to `1`, disable debug logs if set to `0`

Alternatively, the channels can be set with the URL fragment (ie, by just
appending the channel name to the gamja URL).

[IRC URL]: https://datatracker.ietf.org/doc/html/draft-butcher-irc-url-04

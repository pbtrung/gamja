# soju-rs protocol audit

Reviewed against soju-rs commit `6b9bf15898da370b7a00e14025a72829de342f71`:

- [soju.im/unread](https://github.com/pbtrung/soju-rs/blob/6b9bf15898da370b7a00e14025a72829de342f71/doc/unread.md)
- [soju.im/multiplex](https://github.com/pbtrung/soju-rs/blob/6b9bf15898da370b7a00e14025a72829de342f71/doc/multiplex.md)

## Confirmed gaps and fixes

1. Unread snapshots previously only raised cached unread state. A read snapshot
   now clears stale unread badges while retaining messages newer than the snapshot
   and respecting newer read markers.
2. A partial `MARKREAD` previously cleared unread state when messages had not
   been loaded. The latest snapshot remains in effect until its latest message
   is covered by the marker. Loaded messages after the marker are considered too.
3. Private notices and non-`ACTION` CTCPs in existing conversations previously
   became mentions. They now produce ordinary unread state; private messages and
   `ACTION`s still produce mentions. Existing muted and blocked-user handling is
   retained.
4. The documented `INVALID_CONNECTION` attach error has no network ID and was
   ignored. Transport-level attach rejections now report the error and fall back
   to ordinary per-network connections instead of waiting for repeated timeouts.
5. Periodic lag probes and browser-focus probes previously pinged every virtual
   network. Virtual networks now share the parent connection's keepalive and lag
   measurement.

## Other behavior reviewed

- Capability negotiation, all-time `CHATHISTORY TARGETS`, valueless unread and
  mention tags, private notice-only targets, and deferred history loading.
- Tagged virtual traffic without `message-tags`, routing before batch and
  multiline assembly, and separate per-network capability, batch, label,
  ISUPPORT, case-mapping, and nickname state.
- No registration or SASL exchange on attach; inherited capabilities exclude
  `soju.im/multiplex` and `soju.im/bouncer-networks-notify`.
- Attach/detach, tagged `ERROR`, parent connection loss, reconnection, and
  fallback when multiplex support disappears.

## Validation and limits

The regressions in `test/protocol-audit.test.ts` exercise snapshot replacement,
partial and newer read markers, concurrent live messages, private notice/CTCP
classification, unscoped attach failures, one transport keepalive, shared lag,
and identical batch IDs on different networks. Existing client/controller tests
cover registration, inherited capabilities, tagged errors, detach, reconnect,
and fallback.

The unread extension provides a mention flag rather than the timestamp of the
last mention. For unloaded history, a partial read marker conservatively retains
the snapshot's unread level until its latest message is read or a newer snapshot
replaces it.

This is a source and mock-protocol audit, not a live soju-rs interoperability
certification. No Docker tests were used.

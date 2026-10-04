# Overview

*[Читать на русском](ru/01-overview.md)*

## Why this exists

OpenFlux is a TCP tunnel with pluggable transports — each transport carries
the tunnel's traffic over a different real-world protocol (a collaborative
doc editor's cursor sync, a whiteboard app, a voice call's signaling
channel, ...), so the tunnel isn't tied to any single wire format. Every
transport used to be Go code compiled into the core. Adding one meant a core
rebuild, and on Android, a new APK.

That's the whole motivation: **ship new transports as data, not as a
recompile.** A transport is now a signed `.js` file (or a signed `.flux`
package — see [04-signing-and-packaging.md](04-signing-and-packaging.md)),
dropped into a directory the exit/node reads at startup. No core changes,
no app update.

## The pieces

```
                     ┌─────────────────────────────────┐
                     │         your transport.js         │
                     │  (auth, framing, reconnect logic) │
                     └───────────────┬───────────────────┘
                                     │ runs inside
                     ┌───────────────▼───────────────────┐
                     │      one goja Runtime per          │
                     │      transport instance            │
                     │  (pure Go interpreter, no cgo)     │
                     └───────────────┬───────────────────┘
                                     │ calls into
                     ┌───────────────▼───────────────────┐
                     │         host API (Go)              │
                     │  http / httpserver / ws / udp /    │
                     │  webrtc / cookies / codecs / crypto │
                     │  / concurrency                     │
                     └───────────────┬───────────────────┘
                                     │ real I/O
                              the actual network
```

- **One goja Runtime per transport instance.** goja is single-threaded and
  not goroutine-safe. All real I/O (HTTP, WebSocket, UDP, WebRTC) happens on
  Go goroutines; results get marshaled back onto the transport's own event
  loop before your JS ever sees them. You never have to think about this —
  it's just why every async host call returns a Promise instead of
  blocking.
- **The host API is deliberately unrestricted.** No allowlist of hosts, no
  capability flags, no "this transport can't open raw sockets." Dial
  anywhere, fetch anything, open a real WebRTC PeerConnection if you need
  one. The freedom is the point — a transport author needs full flexibility
  to faithfully implement a real protocol, including whatever that protocol
  actually does under the hood.
- **The signature is the entire security boundary.** Every `.js` file (or
  `.flux` package) is checked against an ed25519 public key the exit/node
  trusts, *before* a single line of it is ever evaluated. There is no
  partially-trusted path, no "run it but restrict what it can do" — it's
  signed and it runs, or it isn't and it's refused outright. See
  [04-signing-and-packaging.md](04-signing-and-packaging.md).
- **A transport can ask for a setup/login page, not just raw params.**
  `raise("needsSetup"/"captchaRequired", {url|html, reason})` opens the
  app's browser on a real site or on the script's own inline page (or one
  it serves itself with `httpserver.listen`, loopback-only); whatever the
  user submits comes back through the same `onEvent("cookiesApplied", ...)`
  path a solved captcha already uses. See
  [03-host-api-reference.md](03-host-api-reference.md) and
  [02-creating-a-transport.md](02-creating-a-transport.md#7-need-the-user-to-log-in-or-configure-something-first-setup-pages).

## The contract your script implements

A transport is one global object:

```js
var Transport = {
  info()               { /* manifest: name, version, params it needs, ... */ },
  open(cfg)            { /* connect. cfg = {url, params: {...}} */ },
  write(bytes)         { /* send one packet. bytes = ArrayBuffer */ },
  close()              { /* torn down */ },
  onEvent(kind, payload) { /* optional: OOB messages from the host app */ },
};
```

Five functions. `info()` runs once, synchronously, right after your file
loads. `open()` does your auth/connect dance and calls `setState(...)` as
your link's health changes — that's the *only* way the Go side ever learns
whether you're connected. `write()` is called once per outbound packet.
`close()` runs on shutdown. `onEvent()` is optional, for things like "here
are the cookies from a captcha you asked the app to solve out of band."

The full, exact contract — every field, every timing guarantee — is in
[templates/template.js](../templates/template.js), which is kept
byte-for-byte in sync with `transport/script/js/template.js` in the main
repo. Read it top to bottom before writing your first transport; it's
short and it's the actual reference, not a paraphrase of one.

## What's already shipped as a script transport

Seven transports run this way already, in the core's `transport/script/js/`
(and as signed `.flux` releases in
[OpenFluxTransports](https://github.com/p1neappleXpress/OpenFluxTransports)).
If you're building something similar (a doc-collab tool,
a WebSocket-based chat/relay protocol, anything with a browser-shaped auth
flow), reading one of the existing ports is often faster than starting from
the template — `mailru.js` is the shortest and simplest end-to-end example;
`cupsonline.js` shows multi-session isolation (`http.newSession()`);
`vyandex.js` shows bounded fan-out concurrency (`concurrency.pool`);
`oneme-webrtc.js` shows the WebRTC primitive in real use.

## Next

[02-creating-a-transport.md](02-creating-a-transport.md) — write one. When it
needs the user to tune something or to log in, see
[07-settings-and-setup-pages.md](07-settings-and-setup-pages.md).

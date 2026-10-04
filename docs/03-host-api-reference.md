# Host API reference

*[Читать на русском](ru/03-host-api-reference.md)*

Every function/object here is a **global** — no `require()`, no import.
Nothing is capability-scoped: the signature check on your file is the only
gate. This reference matches `transport/script/host.go`,
`transport/script/host_webrtc.go` and `transport/script/host_httpserver.go`
in the OpenFlux core (its `nightly` branch; see the core's `CHANGELOG.md` for
what has reached a stable release); everything documented here is real and
running, not aspirational.

## HTTP

### `http.fetch(opts) -> Promise<{status, url, body, headers}>`

```js
var res = await http.fetch({
  url: "https://example.com/page",
  method: "GET",              // default "GET"
  headers: { "User-Agent": "..." },
  body: "form=data",          // string
  redirect: "manual",         // default "follow"
});
```

- `res.url` is the **final** URL after redirects (when `redirect` is
  `"follow"`, the default). Compare it against what you requested to detect
  a silent bounce to a login/captcha page.
- `redirect: "manual"` stops Go from auto-following 3xx responses, so you
  see the redirect itself and its `Location` header — needed whenever you
  have to inspect *where* a redirect chain is going (captcha detection is
  almost always built on this).
- `res.headers` is a plain object, one value per header name (not an array
  — if a header repeats, you get the last one, matching Go's
  `Header.Get`).

### `http.newSession() -> Session`

```js
var session = http.newSession();
var res = await session.fetch({ url: "..." });
session.cookies.set("https://example.com/", { sid: "abc" });
var cookies = session.cookies.get("https://example.com/");
```

An **isolated** cookie jar + `http.Client` pair, sharing the same dialer and
connection-pool tuning as the default session. Use this whenever you manage
several independent logical sessions against the *same domain* — cookie
names collide across sessions on one domain, so a single shared jar would
let the last session's `authorize()` call silently clobber every earlier
session's cookies. (`cupsonline.js`'s four independent rooms are the
reference example — each gets its own session.)

Unlike the default `cookieJar` global (below), `session.cookies.get/set`
take the URL **explicitly** on every call — an ad-hoc session has no single
fixed domain to default to.

## HTTP server (a setup/login mini-app)

### `httpserver.listen(handler, port?) -> {port, addr, close()}`

```js
var server = httpserver.listen(function (req) {
  // req: {method, path, query, headers, body}  (body: ArrayBuffer; text.decode(req.body) for a string)
  if (req.path === "/") {
    return { status: 200, headers: { "Content-Type": "text/html" }, body: SETUP_PAGE_HTML };
  }
  return { status: 404, body: "not found" };
});
// server.port, server.addr ("127.0.0.1:<port>"); server.close() when done.
```

Your own HTTP server, for when a static page (see `raise("needsSetup", ...)`
below) isn't enough — a real mini-app with its own routes, or a page that
needs to `fetch()` against something with an actual origin instead of the
null origin an inline/`data:` page gets. The handler may be **sync or
async** — return a plain object, or a `Promise` that resolves to one; both
work identically:

```js
var server = httpserver.listen(async function (req) {
  if (req.path === "/check") {
    var res = await http.fetch({ url: "https://example.com/api/status" });
    return { status: 200, headers: { "Content-Type": "application/json" }, body: res.body };
  }
  return { status: 404, body: "not found" };
});
```

A thrown error (sync or async) becomes a 500 with the error's message as
the body — it does not crash the transport.

**It is always loopback-only.** There is no host parameter at all —
`listen()` binds `127.0.0.1` by construction, not by a runtime check your
script could get wrong, so a setup server can never become reachable off
the device it runs on. Close it (`server.close()`) once the setup flow is
done; it isn't closed for you until the transport itself stops.

## WebSocket

### `ws.open(url, headers?, opts?) -> Promise<Socket>`

```js
var sock = await ws.open("wss://example.com/socket", { Origin: "https://example.com" }, { readTimeoutMs: 60000 });
sock.onmessage = function (data) { /* string for a text frame, ArrayBuffer for binary */ };
sock.onclose = function (reason) { /* reason: string */ };
sock.send("text frame");
sock.send(bytesArrayBuffer); // binary frame
sock.close();
```

- `opts.readTimeoutMs`: reset before every read. A connection that falls
  silent longer than this fires `onclose` instead of hanging the reader
  goroutine forever. Omit or `0` = no deadline (most transports don't need
  one; ones talking to a server with no app-level ping/pong do).
- Assign `onmessage`/`onclose` any time after `open()` resolves — they're
  looked up lazily on every dispatch, so reassigning mid-connection is
  fine (useful for a reconnect that swaps handlers).
- `send` auto-detects bytes-like (`ArrayBuffer`/`TypedArray`) vs. string
  and sends a binary or text frame accordingly.

## UDP

### `udp.open(remoteAddr, opts?) -> Promise<Socket>`

Same `Socket` shape as `ws.open` (`send`/`onmessage`/`onclose`/`close`).
Dial-only — a connected socket to one fixed remote address, not a
listen-from-anywhere socket (nothing shipped so far has needed that).
`opts.readTimeoutMs` same semantics as WebSocket's.

## WebRTC

### `webrtc.newPeerConnection({iceServers, iceTransportPolicy}) -> PeerConnection`

```js
var pc = webrtc.newPeerConnection({
  iceServers: [{ urls: ["turn:turn.example.com:3478"], username: "u", credential: "p" }],
  iceTransportPolicy: "relay", // optional; omit for the default (all candidate types)
});

pc.onicecandidate = function (c) { /* c: {candidate, sdpMid, sdpMLineIndex} or null when gathering completes */ };
pc.onconnectionstatechange = function (state) { /* "new"|"connecting"|"connected"|"disconnected"|"failed"|"closed" */ };
pc.oniceconnectionstatechange = function (state) { /* ICE-specific state */ };
pc.ondatachannel = function (dc) { /* remote peer created a channel */ };

var dc = pc.createDataChannel("label", { ordered: true, maxRetransmits: 0 });

var offerSdp = await pc.createOffer();
await pc.setLocalDescription("offer", offerSdp);
// ... send offerSdp to the other side over YOUR signaling channel ...

// on receiving a remote description over your signaling channel:
await pc.setRemoteDescription("offer" /* or "answer" */, remoteSdp);

// on receiving a remote ICE candidate over your signaling channel:
await pc.addIceCandidate({ candidate: "candidate:...", sdpMid: "0", sdpMLineIndex: 0 });

pc.close();
```

```js
dc.onopen = function () {};
dc.onclose = function () {};
dc.onmessage = function (bytes) { /* always ArrayBuffer */ };
dc.send(bytesOrString);
dc.close();
```

ICE gathering/DTLS/SCTP are handled by the native side (pion/webrtc) — that
part genuinely can't be implemented in JS. **Everything above that layer is
yours**: how you exchange SDP/candidates with the other peer (your own
signaling protocol, over `http.fetch`/`ws.open`/whatever the real target
uses), when to offer vs. answer, retry/timeout policy. `oneme-webrtc.js` in
the main repo is the reference implementation — it signals over a plain
WebSocket call-setup channel and drives this exact API.

One gotcha worth knowing before you build a two-peer local test: **goja
drains an already-resolved promise's `.then` chain synchronously**, as
part of the native Go call that resolved it — not deferred to a later event
loop tick like you'd expect from real async semantics. If you're wiring two
`ScriptTransport`s together directly in a test (relaying `raise()` events
between them), the *second* transport must already be started before the
first one's `open()` runs its connect logic, or a `Deliver()` call lands on
a transport whose loop doesn't exist yet. See
[06-lessons-learned.md](06-lessons-learned.md) for the concrete failure
this causes and why.

## Cookies

### `cookieJar.get() -> {name: value, ...}` / `cookieJar.set(values, domain?)`

Reads/writes against `info().cookieDomain`. This is the same jar
`http.fetch` (the default session) already uses and updates automatically
— you rarely need `cookieJar.set` yourself; it exists mainly for the
`onEvent("cookiesApplied", ...)` flow (an out-of-band captcha solve handed
back to you — see [06](06-lessons-learned.md) for the cross-subdomain
scoping gotcha here).

## Codecs

```js
base64.encode(bytes) -> string          // bytes: ArrayBuffer/TypedArray
base64.decode(str)   -> ArrayBuffer

text.encode(str)   -> ArrayBuffer       // UTF-8
text.decode(bytes) -> string

gzip.compress(bytes)   -> ArrayBuffer
gzip.decompress(bytes) -> ArrayBuffer

lz4.decompressBlock(bytes, expectedSize) -> ArrayBuffer
```

`lz4` is the **block** format (needs the decompressed size upfront — LZ4
blocks have no end-of-stream marker), not the streaming/frame format. If
your target sends LZ4-compressed payloads with a size prefix somewhere
(check its handshake/metadata), this is what decodes them.

The Go↔JS packet boundary itself (`write()`/`emit()`) is **always** raw
bytes — these codecs exist only for when *your* wire format's own framing
needs text/compression (a cursor field that's base64, a fingerprint blob
that's gzipped, ...).

## Crypto

```js
crypto.sha256(bytes) -> ArrayBuffer
crypto.solvePow(prefixHexOrRaw, complexity) -> { nonceHex, attempts }
```

`solvePow` brute-forces a 16-byte nonce until `sha256(nonce || prefix)` has
`complexity` leading zero bits — the one deliberate native-speed exception
in the whole API. A hash-based proof-of-work challenge can need millions of
attempts; paying a JS↔Go call per attempt would dwarf the cost of the hash
itself. Nothing else in this API gets this treatment — if you think your
transport needs another one, that's a real design question, not a default.

## Concurrency

```js
var pool = concurrency.pool(n);
var result = await pool.run(function () {
  return someAsyncWork(); // e.g. an http.fetch call
});
pool.size(); // current in-flight count
```

Gates at most `n` concurrent in-flight `run()` calls through a Go
semaphore. The function you pass still executes with **real OS-level
concurrency** (an `http.fetch` inside it runs on its own goroutine exactly
like any other fetch) — this primitive only adds the bounded-fan-out
bookkeeping. goja itself is single-threaded; this is how a transport gets
genuine parallel throughput instead of pretending to run N workers inside
one interpreter. `vyandex.js` (`concurrency.pool(64)`) is the reference —
see its file header for why 64, not some larger number, is the right choice
once real concurrency comes from here instead of from counting workers in
JS.

Pair this with `info()`'s `httpMaxConnsPerHost`/`httpMaxIdleConns`/
`httpIdleConnTimeoutMs` if you're fanning out many concurrent requests —
Go's default HTTP transport pool (2 idle conns/host) will bottleneck a
`concurrency.pool`-driven transport otherwise.

## Misc

```js
url.parse(str) -> { href, protocol, hostname, host, pathname, search, hash }
```

goja has no WHATWG `URL` global; this is backed by Go's `net/url`. Use it
instead of hand-rolled regex for redirect-chain URL manipulation.

`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`,
`console.log`/`warn`/`error` — standard, run on this transport's own event
loop.

`require("./local/module.js")` — **author-time only**. See
[04-signing-and-packaging.md](04-signing-and-packaging.md) — the runtime
never loads a module from disk; a build tool (`scriptbundle`) inlines local
`require()`s into one flat file before you sign it.

## The Go↔JS packet boundary

```js
emit(bytes)              // deliver one received application packet up.
                          // bytes: ArrayBuffer/TypedArray, zero-copy.
setState(state, errMsg?) // state: "connecting"|"connected"|"reconnecting"|
                          //        "degraded"|"dead"
raise(kind, payload)     // upward out-of-band event, any kind, e.g.
                          // raise("captchaRequired", {url: "...", location: "..."})
onEvent(kind, payload)   // downward: the host app answering one of your
                          // raise() calls, or "cookiesApplied" (below)
```

`setState("connected")`/`setState(anything-else)` is the **only** way
`IsConnected()` on the Go side ever changes — there's no other signal. Get
this wrong (call it too early, or never call it at all) and the core will
either think you're up when you're not, or never route traffic to you at
all.

### `raise(kind, payload)` reaching the app's browser surface

Every `kind` reaches your own `onEvent` handler on whatever registered one
(host-app-side, mirroring the cookie-exchange pattern) - that part is
generic, no special-cased kinds. Two spellings additionally reach the
app's actual captcha/login UI (a real browser dialog, not just a callback):

```js
raise("captchaRequired", { url: "https://real-site.example/check", reason: "smartcaptcha" });
raise("needsSetup",      { html: SETUP_PAGE_HTML,                   reason: "Pair your account" });
raise("needsSetup",      { url: "http://" + server.addr + "/",       reason: "Pair your account" });
```

- `captchaRequired` and `needsSetup` are treated identically - pick whichever
  name reads better at the call site. Pass **either** `url` **or** `html`.
- A **page of your own** is either inline `html`, or an `http://127.0.0.1:<port>`
  address of a server **you** started with `httpserver.listen()`. The app shows it
  as it is, gives it `window.openfluxSubmit` and does not collect cookies from
  it; `reason` becomes the dialog's title. A **real site** is an `https://` URL:
  the app collects its cookies.
- **The core checks the payload and throws a `TypeError` into your script** for
  anything else: another `http://` address, a loopback port that is not yours (or
  that you closed), `file:`, `javascript:`, `data:`, `html` together with `url`,
  a page over 512 KiB. `reason` is clipped to 200 characters.
- Getting data back is the same path every time: the user's answer is delivered
  to `ApplyCookies` (cookies scraped from a real page, or the payload of
  `window.openfluxSubmit`), which fires `onEvent("cookiesApplied", values)` on
  your script - read `values` back with `cookieJar.get()` in that handler (see
  [templates/template.js](../templates/template.js)). It does not matter whether
  `values` are real cookies or your own fields.
- `window.openfluxSubmit(payload)` takes a flat object or
  `{client: {...}, node: {...}}` (only `client` is delivered), values become
  strings (null, objects and arrays are dropped), and at least one value must
  remain. See [07](07-settings-and-setup-pages.md#5-windowopenfluxsubmit) for when
  it exists on the page and how it stays with your page's own address.

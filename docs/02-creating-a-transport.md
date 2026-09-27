# Creating a transport

*[Читать на русском](ru/02-creating-a-transport.md)*

This walks through writing a real (if toy) transport end to end: auth over
HTTP, a WebSocket for the actual channel, reconnect on drop, and testing it
against a real target. It assumes you've read
[01-overview.md](01-overview.md).

## 0. Decide which protocol you're implementing

Before writing anything: what does the *real* client of this protocol
actually do on the wire? Open the real site/app, watch its network traffic
(a browser's devtools Network tab is usually enough), and note:

- What does the auth/handshake sequence look like? Cookies? A token in a
  redirect? A captcha you'll need to handle?
- What's the actual message framing once connected? Raw WebSocket frames?
  Socket.IO-style `42["event",{...}]`? A custom binary format?
- Where does *your* payload actually fit? Almost every one of the shipped
  transports carries its data inside a field the real protocol already has
  room for (a cursor-position string, an "ICE candidate," a chat message) -
  find that field for your target protocol.
- What's the realistic packet rate and size? This decides whether you need
  `concurrency.pool` (see [03](03-host-api-reference.md)) or plain
  sequential `await`s are fine.

Skipping this and guessing at the protocol is the single biggest time sink
observed building the existing seven transports. Every one of them was a
faithful port of an already-understood wire format, not a reimplementation
from scratch.

## 1. Start from the template

```bash
cp OpenFluxSDK/templates/template.js OpenFlux/transport/script/js/my-transport.js
```

Read `info()`, `open()`, `write()`, `close()`, `onEvent()` in the template
comments — they're the actual contract, not filler.

## 2. `info()` — declare what you are

```js
info: function () {
  return {
    name: "my-transport",
    version: "1.0.0",
    cookieDomain: "https://example.com/",
    params: [
      { key: "url", label: "Room URL", type: "url", required: true },
    ],
  };
},
```

`name` is the only required field. Everything else is either advisory
(MTU/reliable/ordered — the core does not fragment or reorder on your
behalf unless you ask) or purely declarative for a UI/CLI to build a form
from (`params`).

## 3. `open()` — auth, then connect

```js
var sock = null;
var running = false;

async function connectOnce(cfg) {
  var res = await http.fetch({ url: cfg.params.url, headers: { "User-Agent": "Mozilla/5.0" } });
  if (res.status !== 200) throw new Error("http " + res.status);

  var m = /"wsUrl":"([^"]+)"/.exec(res.body);
  if (!m) throw new Error("wsUrl not found in page");

  sock = await ws.open(m[1], { Origin: "https://example.com" });
  sock.onmessage = handleMessage;
  sock.onclose = onSocketClose;
  setState("connected");
}

var Transport = {
  info: function () { /* ... */ },
  open: function (cfg) {
    running = true;
    setState("connecting");
    connectOnce(cfg).catch(function (e) {
      setState("dead", String(e));
      scheduleReconnect(0);
    });
  },
  // ...
};
```

Key things this example is already doing right:

- **`open()` returns immediately.** The actual connect work runs as an
  unhandled-by-Go async chain. This mirrors how a native transport's
  `Start()` returns before the connection is actually up.
- **`setState` is the only signal the Go side has.** `IsConnected()` on
  the Go side is driven *exclusively* by your `setState("connected")`
  calls - nothing else. If you never call it, the transport looks
  permanently disconnected no matter what your socket is doing.
- **Errors go to `scheduleReconnect`, not nowhere.** The core does not
  retry a failed `open()` for you. Write your own backoff (exponential with
  jitter is what every shipped transport does - see any of their
  `reconnectBackoff` functions for a copy-pasteable one).

## 4. `write()` / `emit()` — the actual data path

```js
write: function (bytes) {
  if (!sock) throw new Error("not connected");
  sock.send(bytes); // binary frame - zero-copy, no codec needed
},
```

If the real protocol's wire format is **binary**, `write()` can hand
`bytes` (an `ArrayBuffer`) straight to `sock.send()` - no copying, no
encoding. If it's **textual** (JSON, a cursor field, a Socket.IO event),
encode it yourself:

```js
write: function (bytes) {
  sock.send('42["cursor",{"p":"' + base64.encode(bytes) + '"}]');
},
```

Receiving is symmetric - decode whatever the real protocol wraps your data
in, then call the global `emit(bytes)` once per received application
packet:

```js
function handleMessage(msg) {
  var m = /"p":"([^"]+)"/.exec(msg);
  if (m) emit(base64.decode(m[1]));
}
```

`emit`/`write` always carry raw bytes (`ArrayBuffer`/`TypedArray`) - the
codec (if any) is *your* wire format's business, not the Go/JS boundary's.

## 5. Reconnect and `close()`

```js
var reconnectAttempt = 0;

function scheduleReconnect(attempt) {
  reconnectAttempt = attempt + 1;
  var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5)));
  delay += Math.floor(Math.random() * 500); // jitter
  setTimeout(function () {
    if (running) connectOnce({ /* ... */ }).catch(function (e) {
      setState("reconnecting", String(e));
      scheduleReconnect(reconnectAttempt);
    });
  }, delay);
}

function onSocketClose() {
  sock = null;
  if (running) { setState("reconnecting"); scheduleReconnect(reconnectAttempt); }
}
```

```js
close: function () {
  running = false;
  if (sock) { try { sock.close(); } catch (e) {} }
},
```

You don't strictly need to `clearTimeout` your own timers in `close()` -
the Go side tears down the whole event loop (and every timer on it) when
the transport stops - but closing sockets explicitly avoids a half-open
connection lingering until GC catches it.

## 6. Sign it and test it

```bash
cd OpenFlux
go run ./transport/script/cmd/scriptsign genkey dev.key dev.pub
go run ./transport/script/cmd/scriptsign sign dev.key transport/script/js/my-transport.js

go run ./transport/script/cmd/scripttest \
  -script transport/script/js/my-transport.js \
  -pubkey "$(cat dev.pub)" \
  -url "https://example.com/room/abc123" \
  -duration 30s -send "hello"
```

`scripttest` prints every state transition and every received packet.
Watch for:

- Does `connected=true` show up, and does it *stay* true (not flapping)?
- Does your `-send` packet actually reach the other side (check via a
  second `scripttest` instance against the same room/URL, or the real
  app's own UI)?
- Does killing your network (or the real target briefly) trigger a clean
  `reconnecting` -> `connected` cycle, not a permanent `dead`?

See [05-testing.md](05-testing.md) for load-testing and two-peer setups,
and [06-lessons-learned.md](06-lessons-learned.md) for the specific bugs
that testing caught in the existing seven transports - several of the same
mistakes are easy to make in a new one too.

## 7. Package it (optional)

A plain `<name>.js` + `<name>.js.sig` pair works fine. If you want
author/description/icon metadata for a UI listing, or want the whole thing
distributed as one file, see [04-signing-and-packaging.md](04-signing-and-packaging.md)
for the `.flux` package format and `scriptsign pack`.

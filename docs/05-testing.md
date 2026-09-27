# Testing

*[Читать на русском](ru/05-testing.md)*

`scripttest` (`transport/script/cmd/scripttest` in the main repo) is the
tool every one of the shipped transports was actually verified with — a
live-network manual smoke-test harness, not a mock. There's no substitute
for testing against the real target: every transport that shipped this way
was verified against production infrastructure, not a stub server.

## Basic usage

```bash
go run ./transport/script/cmd/scripttest \
  -script transport/script/js/my-transport.js \
  -pubkey <hex pubkey> \
  -url "https://example.com/room/abc123" \
  -duration 30s \
  -send "hello"
```

Prints every `setState`/`raise` transition and every received packet
(truncated), then a status line every 2 seconds:

```
[12:00:03.501] connected=true  state=connected    err="" sent=27B recv=115B reconnects=0
```

Watch for:

- **`connected` flapping** — usually a `setState` call in the wrong place,
  or a reconnect loop that's too aggressive relative to the real target's
  own rate limits.
- **`reconnects` climbing without `recv` ever moving** — you're
  reconnecting successfully but never actually receiving anything; check
  your message-parsing regex/JSON path against what the real target
  actually sends (log the raw message once, by hand, before assuming your
  parser is right).
- **A captcha/login wall** (`EVENT captchaRequired ...` or similar) — see
  the cookie-injection flow below.

## Feeding in externally-solved cookies

If your target has a captcha/login wall your script correctly detects but
can't solve in-band (this is expected and fine — the *detection* is the
script's job; solving it out-of-band, e.g. via a phone/WebView, is the
host application's), `scripttest` can apply a real cookie jar for you:

```bash
go run ./transport/script/cmd/scripttest \
  -script transport/script/js/my-transport.js -pubkey <hex> \
  -url "https://example.com/doc/abc" \
  -cookies-file cookies.json -duration 20s
```

```json
{
  "https://example.com/doc/abc": {
    "session": "...",
    "auth_token": "..."
  }
}
```

This calls `ApplyCookies` right after `Start()` — the same path a real host
app uses to relay a solved captcha's cookies back into a running
transport. If your transport declares `scopeCookiesToParentDomain: true`
in `info()`, double-check the cookie actually reaches every subdomain you
fetch from (see [06-lessons-learned.md](06-lessons-learned.md) for a real
bug this exact scenario caught).

**Never commit a cookies file with real session data.** Treat it like any
other credential.

## Load testing

```bash
go run ./transport/script/cmd/scripttest \
  -script transport/script/js/my-transport.js -pubkey <hex> \
  -url "..." -duration 30s \
  -burst 5000 -burst-size 512
```

Once connected, sends `-burst` packets of `-burst-size` bytes back-to-back
as fast as `Send()` accepts them, then reports elapsed time and throughput.

**Pick a burst count well above 1024** (the write queue's buffer size —
`transport.DefaultConfig().MaxQueueSize`). Below that, you're only
measuring how fast you can fill a buffer, not the transport's actual
sustained rate — the first ~1024 packets enqueue near-instantly regardless
of real wire speed. A few thousand packets makes the buffer-fill time a
negligible fraction of the total, so the reported throughput converges to
the real, write()-bound sustained rate.

Numbers actually measured this way on the shipped transports: a
Socket.IO-framed doc-cursor transport (`mailru.js`) sustained ~11,800
pkt/s / 5.9 MB/s submit-side; a Centrifugo pub/sub transport
(`cupsonline.js`) with two real concurrent peers exchanged ~4,000 pkt/s /
1.5 MB/s *each way* through a real room. Use these as a rough sense of
what "reasonable" looks like for a comparable protocol shape, not as a
target to hit.

## Two-peer testing

Some transports only make sense tested against *another instance of
themselves* (anything that's fundamentally peer-to-peer through a relay,
rather than client-to-a-fixed-server). Run two `scripttest` processes
against the same room/URL concurrently:

```bash
go run ./transport/script/cmd/scripttest -script t.js -pubkey $K -url "$ROOM" -duration 25s -send "from-A" &
go run ./transport/script/cmd/scripttest -script t.js -pubkey $K -url "$ROOM" -duration 25s -send "from-B" &
wait
```

Then check each side's `RECV` lines for the other side's message. If your
target auto-creates a room/session when you first visit it (many
collab-tool backends do — check by just opening the base URL in a browser
before assuming you need a "create room" API call), you don't need any
special setup beyond a fresh URL/ID.

## Reading `LastState()`/events when something's silently wrong

If a run just sits at `reconnecting` with `err=""` and no `EVENT` lines,
your script is very likely throwing inside a callback whose result nothing
propagates (a WebSocket `onmessage` handler, a promise `.then` with no
`.catch`). goja/the event-loop wrapper swallow exceptions inside these
callbacks silently by design (one bad message shouldn't kill the whole
read loop) — which means **you** need explicit `try`/`catch` +
`console.log`/`raise("debug", {...})` around anything you're not 100% sure
is bug-free, or failures there are invisible from the outside. This is the
single most common "why is nothing happening" cause; add logging before
assuming the host API itself is broken.

## Before you ship

- Does a natural network blip (kill your wifi for 5 seconds) recover
  cleanly, or does the transport get stuck?
- Does the real target's rate limiting/captcha wall get triggered by your
  reconnect loop being too aggressive? (Exponential backoff with jitter,
  capped, is the pattern every shipped transport uses — copy one's
  `reconnectBackoff` rather than inventing a new curve.)
- Did you run at least one burst/load test, even a small one? A transport
  that only works at hello-world packet rates will surprise you in
  production.

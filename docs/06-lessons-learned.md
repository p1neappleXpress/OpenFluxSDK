# Lessons learned

*[Читать на русском](ru/06-lessons-learned.md)*

Real bugs and non-obvious runtime behaviors found while building the seven
transports currently shipped this way. Read this before you spend an hour
debugging something already documented here — every entry below cost real
debugging time once already.

## goja drains an already-resolved promise's `.then` chain synchronously

Real async runtimes (browsers, Node) always defer a `.then` callback to a
later microtask tick, even if the promise is already resolved by the time
you attach the handler. **goja does not** — if the promise is already
settled, `.then` runs immediately, inline, as part of the native Go call
that resolved it.

This is invisible in almost every transport, because host calls (`http.fetch`,
`ws.open`, ...) genuinely take time, so their promises are never resolved at
the moment you attach a handler. It only bites when you wire two
`ScriptTransport`s together directly — for example a local test that relays
`raise()` events from one transport into the other's `Deliver()` — because
that path can resolve synchronously from JS's point of view.

Concretely: if transport A calls something that ends up invoking transport
B's `Deliver()` before B has been `Start()`ed, you get `script: transport not
started`, even though your code *looks* like it starts both before doing
anything. The fix is ordering: whichever transport will receive a `Deliver()`
call as a *side effect* of the other one's `open()` logic must already be
started first. See `TestScriptTransportWebRTCDataChannel` in the main repo's
`transport/script/transport_test.go` for the concrete shape of this — it
starts the callee before the caller for exactly this reason.

If you're only testing against a real remote target (the common case), you
will never see this. It only shows up in loopback-style two-`ScriptTransport`
tests.

## `ApplyCookies` didn't scope to the parent domain correctly

`ApplyCookies` is how a host application hands a transport cookies it solved
out-of-band (a captcha answer, typically — see
[cookieJar](03-host-api-reference.md#cookies) and the
`scopeCookiesToParentDomain` flag in [templates/template.js](../templates/template.js)).

The bug: when `cookieDomain` was already the apex domain itself (e.g.
`https://example.com/`, not `https://sub.example.com/`), the old code left
the cookie's `Domain` attribute empty — making it a **host-only** cookie
that would never be sent to any subdomain. A cookie solved against the apex
would then silently never reach a sibling subdomain the transport actually
talks to (e.g. a captcha solved on the account/login apex, but the real
session lives on a content subdomain).

This was only caught because a transport was tested with real, externally
solved cookies against a real subdomain split — a mock cookie jar in a unit
test would never have exercised the apex-vs-subdomain distinction. It's now
fixed and covered by a regression test in the main repo
(`TestScriptTransportApplyCookiesScopesToApexDomain`), but if you're seeing a
transport that detects and "solves" a captcha correctly yet still can't
reach your actual target afterward, check whether your `cookieDomain` is the
apex and whether the cookie you expect actually shows up on the subdomain you
fetch from — don't assume the host-side cookie plumbing is trustworthy by
default just because it ran without an error.

## Exceptions thrown inside async callbacks fail silently

goja / the event-loop wrapper around it catch and swallow exceptions thrown
inside a callback whose return value nothing is waiting on — a WebSocket
`onmessage` handler, a promise `.then` with no `.catch`, a `setInterval`
tick. This is deliberate (one malformed message shouldn't kill an entire
read loop), but it means a bug in one of these callbacks produces **no
error, no log, nothing** — the transport just looks like it stopped doing
anything.

If a `scripttest` run sits at `reconnecting` with `err=""` and no further
`EVENT` lines, this is almost always the cause, not a host-API problem. Wrap
anything you're not 100% sure is bug-free in `try`/`catch` with an explicit
`console.log` or `raise("debug", {...})` — there is no other way to see the
failure. This is by far the most common "why is nothing happening" report,
and it is very rarely the host API.

## `require()` is author-time only — don't expect it at runtime

The runtime never loads a JS module from disk on its own; the only file it
ever evaluates is the one signed file it verified (see
[04-signing-and-packaging.md](04-signing-and-packaging.md)). If you hand-edit
a bundled output file and add a `require()` call to it directly, it will fail
at load time with an unresolved-reference error, not silently no-op. Always
edit the `src/`-style source and re-run `scriptbundle`, never the bundled
output.

## Reference numbers from real load tests

Not bugs, but worth having as a sanity check for "is my transport's
throughput reasonable": a Socket.IO-framed doc-cursor transport sustained
~11,800 pkt/s / 5.9 MB/s submit-side; a pub/sub transport with two real
concurrent peers exchanged ~4,000 pkt/s / 1.5 MB/s *each way* through a real
room. See [05-testing.md](05-testing.md#load-testing) for how these were
actually measured (and the buffer-size pitfall that makes a naive burst test
report a fake number).

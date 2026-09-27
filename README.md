# OpenFlux Transport SDK

*[Читать на русском](README.ru.md)*

Everything you need to write, sign, package, and test a new **OpenFlux
transport** — without touching the OpenFlux core, and without rebuilding
the app.

## What a transport actually is here

Since [`feature/scripted-transports`](https://github.com/p1neappleXpress/OpenFlux/tree/feature/scripted-transports)
(not yet merged into `main` — see that branch's `CHANGELOG.md` for exactly
what's proven vs. still open), an OpenFlux transport is **a signed
JavaScript file**, loaded at runtime into its own [goja](https://github.com/dop251/goja)
interpreter (pure Go, no cgo — same static binary, same cross-compile
story as the rest of the core). You write the auth flow, the wire framing,
the reconnect policy — all in JS. The core supplies a host API (HTTP,
WebSocket, UDP, a real WebRTC PeerConnection, cookies, a few codecs, a
concurrency primitive) and exactly one gate: **an ed25519 signature check**.
Unsigned or wrongly-signed code never runs. That's the entire security
model — there is no capability sandbox beyond it, deliberately, so you have
full room to implement whatever a real transport needs.

## Start here

1. **[docs/01-overview.md](docs/01-overview.md)** — the architecture, in
   five minutes.
2. **[docs/02-creating-a-transport.md](docs/02-creating-a-transport.md)** —
   the actual walkthrough: write one, test it against a real target, ship it.
3. **[docs/03-host-api-reference.md](docs/03-host-api-reference.md)** —
   every host global, with signatures and the reasoning behind each one.
4. **[docs/04-signing-and-packaging.md](docs/04-signing-and-packaging.md)**
   — the ed25519 model, and the `.flux` package format.
5. **[docs/05-testing.md](docs/05-testing.md)** — `scripttest`, load-testing
   your transport, and the debugging tricks that actually worked while
   building the seven transports currently shipped this way.
6. **[docs/06-lessons-learned.md](docs/06-lessons-learned.md)** — real bugs
   found while building this, and the non-obvious goja/runtime behaviors
   that caused them. Read this before you spend an hour debugging something
   already documented here.

## Quickstart

```bash
git clone https://github.com/p1neappleXpress/OpenFluxSDK.git
cd OpenFluxSDK

cp templates/template.js my-transport.js
# ... write your transport ...

# Option A: use the prebuilt binaries in bin/ (pick your platform's dir)
bin/darwin-arm64/scriptsign genkey dev.key dev.pub
bin/darwin-arm64/scriptsign sign dev.key my-transport.js
bin/darwin-arm64/scripttest \
  -script my-transport.js -pubkey "$(cat dev.pub)" \
  -url "https://example.com/whatever" -duration 30s -send hello

# Option B: build from source against the main repo instead (always
# reflects the latest host API — see bin/README.md for the tradeoff)
git clone --branch feature/scripted-transports https://github.com/p1neappleXpress/OpenFlux.git
cd OpenFlux
go run ./transport/script/cmd/scriptsign genkey dev.key dev.pub
go run ./transport/script/cmd/scriptsign sign dev.key ../OpenFluxSDK/my-transport.js
go run ./transport/script/cmd/scripttest \
  -script ../OpenFluxSDK/my-transport.js -pubkey "$(cat dev.pub)" \
  -url "https://example.com/whatever" -duration 30s -send hello
```

Try `examples/echo-transport.js` first if you just want to see the contract
run end to end before porting a real protocol.

## What's in this repo

- `docs/` — the guides above (also in [Russian](docs/ru/01-overview.md)).
- `templates/template.js` — the canonical starting point (kept in sync with
  the host API — if you're reading an older clone, diff it against
  `transport/script/js/template.js` in the main repo).
- `examples/echo-transport.js` — the smallest possible working transport,
  for understanding the contract without any real-world protocol noise.
- `bin/` — prebuilt `scriptsign`/`scripttest`/`scriptbundle` binaries for
  macOS/Linux/Windows, so you don't need to clone the main repo just to sign
  or test a script. See [bin/README.md](bin/README.md).

## Status

This SDK documents `feature/scripted-transports`, a branch of the main
repo — **not yet merged into `main`**. The runtime and host API are real
and tested against live infrastructure (see the main repo's `CHANGELOG.md`
on that branch), but treat everything here as a working preview, not a
stable, versioned API yet. It will move and this SDK will follow it.

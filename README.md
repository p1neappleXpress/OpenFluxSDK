# OpenFlux Transport SDK

*[Читать на русском](README.ru.md)*

Everything you need to write, sign, package, and test a new **OpenFlux
transport** — without touching the OpenFlux core, and without rebuilding
the app.

## What a transport actually is here

Since core **0.4.0** and the apps' **2.3.0** (the apps keep it behind
Settings → "Экспериментальные функции", off by default — see
[Status](#status)), an OpenFlux transport can be **a signed
JavaScript file** (or a signed `.flux` package),
loaded at runtime into its own [goja](https://github.com/dop251/goja)
interpreter (pure Go, no cgo — same static binary, same cross-compile
story as the rest of the core). You write the auth flow, the wire framing,
the reconnect policy — all in JS. The core supplies a host API (HTTP, an
HTTP server for your own setup/login mini-app, WebSocket, UDP, a real
WebRTC PeerConnection, cookies, a few codecs, a concurrency primitive) and
exactly one gate: **an ed25519 signature check**. Unsigned or
wrongly-signed code never runs. That's the entire security model — there is
no capability sandbox beyond it, deliberately, so you have full room to
implement whatever a real transport needs.

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
7. **[docs/07-settings-and-setup-pages.md](docs/07-settings-and-setup-pages.md)**
   — let the user tune your transport (declare settings once, the app builds the
   **Настройки** wizard) and ask for a page when it cannot connect until the
   user does something (a login, a pairing): `raise()`, `httpserver.listen()`,
   `window.openfluxSubmit`, and how to try all of it with `scripttest`, no app.

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
git clone --branch nightly https://github.com/p1neappleXpress/OpenFlux.git
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
- `templates/template_html.html` — a starter setup/login mini-app page (logo,
  status line, a `window.openfluxSubmit`-wired button) for a transport that
  needs the user to configure or log in to something before it can connect
  — see [docs/02-creating-a-transport.md](docs/02-creating-a-transport.md#7-need-the-user-to-log-in-or-configure-something-first-setup-pages).
- `examples/echo-transport.js` — the smallest possible working transport,
  for understanding the contract without any real-world protocol noise.
- `examples/settings-demo.js` — the same, with settings declared in
  `info().params` (every field type) that the app turns into a wizard.
- `examples/setup-own-server.js` — a transport that pairs an account through a
  page of its own, served by the script itself (`httpserver.listen`).
- `bin/` — prebuilt `scriptsign`/`scripttest`/`scriptbundle` binaries for
  macOS/Linux/Windows, so you don't need to clone the main repo just to sign
  or test a script. See [bin/README.md](bin/README.md).

## Status

The script-transport engine is in the OpenFlux core since **0.4.0**, and in the
desktop and Android apps since **2.3.0**. The apps ship it switched **off**: the
"Транспорты" tab and everything JS appear only after Settings →
"Экспериментальные функции" is turned on (a profile with a JS transport refuses to
connect while it is off). The runtime and host API are real and tested against
live infrastructure and against the real apps, but the feature is still
flagged experimental, so treat details as subject to change and check the
core's `CHANGELOG.md` when you update. The nightly channel (the core's `nightly`
branch and the apps' nightly builds) carries what comes next; the prebuilt tools
in `bin/` are built from that line.

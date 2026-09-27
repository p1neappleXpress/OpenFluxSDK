# Signing and packaging

*[Читать на русском](ru/04-signing-and-packaging.md)*

The signature is the **entire** security boundary for a script transport —
there is no other trust check, and no capability restriction inside the
runtime. Get comfortable with this model before shipping anything: a script
signed by a key you trust can do *anything* the host API allows (dial
anywhere, fetch anything, open arbitrary sockets). That's intentional — see
[01-overview.md](01-overview.md) — but it means key management is the whole
game.

## Plain `.js` + `.sig`

The simplest form: a `<name>.js` file and a detached `<name>.js.sig`
signature (raw ed25519 signature bytes) sitting next to it.

```bash
go run ./transport/script/cmd/scriptsign genkey priv.key pub.key
go run ./transport/script/cmd/scriptsign sign priv.key transport/script/js/my-transport.js
go run ./transport/script/cmd/scriptsign verify pub.key transport/script/js/my-transport.js
```

`genkey` writes both keys as hex, one line, no headers — `priv.key` mode
`0600`. **Never commit a private key to git.** Every production key in the
main repo's own transports lives outside the repo entirely (a
`~/oflx-keys/`-style path, mode 600).

At load time, the runtime reads `<name>.js`, reads `<name>.js.sig`, and
calls `ed25519.Verify(pubKey, scriptBytes, sig)` — fails closed, no
partial trust, no warning-and-continue.

## `.flux` packages

A `.flux` file is a zip archive containing:

- `manifest.json` — `{name, version, author, description, icon}` (`icon`
  names another file inside the same archive, e.g. `"icon.png"`)
- `main.js` — the actual script (already bundled — see below — if it uses
  local `require()`s)
- an optional icon file
- `package.sig` — the signature

**The signature covers the whole manifest together with the script and
icon** (length-prefixed concatenation, so there's no ambiguity from a
missing/empty icon) — not just `main.js`. This means a legitimately-signed
package's `name`/`author`/`description`/`icon` can't be swapped by anyone
without your private key, without invalidating the signature. If you'd
rather sign just the script and treat metadata as unauthenticated (purely
cosmetic, for a UI listing), that's a design choice you can make by not
using `.flux` at all and shipping plain `.js`+`.sig` instead — there's no
"partially signed" middle ground within `.flux` itself.

```bash
go run ./transport/script/cmd/scriptsign pack \
  priv.key manifest.json transport/script/js/my-transport.js out.flux icon.png
  # icon.png is optional - omit the last argument for no icon

go run ./transport/script/cmd/scriptsign verify pub.key out.flux
```

`manifest.json` needs at least `{"name": "..."}`; `pack` overwrites its
`icon` field to match whatever icon file (if any) you actually passed —
a package's manifest can never reference an icon that isn't in the archive
next to it.

Add `-store` to `pack` to leave entries uncompressed instead of the default
deflate — the format supports either; nothing about loading a `.flux`
package cares which one you picked.

### Loading: `.flux` vs `.js` — the runtime picks automatically

Given a bare transport name, the loader tries `<name>.flux` first, falling
back to `<name>.js` if no `.flux` exists. You don't choose the format at
the CLI/config level — just drop the file you built into the script
directory under the right name.

## Sharing code between scripts: `scriptbundle`

The runtime **never** loads a JS module from disk on its own — the only
file it ever evaluates is the one signed file it verified. If your
transport wants to share code with another one (a captcha solver, a
protocol client both use), write it as a separate module and inline it at
build time instead:

```js
// src/lib/mymodule.js
function doSomething() { /* ... */ }
module.exports = { doSomething: doSomething };
```

```js
// src/my-transport.js  (the SOURCE — not what gets signed)
var mymodule = require("./lib/mymodule.js");
mymodule.doSomething();
```

```bash
go run ./transport/script/cmd/scriptbundle \
  -entry src/my-transport.js -out my-transport.js
# NOW sign my-transport.js (the bundled output), not src/my-transport.js
go run ./transport/script/cmd/scriptsign sign priv.key my-transport.js
```

`scriptbundle` regex-scans for `require("./relative/path.js")` calls
(relative only — no package resolution, no node_modules), recursively
inlines each module into a small CommonJS-shim wrapper, and emits one flat
file with zero runtime dependency on `require()`. This is why the runtime
never needed its own module loader: by the time you sign anything, there's
only one file, and its signature covers the *inlined* code too.

Keep your authored, `require()`-using sources under a `src/`-style
directory separate from the signed, loadable output — the main repo's own
`transport/script/js/src/` vs. `transport/script/js/*.js` split is the
pattern to copy. **Never hand-edit the bundled output** — regenerate it
from source and re-sign.

## Key management, practically

- One keypair per trust domain (e.g., "scripts this exit trusts") is
  simplest. Multiple keys are supported (`--script-pubkey` is per-directory/
  per-invocation, not global), but don't reach for that until you actually
  need different trust levels for different transports.
- Rotating a key means re-signing every script under it and updating every
  node's `--script-pubkey`. There's no key-rotation protocol beyond that —
  plan for it being a manual, coordinated operation.
- A `.sig` (or `.flux`'s `package.sig`) with no matching valid public key
  configured anywhere is just an inert file — the loader errors out
  clearly (`script: <path>: signature verification failed`), it doesn't
  silently skip the check.

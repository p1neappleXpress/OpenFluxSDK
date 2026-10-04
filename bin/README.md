# Prebuilt binaries

Cross-compiled `scriptsign`, `scripttest`, and `scriptbundle` (from the main
repo's `transport/script/cmd/`), built from
the core's [`nightly`](https://github.com/p1neappleXpress/OpenFlux/tree/nightly) branch
with `CGO_ENABLED=0` — no runtime dependency beyond what's in the archive
you download.

| Platform | Directory |
|---|---|
| macOS (Apple Silicon) | `darwin-arm64/` |
| macOS (Intel) | `darwin-amd64/` |
| Linux x86-64 | `linux-amd64/` |
| Linux arm64 | `linux-arm64/` |
| Windows x86-64 | `windows-amd64/` |

Verify a download against `CHECKSUMS.txt` (SHA-256):

```bash
shasum -a 256 -c CHECKSUMS.txt   # macOS/Linux, run from this directory
```

On macOS/Linux you'll need to mark the binary executable after downloading
it outside of `git clone` (e.g. from a browser):

```bash
chmod +x scriptsign
```

`scripttest` has `-settings`, `-open`, `-submit` and `-lang` (see
[docs/07-settings-and-setup-pages.md](../docs/07-settings-and-setup-pages.md));
the binaries here are built from the same code as the guide describes.

These are a convenience for people who don't want to clone and build the
whole main repo just to sign or test a script. If you're actively developing
against `transport/script/`, building from source (`go run
./transport/script/cmd/scriptsign ...`) always reflects the latest code;
these binaries are rebuilt periodically from the same branch and may lag by
a commit or two.

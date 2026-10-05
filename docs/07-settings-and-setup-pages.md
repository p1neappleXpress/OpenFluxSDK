# Settings and setup pages

*[Читать на русском](ru/07-settings-and-setup-pages.md)*

A transport usually needs more from the user than one URL: a token, a region,
a retry count, sometimes a login that only a real page can do. OpenFlux gives
you two tools for that, and both end up as a page in the app's own browser:

|  | **Settings** | **Setup page** |
|---|---|---|
| What it is | You *declare* what can be tuned, in `info().params` | You *ask* for a page while running, with `raise()` |
| Who builds the page | OpenFlux (a wizard generated from your declaration) | You (inline HTML, a real site, or your own tiny server) |
| When it appears | The user taps **Настройки** on your transport | You decide: a login is needed, a captcha, a pairing |
| How values reach you | `cfg.params` in `open(cfg)`, every start | `onEvent("cookiesApplied")`, then `cookieJar.get()` |
| HTML to write | none | yes (or none, for a real site) |

Most transports only need **settings**. Reach for a **setup page** when the
transport cannot work until something happens in a browser.

Everything below is tested with the real core and the real app browser. The
last section shows how to try all of it on your own machine, with no app.

---

## 1. Settings in five minutes

Declare them in `info()`. That is all the code there is:

```js
info: function () {
  return {
    name: "my-transport",
    version: "1.0.0",
    params: [
      { key: "url",   label: "Document link", type: "url", required: true },           // the profile's field
      { key: "token", label: "API token", type: "secret", required: true },            // a setting
      { key: "retries", label: "Retries", type: "number", default: 3, min: 1, max: 10 },
      { key: "compress", label: "Compress", type: "boolean", default: false },
    ],
  };
},

open: async function (cfg) {
  var url = cfg.url;                        // what the user typed in the profile
  var token = cfg.params.token;             // a setting, always a string
  var retries = Number(cfg.params.retries); // "3" until the user changes it
  var compress = cfg.params.compress === "true";
  ...
}
```

Install the script in the app. Under **Транспорты**, your transport's card now
has a **Настройки** button. It opens a form built from your declaration, with
validation, a "defaults" button and a Save button. The same button is in the
profile editor when a profile uses your transport. The values are saved with the
script and you get them as `cfg.params` the next time the connection starts.

To see the wizard before touching an app:

```bash
scripttest -script my-transport.js -pubkey "$(cat dev.pub)" -settings -open
```

---

## 2. Declaring settings

### The profile's field and the settings

A profile has one value field next to the transport picker. That field is your
**first** param, and its value arrives as `cfg.url` **and** as
`cfg.params[key]` under its own key - the wizard asks for it too, right there
next to your other params, prefilled with whatever the profile field currently
holds. Edit it in the profile field or in the wizard, it is the one value
either way: an app may offer just the quick field, just the wizard, or both.
Every other param is a **setting**: it only shows in the wizard.

If your transport has no per-profile input at all (everything is a setting), say
so with `scope`:

```js
params: [
  { key: "token", label: "Token", type: "secret", required: true, scope: "settings" },
]
```

`scope` is `"profile"` or `"settings"`. Set `"profile"` on a later param to make
that one the profile's field instead of the first. One param can be the
profile's; a second `"profile"` becomes a setting. A transport with only one
param (the profile's) still gets a wizard now - just that one field - so it
never has to be a quick-field-only transport.

Read it either way in code; both always agree:

```js
open: function (cfg) {
  var token = cfg.params.token; // a setting, by key
  var board = cfg.url;          // the profile param, the old way
  var sameBoard = cfg.params.url; // the profile param, by key - works too
}
```

### The fields of a param

| field | meaning |
|---|---|
| `key` | The name you read it by. Required, unique. |
| `label` | What the user sees. Falls back to the key. |
| `type` | `text` (default), `url`, `secret`, `number`, `boolean`, `select`, `textarea`. An unknown type shows as `text`. |
| `required` | The wizard will not save while it is empty (not used for a boolean). |
| `default` | What `cfg.params` carries until the user sets something. A string, a number or a boolean. |
| `description` | Help text under the field. |
| `placeholder` | The grey hint inside the field. |
| `options` | A select's choices: `["a", "b"]` or `[{ value: "eu", label: "Europe" }]`. |
| `min`, `max` | Bounds of a `number`. |
| `pattern` | A regular expression a `text`/`url` value must match. Keep to the common subset: the page checks it as a JavaScript `RegExp`, the core as RE2. |
| `group` | A section title. Params with the same `group`, next to each other, sit under one heading. |
| `advanced` | Fold it under **Дополнительно**. |
| `scope` | `"profile"` or `"settings"`, see above. |

What each type looks like and what it checks:

| type | field | checked |
|---|---|---|
| `text` | one-line input | `pattern` |
| `url` | one-line input | must contain `://`, `pattern` |
| `secret` | password input with a show/hide button | not trimmed: spaces may be part of a secret |
| `number` | input accepting `3`, `2.5`, `2,5` | a number, `min`, `max` |
| `boolean` | switch | none |
| `select` | drop-down | one of `options` |
| `textarea` | multi-line input | `pattern`; not trimmed |

### What your script receives

- **Strings only.** A number is `"7"`, a boolean is `"true"` or `"false"`.
  Convert in `open()`. Text is trimmed (not `secret`, not `textarea`).
- **Defaults are filled in.** A setting with a `default` is in `cfg.params` even
  if the user never opened the wizard, so you need no `|| "3"` in code.
- **Empty means `""`.** An unset setting without a default is an empty string.
- **Core-owned keys.** `cfg.params` also carries `path`, `pubkey`, `name` and
  `exit` (a boolean: is this process the exit). A setting of the same name is
  ignored, it cannot shadow them. Do not declare a param with those keys.
- **Changes apply at the next connection.** The values are read when the
  transport starts. The wizard says so.

Every key you declare is kept; a page may not add others. (A custom page, below,
that declares no params at all can send any keys.)

### Check your declaration

Mistakes in a declaration never stop a script from loading; the apps fall back
to a plain text field. But they are easy to fix once you see them:

```bash
scripttest -script my-transport.js -pubkey "$(cat dev.pub)" -settings -duration 1s
# WARN  param "retries": min is greater than max
# WARN  param "mode": a select needs options
```

The same list is in `paramProblems` of the core's `--inspect-script` report. It
catches a missing key, a duplicate key, an unknown type, a select without
options, `min > max`, a pattern that does not compile, a default its own rules
refuse, and a bad `scope`.

---

## 3. The settings wizard

The wizard is one self-contained page: light and dark theme, validation as you
type, a red message under a bad field, **По умолчанию** (reset to your
defaults) and **Сохранить**. Required fields are marked `*`; `advanced` ones sit
under **Дополнительно**, which opens by itself if a field inside is invalid.

You write no HTML for it. If you want a page of your own instead, define
`Transport.settings(values)`:

```js
Transport.settings = function (values) {
  // values: the current settings as strings, with your defaults filled in.
  return '<!doctype html><title>My page</title><form>…</form>' +
         '<script>document.querySelector("form").onsubmit = function (e) {' +
         '  e.preventDefault(); openfluxSubmit({ token: document.querySelector("input").value });' +
         '};<\/script>';
}
```

The rules for `settings()`:

- It returns an HTML string, or `{ html: "…" }`. Nothing else is accepted.
- It runs **before anything about your script is trusted or connected**, so it
  runs like `info()` does: no network, no sockets, no cookies, three seconds,
  synchronous. A call to `http.fetch` or anything else that reaches out throws.
  The page itself may of course call out from the browser.
- The page is at most 512 KiB.
- The page hands the values back with `window.openfluxSubmit({...})` (section 5).
  What it sends is saved as your settings. If you also declared params, only the
  declared keys are kept.
- The wizard dialog closes when the page submits. Do your own validation in the
  page before you call `openfluxSubmit`.

A script with a custom page has a **Настройки** button even if it declares no
params.

---

## 4. Setup pages at run time

When the transport cannot go on until the user does something, ask the app to
show a page:

```js
raise("needsSetup",      { html: PAGE,                         reason: "Pair your account" });
raise("needsSetup",      { url: "https://service.example/login", reason: "Sign in" });
raise("captchaRequired", { url: "http://127.0.0.1:41234/",     reason: "Pair your account" });
```

`needsSetup` and `captchaRequired` do exactly the same; use the one that reads
better. You may raise from `open()` ("nothing is configured yet") or later.
Pass **either** `html` **or** `url`, never both.

### Three kinds of page

1. **A real site** (`url`, https). The user signs in or passes a check in the
   app's browser. The app collects the site's cookies and hands them to you.
2. **An inline page** (`html`). You build it; the app draws it. No network
   request is made for it. Its `fetch()` calls have no real origin; for those use:
3. **Your own server** (`url` on `http://127.0.0.1:<port>`). You start it with
   `httpserver.listen()`, the app opens it. A real origin, your own routes, an
   OAuth-style redirect to `http://127.0.0.1:<port>/callback`, whatever you need.

```js
var server = httpserver.listen(function (req) {
  if (req.path === "/") return { headers: { "Content-Type": "text/html; charset=utf-8" }, body: PAGE };
  if (req.path === "/api/check") return checkToken(req.query.token);   // may be async
  return { status: 404, body: "not found" };
});
raise("needsSetup", { url: "http://" + server.addr + "/", reason: "Pair your account" });
```

`examples/setup-own-server.js` is a complete one.

### What the core lets through

`raise()` for these two kinds checks its payload **in the core**, before any app
sees it, and throws a `TypeError` into your script when it is wrong. You find out
while writing, not in production.

| you raise | result |
|---|---|
| `url: "https://…"` | allowed |
| `html: "…"` (up to 512 KiB) | allowed |
| `url: "http://127.0.0.1:<port>/…"` where `<port>` is a server **you** started with `httpserver.listen()` and have not closed | allowed (also `localhost`, `[::1]`) |
| `http://` to anything else, a loopback port that is not yours, `http://127.0.0.1/` without a port | `TypeError` |
| `file:`, `javascript:`, `data:`, any other scheme | `TypeError` |
| `html` and `url` together | `TypeError` |
| a page over 512 KiB | `TypeError` (serve it with `httpserver.listen()`) |

`reason` is clipped to 200 characters. For **your own page** (html or your own
server) the app shows it as the **title of the dialog**: write a short human
phrase ("Pair your account"). For a real site's check it is a code
(`"login"`, `"smartcaptcha"`) the app words itself.

On an **exit node** only inline `html` can be shown to the client. An `http://`
address on the exit's loopback means nothing on the client's machine, so the
client's core drops it.

### Getting the answer

Whatever the user submits comes back to your own handler, the same route a
solved captcha's cookies always took:

```js
onEvent: function (kind, payload) {
  if (kind === "cookiesApplied") {
    var values = cookieJar.get();          // {token: "…", …}: what the page submitted
    ...
  }
}
```

`cookieDomain` in `info()` (any `https://…/` URL) decides where the values are
kept in your jar; without it a default is used, and reading them back with
`cookieJar.get()` works either way. The core also keeps them in its cookie store
(a plain JSON file next to the app's data, like the cookies of a solved captcha)
and puts them back into your jar **before `open()` runs** on the next start, so
the user does not repeat the setup: check `cookieJar.get()` at the top of `open()`
and skip the page when what you need is already there (see
`examples/setup-own-server.js`). Nothing about this cares whether the values are
real cookies or your own fields.

While a setup page is open the transport is treated as waiting: the core routes
around it. The user can also close the dialog with **Позже**; if you still need
the setup, raise it again after a sensible pause (not in a tight loop).

---

## 5. `window.openfluxSubmit`

Every setup page and settings page the app shows can call:

```js
window.openfluxSubmit({ token: "abc", port: 8080, remember: true });
```

- The payload is a **flat object**, or `{ client: {…}, node: {…} }` (only the
  `client` half is delivered today; `node` goes nowhere yet).
- Values become **strings**: a string stays, a number or `true`/`false` becomes
  its text. `null`, objects and arrays are dropped; send `JSON.stringify(x)` if
  you need structure.
- At least one value must remain, or the app refuses it.
- It returns nothing. Do not wait for it or rely on a return value.
- Calling it **ends** the page: the app delivers the values and closes the dialog.

### When it exists

- On an **inline page** (`html`) the function is there **before your page's own
  scripts run**. You can use it at once.
- On a page **from your own server** it is added once the page has loaded. Call
  it from event handlers (a click, a form submit), which is natural. If you must
  call it at load, check `typeof window.openfluxSubmit === "function"` and
  otherwise wait for the event:

```js
window.addEventListener("openflux-ready", function () { /* openfluxSubmit exists now */ });
```

- Opened in an ordinary browser (while you design the page) it does not exist.
  Guard the call so the page still works there.

### It stays with your page

The function belongs to your page's own address. If the page links to another
site, or your own page is left for another origin, what that site sends is
dropped: another page cannot hand data to your script. A normal website opened
as a check (kind 1) never gets the function at all.

---

## 6. Try it without an app

`scripttest` plays the app for you.

### The settings wizard

```bash
scripttest -script my-transport.js -pubkey "$(cat dev.pub)" -settings -open
```

It prints the page address (and `-open` opens it in your browser), shows your
declaration's problems as `WARN` lines, and when you press Save prints exactly
what your script would get:

```
[21:24:03] SAVED, the script would get as cfg.params:
{
  "compress": "true",
  "retries": "5",
  "token": "s3cr#t;1"
}
```

Flags: `-param "k=v,k2=v2"` prefills values, `-lang ru|en` picks the words the page
adds, `-duration` is how long to wait (it stops at the first valid Save).

### A setup page while the transport runs

Run the script as usual. When it raises a setup page, `scripttest`

- serves your page on `127.0.0.1` with `window.openfluxSubmit` in it (an inline
  page gets it before its scripts; a page from your own server is reached
  through `scripttest`, which adds it, so the page is the same as in the app),
- prints the address (`-open` shows it in your browser),
- and delivers what the page submits to your `onEvent("cookiesApplied")`.

```bash
scripttest -script setup-own-server.js -pubkey "$(cat dev.pub)" \
  -url "wss://ws.postman-echo.com/raw" -open -duration 120s
```

For a real site's check (kind 1) a command line cannot collect the site's cookies:
pass them with `-cookies-file`.

### Unattended: `-submit`

```bash
scripttest -script setup-own-server.js -pubkey "$(cat dev.pub)" \
  -url "wss://ws.postman-echo.com/raw" -submit '{"token":"tok-1234"}' -duration 10s
```

`-submit` answers the first setup page as if a user had filled it in, so a script
can be exercised in CI with nobody there.

### In the app

Add your transport to a profile, then open its **Настройки** right there (next
to the quick field, if it has one - both edit the same value). For a run-time
page, connect that profile. What is saved belongs to that profile/carrier, not
to the installed script: two profiles using the same script keep their own
values (a plain JSON file on the device, like the cookie store: do not rely on
it to keep a secret). The Desktop app passes them to the core as a single
encoded line, because a `.conf` value ends at `#` and `;`, which a setting may
contain; you never see that.

---

## 7. Good to know

- **Old scripts keep working.** A script that declares only `key`, `label`,
  `type` and `required` is read as before: the first param is the profile's
  field, the others are settings. An app that predates the wizard ignores the
  new fields and shows only the first param.
- **Settings are per device.** They are not part of an `openflux://` link; a
  script transport is not shareable by link.
- **Do not put secrets in `default`.** A default is plain text in your public
  script.
- **The page is a web page.** Your own page and your own server run in the app's
  browser; they are as trusted as your script (which is signed), but the page can
  call any site the browser can. Keep tokens out of URLs you log.
- **The server is loopback only.** `httpserver.listen()` has no host argument:
  nothing off the device can reach it. Close it (`server.close()`) when the setup
  is done; it is closed for you when the transport stops.
- **A node cannot use the wizard yet.** Settings are for the script that runs on
  the client. Installing a script on an exit node over SSH is not built.

## Reference

### `info().params[]`

`key`, `label`, `type`, `required`, `scope`, `default`, `description`,
`placeholder`, `options`, `min`, `max`, `pattern`, `group`, `advanced`.
Section 2 explains each.

### `Transport.settings(values) → string | { html }`

Optional. A settings page of your own. Section 3.

### `raise("needsSetup" | "captchaRequired", { html | url, reason })`

Section 4. Throws `TypeError` for a page the core will not pass on.

### `window.openfluxSubmit(payload)` and the `openflux-ready` event

Section 5.

### `scripttest`

| flag | meaning |
|---|---|
| `-settings` | open the settings wizard instead of running the script |
| `-open` | show raised setup pages (and the wizard) in your browser |
| `-submit '<json>'` | answer the first setup page with this payload |
| `-param "k=v,…"` | `cfg.params` (and the wizard's prefill) |
| `-lang ru\|en` | the words the generated wizard adds |
| `-cookies-file` | cookies for a real site's check |

// A transport that must be paired with an account before it can connect, and
// does it with a page of its own: open() finds nothing saved, starts its own
// little web server (httpserver.listen, always on 127.0.0.1) and asks the app
// to show it. The page checks the token against the script's own /api/check
// route, then calls window.openfluxSubmit({token}); the app hands that to
// onEvent("cookiesApplied") and the script carries on.
//
// Try it with no app at all:
//   scriptsign genkey dev.key dev.pub && scriptsign sign dev.key setup-own-server.js
//   scripttest -script setup-own-server.js -pubkey "$(cat dev.pub)" \
//     -url "wss://ws.postman-echo.com/raw" -open -duration 120s
// (-open shows the page in your browser; or answer it yourself with
//  -submit '{"token":"tok-1234"}' to see the whole flow run unattended.)
//
// Guide: docs/07-settings-and-setup-pages.md

var server = null;
var sock = null;
var running = false;
var url = "";

var PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Pair account</title><style>body{font:16px system-ui;margin:0;padding:24px;max-width:480px}' +
  'input,button{font:inherit;padding:10px 12px;width:100%;box-sizing:border-box;margin-top:8px}.err{color:#c62828}</style></head><body>' +
  '<h1>Pair your account</h1><p>Paste the token from your account page.</p>' +
  '<input id="t" placeholder="tok-…" autocomplete="off"><div id="e" class="err"></div>' +
  '<button id="go">Pair</button>' +
  '<script>' +
  'document.getElementById("go").onclick = function () {' +
  '  var t = document.getElementById("t").value.trim();' +
  '  fetch("/api/check?token=" + encodeURIComponent(t)).then(function (r) { return r.json(); }).then(function (j) {' +
  '    if (!j.ok) { document.getElementById("e").textContent = j.error; return; }' +
  // The app defines window.openfluxSubmit once this page has loaded. It hands the values to the script
  // and closes the dialog. (Guard it so the page also works in a plain browser while you design it.)
  '    if (window.openfluxSubmit) window.openfluxSubmit({ token: t }); else document.getElementById("e").textContent = "Not inside the app";' +
  '  });' +
  '};' +
  '</script></body></html>';

function connect() {
  var token = cookieJar.get().token;                  // what the page submitted, and what the app keeps for next time
  setState("connecting");
  return ws.open(url).then(function (s) {
    sock = s;
    sock.onmessage = function (data) { emit(typeof data === "string" ? text.encode(data) : data); };
    sock.onclose = function (reason) { sock = null; if (running) setState("reconnecting", String(reason)); };
    console.log("paired with token " + token.slice(0, 4) + "…");
    setState("connected");
  }).catch(function (e) { setState("dead", String(e)); });
}

var Transport = {
  info: function () {
    return {
      name: "setup-own-server",
      version: "1.0.0",
      cookieDomain: "https://example.com/",
      params: [{ key: "url", label: "WebSocket URL", type: "url", required: true }],
    };
  },

  open: function (cfg) {
    running = true;
    url = cfg.url;
    if (cookieJar.get().token) return connect();      // paired before

    server = httpserver.listen(function (req) {
      if (req.path === "/") return { headers: { "Content-Type": "text/html; charset=utf-8" }, body: PAGE };
      if (req.path === "/api/check") {
        // A real transport would ask its service here (the handler may be async: http.fetch works).
        var ok = /^tok-[0-9a-z]{4,}$/.test(req.query.token || "");
        return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(ok ? { ok: true } : { ok: false, error: "That does not look like a token" }) };
      }
      return { status: 404, body: "not found" };
    });
    setState("connecting");
    // The title of the dialog is `reason`. The address must be this server's own (the core refuses anything else).
    raise("needsSetup", { url: "http://" + server.addr + "/", reason: "Pair your account" });
  },

  onEvent: function (kind) {
    if (kind !== "cookiesApplied") return;
    if (server) { server.close(); server = null; }    // setup is done
    connect();
  },

  write: function (bytes) {
    if (!sock) throw new Error("not connected");
    sock.send(bytes);
  },

  close: function () {
    running = false;
    if (server) { try { server.close(); } catch (e) {} server = null; }
    if (sock) { try { sock.close(); } catch (e) {} sock = null; }
  },
};

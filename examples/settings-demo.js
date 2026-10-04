// A transport that declares its settings: the app builds the "Настройки"
// wizard from info().params, the user fills it in, and the values arrive in
// open(cfg) as cfg.params. No HTML to write.
//
// It is the echo transport (see echo-transport.js) with five settings, one of
// each kind you will use most. The first param (scope "profile") is the one
// field the profile editor shows and arrives as cfg.url; the rest are settings.
//
// See the wizard without any app (it opens in your browser, prints what Save
// would hand to the script):
//   scriptsign genkey dev.key dev.pub
//   scriptsign sign dev.key settings-demo.js
//   scripttest -script settings-demo.js -pubkey "$(cat dev.pub)" -settings -open
//
// Run it with settings, as the app would start it:
//   scripttest -script settings-demo.js -pubkey "$(cat dev.pub)" \
//     -url "wss://ws.postman-echo.com/raw" -param "token=abc,pingSeconds=5" -duration 15s -send hello
//
// Guide: docs/07-settings-and-setup-pages.md

var sock = null;
var running = false;
var pingTimer = null;

var Transport = {
  info: function () {
    return {
      name: "settings-demo",
      version: "1.0.0",
      params: [
        // The profile's own input: shown in the profile editor, delivered as cfg.url.
        { key: "url", label: "WebSocket URL", type: "url", required: true, scope: "profile" },

        // Settings: shown in the wizard, delivered in cfg.params (always as strings).
        { key: "token", label: "API token", type: "secret", required: true, group: "Account",
          description: "Optional for the echo server; a real service would need it." },
        { key: "region", label: "Region", type: "select", group: "Account", default: "eu",
          options: [{ value: "eu", label: "Europe" }, { value: "us", label: "United States" }, "asia"] },

        { key: "pingSeconds", label: "Keep-alive, seconds", type: "number", default: 20, min: 5, max: 120,
          group: "Behaviour", description: "How often an idle connection is pinged." },
        { key: "compress", label: "Compress payloads", type: "boolean", default: false, group: "Behaviour" },

        // Tucked under "Дополнительно".
        { key: "tag", label: "Label for the logs", type: "text", pattern: "^[a-z0-9-]+$", advanced: true,
          placeholder: "my-link", description: "Lowercase letters, digits and dashes." },
        { key: "notes", label: "Notes", type: "textarea", advanced: true },
      ],
    };
  },

  open: async function (cfg) {
    running = true;
    // Declared defaults are already filled in: pingSeconds is "20" if the user never opened the wizard.
    var p = cfg.params;
    var every = Number(p.pingSeconds) * 1000;
    var compress = p.compress === "true";          // a boolean is "true" or "false"
    console.log("settings-demo: region=" + p.region + " ping=" + every + "ms compress=" + compress + " tag=" + (p.tag || "-"));

    setState("connecting");
    try {
      sock = await ws.open(cfg.url);
      sock.onmessage = function (data) { emit(typeof data === "string" ? text.encode(data) : data); };
      sock.onclose = function (reason) { sock = null; if (running) setState("reconnecting", String(reason)); };
      pingTimer = setInterval(function () { if (sock) { try { sock.send(text.encode("")); } catch (e) {} } }, every);
      setState("connected");
    } catch (e) {
      setState("dead", String(e));
    }
  },

  write: function (bytes) {
    if (!sock) throw new Error("not connected");
    sock.send(bytes);
  },

  close: function () {
    running = false;
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (sock) { try { sock.close(); } catch (e) {} sock = null; }
  },
};

// The smallest possible working transport: a WebSocket echo connection.
//
// No auth, no framing tricks, no reconnect edge cases - just enough to see
// the five-function contract (info/open/write/close/onEvent) actually run
// end to end. Read this after templates/template.js, before attempting a
// real protocol port; see docs/02-creating-a-transport.md for the full
// walkthrough this is a stripped-down version of.
//
// Test it:
//   go run ./transport/script/cmd/scriptsign genkey dev.key dev.pub
//   go run ./transport/script/cmd/scriptsign sign dev.key echo-transport.js
//   go run ./transport/script/cmd/scripttest \
//     -script echo-transport.js -pubkey "$(cat dev.pub)" \
//     -url "wss://ws.postman-echo.com/raw" -duration 15s -send "hello"
//
// Postman's public echo endpoint sends back whatever it receives, so a
// successful run shows your own "hello" packet come back as a RECV line.

var sock = null;
var running = false;

var Transport = {
  info: function () {
    return {
      name: "echo-transport",
      version: "1.0.0",
      params: [
        { key: "url", label: "WebSocket URL", type: "url", required: true },
      ],
    };
  },

  open: async function (cfg) {
    running = true;
    setState("connecting");
    try {
      sock = await ws.open(cfg.url || cfg.params.url);
      sock.onmessage = function (data) {
        // data is a string for a text frame, ArrayBuffer for binary - the
        // echo server mirrors whichever kind we sent, so just re-wrap text
        // as bytes before handing it to emit().
        emit(typeof data === "string" ? text.encode(data) : data);
      };
      sock.onclose = function (reason) {
        sock = null;
        if (running) setState("reconnecting", String(reason));
      };
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
    if (sock) {
      try { sock.close(); } catch (e) {}
      sock = null;
    }
  },

  onEvent: function (kind, payload) {},
};

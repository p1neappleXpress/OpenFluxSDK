# Справочник по host API

*[Read in English](../03-host-api-reference.md)*

Каждая функция/объект здесь — **глобальный**: никакого `require()`, никакого
импорта. Ничто не ограничено по возможностям: проверка подписи вашего файла
— единственный барьер. Этот справочник соответствует
`transport/script/host.go`, `transport/script/host_webrtc.go` и
`transport/script/host_httpserver.go` в основном репозитории — движок
живёт в ветке `nightly` ядра (что уже попало в стабильный релиз, смотрите в
`CHANGELOG.md` ядра); всё описанное здесь — реально работающий код, а не план.

## HTTP

### `http.fetch(opts) -> Promise<{status, url, body, headers}>`

```js
var res = await http.fetch({
  url: "https://example.com/page",
  method: "GET",              // default "GET"
  headers: { "User-Agent": "..." },
  body: "form=data",          // string
  redirect: "manual",         // default "follow"
});
```

- `res.url` — **финальный** URL после редиректов (когда `redirect` равен
  `"follow"`, по умолчанию). Сравните его с тем, что вы запросили, чтобы
  обнаружить скрытый переход на страницу входа/капчи.
- `redirect: "manual"` останавливает автоматическое следование Go за
  3xx-ответами, так что вы видите сам редирект и его заголовок `Location` —
  нужно везде, где надо посмотреть, *куда* ведёт цепочка редиректов
  (обнаружение капчи почти всегда строится на этом).
- `res.headers` — обычный объект, одно значение на имя заголовка (не массив
  — если заголовок повторяется, вы получаете последний, как у Go
  `Header.Get`).

### `http.newSession() -> Session`

```js
var session = http.newSession();
var res = await session.fetch({ url: "..." });
session.cookies.set("https://example.com/", { sid: "abc" });
var cookies = session.cookies.get("https://example.com/");
```

**Изолированная** пара из cookie jar + `http.Client`, использующая тот же
dialer и настройки пула соединений, что и стандартная сессия. Используйте
это, когда управляете несколькими независимыми логическими сессиями к
*одному и тому же домену* — имена куки пересекаются между сессиями на одном
домене, поэтому один общий jar позволил бы последнему вызову `authorize()`
незаметно затереть куки всех предыдущих сессий. (Четыре независимые комнаты
в `cupsonline.js` — референсный пример: каждая получает свою сессию.)

В отличие от глобального `cookieJar` (ниже), `session.cookies.get/set`
принимают URL **явно** при каждом вызове — у произвольной сессии нет одного
фиксированного домена по умолчанию.

## HTTP-сервер (мини-приложение настройки/входа)

### `httpserver.listen(handler, port?) -> {port, addr, close()}`

```js
var server = httpserver.listen(function (req) {
  // req: {method, path, query, headers, body}  (body: ArrayBuffer; text.decode(req.body) даёт строку)
  if (req.path === "/") {
    return { status: 200, headers: { "Content-Type": "text/html" }, body: SETUP_PAGE_HTML };
  }
  return { status: 404, body: "not found" };
});
// server.port, server.addr ("127.0.0.1:<port>"); server.close() когда закончите.
```

Собственный HTTP-сервер — на случай, когда статической страницы (см.
`raise("needsSetup", ...)` ниже) не хватает: нужно настоящее мини-приложение
со своими маршрутами, или страница должна делать `fetch()` с настоящим
origin вместо нулевого origin у встроенной/`data:`-страницы. Обработчик
может быть **синхронным или асинхронным** — вернуть обычный объект или
`Promise`, который разрешится в такой объект; работает одинаково:

```js
var server = httpserver.listen(async function (req) {
  if (req.path === "/check") {
    var res = await http.fetch({ url: "https://example.com/api/status" });
    return { status: 200, headers: { "Content-Type": "application/json" }, body: res.body };
  }
  return { status: 404, body: "not found" };
});
```

Исключение (синхронное или асинхронное) становится ответом 500 с текстом
ошибки в теле — транспорт при этом не падает.

**Сервер всегда доступен только с loopback-адреса.** Параметра host не
существует вовсе — `listen()` биндится на `127.0.0.1` конструктивно, а не
через проверку в рантайме, которую можно было бы ошибочно обойти, поэтому
сервер настройки физически не может стать доступным с другого устройства.
Закройте его (`server.close()`), когда поток настройки завершён — сам по
себе он не закрывается до остановки транспорта.

## WebSocket

### `ws.open(url, headers?, opts?) -> Promise<Socket>`

```js
var sock = await ws.open("wss://example.com/socket", { Origin: "https://example.com" }, { readTimeoutMs: 60000 });
sock.onmessage = function (data) { /* string for a text frame, ArrayBuffer for binary */ };
sock.onclose = function (reason) { /* reason: string */ };
sock.send("text frame");
sock.send(bytesArrayBuffer); // binary frame
sock.close();
```

- `opts.readTimeoutMs`: сбрасывается перед каждым чтением. Соединение,
  замолчавшее дольше этого времени, вызывает `onclose` вместо того, чтобы
  вечно висеть на чтении в горутине. Пропущено или `0` = без дедлайна
  (большинству транспортов он не нужен; нужен тем, что говорят с сервером
  без прикладного ping/pong).
- Присваивайте `onmessage`/`onclose` в любой момент после разрешения
  `open()` — они читаются лениво при каждой доставке, так что переназначить
  их посреди соединения — нормально (полезно для переподключения, которое
  подменяет обработчики).
- `send` автоматически определяет байтовые данные (`ArrayBuffer`/
  `TypedArray`) против строки и отправляет соответственно бинарный или
  текстовый фрейм.

## UDP

### `udp.open(remoteAddr, opts?) -> Promise<Socket>`

Тот же вид `Socket`, что и у `ws.open` (`send`/`onmessage`/`onclose`/
`close`). Только dial — подключённый сокет к одному фиксированному
удалённому адресу, а не слушающий откуда угодно сокет (ничего из
выпущенного пока в этом не нуждалось). `opts.readTimeoutMs` — та же
семантика, что у WebSocket.

## WebRTC

### `webrtc.newPeerConnection({iceServers, iceTransportPolicy}) -> PeerConnection`

```js
var pc = webrtc.newPeerConnection({
  iceServers: [{ urls: ["turn:turn.example.com:3478"], username: "u", credential: "p" }],
  iceTransportPolicy: "relay", // optional; omit for the default (all candidate types)
});

pc.onicecandidate = function (c) { /* c: {candidate, sdpMid, sdpMLineIndex} or null when gathering completes */ };
pc.onconnectionstatechange = function (state) { /* "new"|"connecting"|"connected"|"disconnected"|"failed"|"closed" */ };
pc.oniceconnectionstatechange = function (state) { /* ICE-specific state */ };
pc.ondatachannel = function (dc) { /* remote peer created a channel */ };

var dc = pc.createDataChannel("label", { ordered: true, maxRetransmits: 0 });

var offerSdp = await pc.createOffer();
await pc.setLocalDescription("offer", offerSdp);
// ... send offerSdp to the other side over YOUR signaling channel ...

// on receiving a remote description over your signaling channel:
await pc.setRemoteDescription("offer" /* or "answer" */, remoteSdp);

// on receiving a remote ICE candidate over your signaling channel:
await pc.addIceCandidate({ candidate: "candidate:...", sdpMid: "0", sdpMLineIndex: 0 });

pc.close();
```

```js
dc.onopen = function () {};
dc.onclose = function () {};
dc.onmessage = function (bytes) { /* always ArrayBuffer */ };
dc.send(bytesOrString);
dc.close();
```

Сбор ICE-кандидатов/DTLS/SCTP обрабатывается нативной стороной
(pion/webrtc) — эту часть реально невозможно реализовать в JS. **Всё, что
выше этого уровня, — ваше**: как вы обмениваетесь SDP/кандидатами с другой
стороной (свой собственный протокол сигнализации, через
`http.fetch`/`ws.open`/что угодно, что использует настоящая цель), когда
предлагать offer, а когда отвечать answer, политика повторов/таймаутов.
`oneme-webrtc.js` в основном репозитории — референсная реализация: он
сигнализирует через обычный канал установки звонка на WebSocket и управляет
именно этим API.

Есть один нюанс, который стоит знать перед тем, как строить локальный тест
с двумя пирами: **goja разворачивает цепочку `.then` уже разрешённого
promise синхронно**, как часть того самого нативного вызова из Go, который
его разрешил — а не откладывает на следующий тик event loop, как можно было
бы ожидать от настоящей асинхронной семантики. Если вы напрямую соединяете
два `ScriptTransport` в тесте (передавая события `raise()` между ними),
*второй* транспорт должен быть уже запущен до того, как логика подключения
из `open()` первого транспорта выполнится — иначе вызов `Deliver()`
попадёт на транспорт, у которого ещё не существует цикла обработки.
Подробнее про конкретный сбой из-за этого и почему он происходит — в
[06-lessons-learned.md](06-lessons-learned.md).

## Куки

### `cookieJar.get() -> {name: value, ...}` / `cookieJar.set(values, domain?)`

Читает/пишет относительно `info().cookieDomain`. Это тот же jar, который
уже использует и автоматически обновляет `http.fetch` (стандартная сессия)
— вам редко нужен `cookieJar.set` самому; он существует в основном для
потока `onEvent("cookiesApplied", ...)` (решённая вне канала капча,
переданная обратно вам — см. [06](06-lessons-learned.md) про нюанс со
скоупингом между поддоменами).

## Кодеки

```js
base64.encode(bytes) -> string          // bytes: ArrayBuffer/TypedArray
base64.decode(str)   -> ArrayBuffer

text.encode(str)   -> ArrayBuffer       // UTF-8
text.decode(bytes) -> string

gzip.compress(bytes)   -> ArrayBuffer
gzip.decompress(bytes) -> ArrayBuffer

lz4.decompressBlock(bytes, expectedSize) -> ArrayBuffer
```

`lz4` — это формат **block** (нужен размер после распаковки заранее — у
LZ4-блоков нет маркера конца потока), а не streaming/frame формат. Если
ваша цель отправляет LZ4-сжатые данные с префиксом размера где-то в
handshake/метаданных, именно это их декодирует.

Сама граница пакетов Go↔JS (`write()`/`emit()`) — это **всегда** raw-байты
— эти кодеки нужны только тогда, когда собственный формат кадров *вашего*
протокола на проводе нуждается в тексте/сжатии (поле курсора в base64,
блоб отпечатка в gzip, ...).

## Криптография

```js
crypto.sha256(bytes) -> ArrayBuffer
crypto.solvePow(prefixHexOrRaw, complexity) -> { nonceHex, attempts }
```

`solvePow` перебирает 16-байтный nonce, пока `sha256(nonce || prefix)` не
получит `complexity` ведущих нулевых бит — единственное намеренное
исключение со «скоростью на уровне Go» во всём API. Задача
proof-of-work на основе хеша может требовать миллионы попыток; платить
вызовом JS↔Go за каждую попытку затмило бы стоимость самого хеша. Больше
ничто в этом API так не обрабатывается — если вам кажется, что вашему
транспорту нужно ещё одно такое исключение, это настоящий архитектурный
вопрос, а не то, что делается по умолчанию.

## Конкурентность

```js
var pool = concurrency.pool(n);
var result = await pool.run(function () {
  return someAsyncWork(); // e.g. an http.fetch call
});
pool.size(); // current in-flight count
```

Ограничивает не более `n` одновременных выполняющихся вызовов `run()`
через семафор на стороне Go. Переданная вами функция всё равно выполняется
с **настоящей конкурентностью уровня ОС** (`http.fetch` внутри неё работает
в своей горутине точно так же, как любой другой fetch) — этот примитив
только добавляет учёт ограниченного fan-out. Сам goja однопоточен; это
способ получить настоящую параллельную пропускную способность вместо
имитации N воркеров внутри одного интерпретатора. `vyandex.js`
(`concurrency.pool(64)`) — референс; см. заголовок этого файла, почему
именно 64, а не больше, — правильный выбор, когда реальная конкурентность
берётся отсюда, а не от подсчёта воркеров в JS.

Совмещайте это с `httpMaxConnsPerHost`/`httpMaxIdleConns`/
`httpIdleConnTimeoutMs` из `info()`, если вы разгоняете много параллельных
запросов — стандартный пул HTTP-транспорта Go (2 незанятых соединения на
хост) иначе станет бутылочным горлышком для транспорта, управляемого
`concurrency.pool`.

## Разное

```js
url.parse(str) -> { href, protocol, hostname, host, pathname, search, hash }
```

У goja нет глобального `URL` по стандарту WHATWG; это реализовано через
`net/url` Go. Используйте это вместо самодельных regex для манипуляций с
URL цепочки редиректов.

`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`,
`console.log`/`warn`/`error` — стандартные, выполняются в собственном event
loop этого транспорта.

`require("./local/module.js")` — **только на этапе авторства**. См.
[04-signing-and-packaging.md](04-signing-and-packaging.md) — рантайм
никогда не загружает модуль с диска; инструмент сборки (`scriptbundle`)
встраивает локальные `require()` в один плоский файл до того, как вы его
подпишете.

## Граница пакетов Go↔JS

```js
emit(bytes)              // отдать один полученный пакет приложения наверх.
                          // bytes: ArrayBuffer/TypedArray, без копирования.
setState(state, errMsg?) // state: "connecting"|"connected"|"reconnecting"|
                          //        "degraded"|"dead"
raise(kind, payload)     // восходящее внеполосное событие, любой kind, напр.
                          // raise("captchaRequired", {url: "...", location: "..."})
onEvent(kind, payload)   // нисходящее: приложение отвечает на ваш raise(),
                          // либо "cookiesApplied" (ниже)
```

`setState("connected")`/`setState(что угодно другое)` — **единственный**
способ, которым `IsConnected()` на Go-стороне вообще меняется — другого
сигнала нет. Ошибитесь здесь (вызовите слишком рано или вообще не
вызовите) — и ядро либо решит, что вы подключены, когда это не так, либо
никогда не станет маршрутизировать через вас трафик вовсе.

### `raise(kind, payload)`, доходящий до браузера приложения

Любой `kind` доходит до вашего собственного `onEvent`, если кто-то его
зарегистрировал на стороне приложения (это общий механизм, никаких
специальных kind'ов здесь нет). Два написания дополнительно доходят до настоящего
UI капчи/входа приложения (настоящий диалог с браузером, а не просто колбэк):

```js
raise("captchaRequired", { url: "https://real-site.example/check", reason: "smartcaptcha" });
raise("needsSetup",      { html: SETUP_PAGE_HTML,                   reason: "Привяжите аккаунт" });
raise("needsSetup",      { url: "http://" + server.addr + "/",       reason: "Привяжите аккаунт" });
```

- `captchaRequired` и `needsSetup` обрабатываются одинаково — берите то имя,
  которое лучше читается. Передавайте **либо** `url`, **либо** `html`.
- **Своя страница** — это встроенный `html` или адрес `http://127.0.0.1:<порт>`
  сервера, который **вы** запустили через `httpserver.listen()`. Приложение
  показывает её как есть, даёт ей `window.openfluxSubmit` и не собирает с неё куки;
  `reason` становится заголовком диалога. **Настоящий сайт** — это URL `https://`:
  приложение собирает его куки.
- **Ядро проверяет payload и бросает `TypeError` в ваш скрипт** для всего
  остального: другой адрес `http://`, чужой loopback-порт (или закрытый вами),
  `file:`, `javascript:`, `data:`, `html` вместе с `url`, страница больше 512 КиБ.
  `reason` обрезается до 200 символов.
- Ответ возвращается одним и тем же путём: ответ пользователя доставляется в
  `ApplyCookies` (куки с настоящей страницы или payload `window.openfluxSubmit`),
  который вызывает `onEvent("cookiesApplied", values)` в вашем скрипте — читайте
  `values` через `cookieJar.get()` в этом обработчике (см.
  [templates/template.js](../../templates/template.js)). Неважно, настоящие это
  куки или ваши собственные поля.
- `window.openfluxSubmit(payload)` принимает плоский объект или
  `{client: {...}, node: {...}}` (доставляется только `client`), значения
  становятся строками (null, объекты и массивы отбрасываются), и должно остаться
  хотя бы одно значение. Когда функция есть на странице и как она остаётся с
  адресом вашей страницы — см. [07](07-settings-and-setup-pages.md#5-windowopenfluxsubmit).

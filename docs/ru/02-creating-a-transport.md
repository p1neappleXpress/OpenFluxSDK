# Создание транспорта

*[Read in English](../02-creating-a-transport.md)*

Здесь пошагово разбирается написание настоящего (хоть и игрушечного)
транспорта от начала до конца: авторизация через HTTP, WebSocket для
самого канала, переподключение при разрыве и тестирование на реальной
цели. Предполагается, что вы уже прочитали
[01-overview.md](01-overview.md).

## 0. Определите, какой протокол вы реализуете

Прежде чем писать что-либо: что *реально* делает настоящий клиент этого
протокола на проводе? Откройте настоящий сайт/приложение, посмотрите его
сетевой трафик (обычно достаточно вкладки Network в devtools браузера) и
отметьте:

- Как выглядит последовательность авторизации/handshake? Куки? Токен в
  редиректе? Капча, которую нужно будет обрабатывать?
- Какой формат кадров сообщений после подключения? Обычные WebSocket-фреймы?
  Socket.IO-стиль `42["event",{...}]`? Собственный бинарный формат?
- Куда реально помещается *ваша* полезная нагрузка? Почти каждый из
  выпущенных транспортов переносит данные в поле, которое у настоящего
  протокола уже есть (строка позиции курсора, «ICE candidate», сообщение
  чата) — найдите такое поле для своего целевого протокола.
- Какая реалистичная скорость и размер пакетов? От этого зависит, нужен ли
  вам `concurrency.pool` (см. [03](03-host-api-reference.md)) или подойдут
  обычные последовательные `await`.

Пропустить этот шаг и угадывать протокол — самая большая потеря времени,
замеченная при создании существующих семи транспортов. Каждый из них был
достоверным портом уже понятого формата на проводе, а не реализацией с нуля.

## 1. Начните с шаблона

```bash
cp OpenFluxSDK/templates/template.js OpenFlux/transport/script/js/my-transport.js
```

Прочитайте `info()`, `open()`, `write()`, `close()`, `onEvent()` в
комментариях шаблона — это настоящий контракт, а не заполнитель.

## 2. `info()` — объявите, что вы такое

```js
info: function () {
  return {
    name: "my-transport",
    version: "1.0.0",
    cookieDomain: "https://example.com/",
    params: [
      { key: "url", label: "Room URL", type: "url", required: true },
    ],
  };
},
```

`name` — единственное обязательное поле. Всё остальное либо рекомендательное
(MTU/reliable/ordered — ядро не фрагментирует и не переупорядочивает за вас,
если вы этого не попросите), либо чисто декларативное для построения формы
UI/CLI (`params`).

## 3. `open()` — авторизация, затем подключение

```js
var sock = null;
var running = false;

async function connectOnce(cfg) {
  var res = await http.fetch({ url: cfg.params.url, headers: { "User-Agent": "Mozilla/5.0" } });
  if (res.status !== 200) throw new Error("http " + res.status);

  var m = /"wsUrl":"([^"]+)"/.exec(res.body);
  if (!m) throw new Error("wsUrl not found in page");

  sock = await ws.open(m[1], { Origin: "https://example.com" });
  sock.onmessage = handleMessage;
  sock.onclose = onSocketClose;
  setState("connected");
}

var Transport = {
  info: function () { /* ... */ },
  open: function (cfg) {
    running = true;
    setState("connecting");
    connectOnce(cfg).catch(function (e) {
      setState("dead", String(e));
      scheduleReconnect(0);
    });
  },
  // ...
};
```

Что этот пример делает правильно:

- **`open()` возвращает управление немедленно.** Реальная работа по
  подключению выполняется как асинхронная цепочка, за которой Go-сторона не
  следит. Это отражает то, как `Start()` нативного транспорта возвращается
  до того, как соединение реально установлено.
- **`setState` — единственный сигнал для Go-стороны.** `IsConnected()` на
  Go-стороне управляется *исключительно* вашими вызовами
  `setState("connected")` — и ничем другим. Если вы никогда его не
  вызовете, транспорт будет выглядеть постоянно отключённым, что бы там ни
  происходило с вашим сокетом.
- **Ошибки идут в `scheduleReconnect`, а не в никуда.** Ядро не повторяет
  неудавшийся `open()` за вас. Пишите свою собственную политику backoff
  (экспоненциальный с джиттером — то, что делает каждый выпущенный
  транспорт; см. любую из их функций `reconnectBackoff` как готовый образец
  для копирования).

## 4. `write()` / `emit()` — реальный путь данных

```js
write: function (bytes) {
  if (!sock) throw new Error("not connected");
  sock.send(bytes); // binary frame - zero-copy, no codec needed
},
```

Если формат настоящего протокола на проводе **бинарный**, `write()` может
передать `bytes` (`ArrayBuffer`) прямо в `sock.send()` — без копирования, без
кодирования. Если он **текстовый** (JSON, поле курсора, событие Socket.IO),
закодируйте сами:

```js
write: function (bytes) {
  sock.send('42["cursor",{"p":"' + base64.encode(bytes) + '"}]');
},
```

Получение симметрично — декодируйте, во что настоящий протокол оборачивает
ваши данные, затем вызовите глобальную `emit(bytes)` один раз на каждый
полученный прикладной пакет:

```js
function handleMessage(msg) {
  var m = /"p":"([^"]+)"/.exec(msg);
  if (m) emit(base64.decode(m[1]));
}
```

`emit`/`write` всегда переносят raw-байты (`ArrayBuffer`/`TypedArray`) —
кодек (если он нужен) — дело *вашего* формата на проводе, а не границы
Go/JS.

## 5. Переподключение и `close()`

```js
var reconnectAttempt = 0;

function scheduleReconnect(attempt) {
  reconnectAttempt = attempt + 1;
  var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5)));
  delay += Math.floor(Math.random() * 500); // jitter
  setTimeout(function () {
    if (running) connectOnce({ /* ... */ }).catch(function (e) {
      setState("reconnecting", String(e));
      scheduleReconnect(reconnectAttempt);
    });
  }, delay);
}

function onSocketClose() {
  sock = null;
  if (running) { setState("reconnecting"); scheduleReconnect(reconnectAttempt); }
}
```

```js
close: function () {
  running = false;
  if (sock) { try { sock.close(); } catch (e) {} }
},
```

Строго говоря, вам не нужно вызывать `clearTimeout` для своих таймеров в
`close()` — Go-сторона разрушает весь event loop (и каждый таймер в нём),
когда транспорт останавливается — но явное закрытие сокетов избегает
подвисания полуоткрытого соединения до срабатывания GC.

## 6. Подпишите и протестируйте

```bash
cd OpenFlux
go run ./transport/script/cmd/scriptsign genkey dev.key dev.pub
go run ./transport/script/cmd/scriptsign sign dev.key transport/script/js/my-transport.js

go run ./transport/script/cmd/scripttest \
  -script transport/script/js/my-transport.js \
  -pubkey "$(cat dev.pub)" \
  -url "https://example.com/room/abc123" \
  -duration 30s -send "hello"
```

`scripttest` печатает каждый переход состояния и каждый полученный пакет.
Проверьте:

- Появляется ли `connected=true`, и *остаётся* ли он таким (без метаний)?
- Действительно ли ваш пакет из `-send` доходит до другой стороны (проверьте
  через второй экземпляр `scripttest` на той же комнате/URL, либо через UI
  настоящего приложения)?
- Вызывает ли обрыв вашей сети (или кратковременная недоступность настоящей
  цели) чистый цикл `reconnecting` -> `connected`, а не постоянный `dead`?

См. [05-testing.md](05-testing.md) про нагрузочное тестирование и настройку
с двумя пирами, и [06-lessons-learned.md](06-lessons-learned.md) про
конкретные баги, которые тестирование нашло в существующих семи транспортах
— в новом транспорте легко повторить некоторые из тех же ошибок.

## 7. Нужно, чтобы пользователь вошёл или что-то настроил? (страницы настройки)

Некоторые протоколы не могут просто подключиться — пользователю сначала
нужно куда-то войти, пройти капчу или ввести токен, и `open()` не с чем
работать до этого. Не пытайтесь автоматизировать настоящую форму входа из
JS — попросите приложение показать браузер, тем же способом, которым уже
работает капча:

```js
// Настоящий сайт сам показывает свой UI входа/капчи - просто укажите на него:
raise("captchaRequired", { url: "https://real-site.example/login", reason: "login" });

// Настоящего сайта нет - своя форма настройки, собранная на основе
// templates/template_html.html (лого, статус-строка, кнопка «Готово»,
// уже подключённая к window.openfluxSubmit):
raise("needsSetup", { html: mySetupPageHtml, reason: "configure" });
```

В обоих случаях то, что в итоге отправит пользователь, вернётся в ваш
собственный обработчик `onEvent("cookiesApplied", values)` — читайте через
`cookieJar.get()`, как и куки решённой капчи. Полный контракт, включая
скоуп `{client, node}` и его текущие ограничения — в
[03-host-api-reference.md](03-host-api-reference.md#raisekind-payload-доходящий-до-браузера-приложения).

Если вашей странице нужно больше, чем может статический HTML — свои
маршруты, `fetch()` с настоящим origin вместо нулевого origin у встроенной
страницы — поднимите свой сервер вместо того, чтобы просто передавать HTML
через raise:

```js
var server = httpserver.listen(function (req) {
  if (req.path === "/") return { status: 200, headers: { "Content-Type": "text/html" }, body: mySetupPageHtml };
  // ... свои маршруты ...
});
raise("needsSetup", { url: "http://" + server.addr, reason: "configure" });
```

`httpserver.listen` всегда доступен только с loopback-адреса (параметра
host не существует вовсе) — полная сигнатура, поведение синхронного и
асинхронного обработчика и обработка ошибок — в
[03](03-host-api-reference.md#httpserverlistenhandler-port---port-addr-close).

## 8. Упакуйте (опционально)

Пара обычных `<name>.js` + `<name>.js.sig` работает без проблем. Если
хочется метаданных author/description/icon для UI-списка, или чтобы всё
распространялось одним файлом, см.
[04-signing-and-packaging.md](04-signing-and-packaging.md) про формат
пакета `.flux` и `scriptsign pack`.

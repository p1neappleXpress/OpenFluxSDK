# OpenFlux Transport SDK

*[Read in English](README.md)*

Всё необходимое, чтобы написать, подписать, упаковать и протестировать
новый **транспорт OpenFlux** — без изменений в ядре OpenFlux и без
пересборки приложения.

## Что такое транспорт здесь

В **ночном** канале OpenFlux (ночные сборки приложений; в стабильный релиз
пока не вошёл — см. [Статус](#статус)) транспорт OpenFlux — это
**подписанный JavaScript-файл** (или подписанный пакет `.flux`), загружаемый во время выполнения в свой
собственный интерпретатор [goja](https://github.com/dop251/goja) (чистый
Go, без cgo — тот же статический бинарник, та же схема кросс-компиляции,
что и у остального ядра). Вы пишете логику авторизации, формат кадров,
политику переподключения — всё на JS. Ядро предоставляет host API (HTTP,
HTTP-сервер для собственной мини-страницы настройки/входа, WebSocket, UDP,
настоящий WebRTC PeerConnection, куки, несколько кодеков, примитив
конкурентности) и ровно одну проверку: **проверку ed25519-подписи**.
Неподписанный или неправильно подписанный код никогда не запускается. Это
вся модель безопасности — никакого дополнительного sandbox'а с
ограничением возможностей намеренно нет, чтобы у вас было полное
пространство для реализации того, что реально нужно транспорту.

## С чего начать

1. **[docs/ru/01-overview.md](docs/ru/01-overview.md)** — архитектура за
   пять минут.
2. **[docs/ru/02-creating-a-transport.md](docs/ru/02-creating-a-transport.md)**
   — практический разбор: написать транспорт, протестировать его на
   реальной цели, выпустить.
3. **[docs/ru/03-host-api-reference.md](docs/ru/03-host-api-reference.md)**
   — каждая глобальная функция host API, с сигнатурами и обоснованием.
4. **[docs/ru/04-signing-and-packaging.md](docs/ru/04-signing-and-packaging.md)**
   — модель ed25519 и формат пакета `.flux`.
5. **[docs/ru/05-testing.md](docs/ru/05-testing.md)** — `scripttest`,
   нагрузочное тестирование транспорта и приёмы отладки, которые реально
   помогли при разработке семи транспортов, выпущенных таким способом.
6. **[docs/ru/06-lessons-learned.md](docs/ru/06-lessons-learned.md)** —
   реальные баги, найденные при разработке, и неочевидное поведение
   goja/рантайма, которое их вызывало. Прочитайте это, прежде чем тратить
   час на отладку того, что уже здесь описано.
7. **[docs/ru/07-settings-and-setup-pages.md](docs/ru/07-settings-and-setup-pages.md)**
   — дайте пользователю менять настройки транспорта (объявите их один раз,
   приложение построит мастер **Настройки**) и просите страницу, когда без
   действия пользователя (вход, привязка) подключиться нельзя: `raise()`,
   `httpserver.listen()`, `window.openfluxSubmit` и как всё это проверить через
   `scripttest`, без приложения.

## Быстрый старт

```bash
git clone https://github.com/p1neappleXpress/OpenFluxSDK.git
cd OpenFluxSDK

cp templates/template.js my-transport.js
# ... пишем транспорт ...

# Вариант А: использовать готовые бинарники из bin/ (выберите папку под свою платформу)
bin/darwin-arm64/scriptsign genkey dev.key dev.pub
bin/darwin-arm64/scriptsign sign dev.key my-transport.js
bin/darwin-arm64/scripttest \
  -script my-transport.js -pubkey "$(cat dev.pub)" \
  -url "https://example.com/whatever" -duration 30s -send hello

# Вариант Б: собрать из исходников основного репозитория (всегда отражает
# актуальный host API — см. bin/README.md про этот компромисс и
# docs/ru/03-host-api-reference.md про то, где какая возможность есть)
git clone --branch nightly https://github.com/p1neappleXpress/OpenFlux.git
cd OpenFlux
go run ./transport/script/cmd/scriptsign genkey dev.key dev.pub
go run ./transport/script/cmd/scriptsign sign dev.key ../OpenFluxSDK/my-transport.js
go run ./transport/script/cmd/scripttest \
  -script ../OpenFluxSDK/my-transport.js -pubkey "$(cat dev.pub)" \
  -url "https://example.com/whatever" -duration 30s -send hello
```

Если хотите сначала просто увидеть контракт в работе, а не сразу портировать
настоящий протокол — начните с `examples/echo-transport.js`.

## Что лежит в этом репозитории

- `docs/` — гайды выше на английском, `docs/ru/` — их перевод на русский.
- `templates/template.js` — эталонная отправная точка (синхронизирован с
  host API; если у вас старый клон — сравните с
  `transport/script/js/template.js` в основном репозитории).
- `templates/template_html.html` — стартовая страница настройки/входа
  (лого, статус, кнопка, уже подключённая к `window.openfluxSubmit`) для
  транспорта, которому нужно, чтобы пользователь что-то настроил или вошёл
  в аккаунт перед подключением — см.
  [docs/ru/02-creating-a-transport.md](docs/ru/02-creating-a-transport.md#7-нужно-чтобы-пользователь-вошёл-или-что-то-настроил-страницы-настройки).
- `examples/echo-transport.js` — минимально возможный рабочий транспорт,
  чтобы понять контракт без шума реального протокола.
- `examples/settings-demo.js` — то же, но с настройками, объявленными в
  `info().params` (все типы полей), из которых приложение строит мастер.
- `examples/setup-own-server.js` — транспорт, который привязывает аккаунт через
  собственную страницу, отдаваемую самим скриптом (`httpserver.listen`).
- `bin/` — готовые бинарники `scriptsign`/`scripttest`/`scriptbundle` для
  macOS/Linux/Windows, чтобы не клонировать основной репозиторий только
  для подписи или теста скрипта. См. [bin/README.md](bin/README.md).

## Статус

Движок скрипт-транспортов поставляется в **ночном** канале OpenFlux (ночные
сборки приложений и ветка `nightly` ядра); в стабильный релиз он пока не вошёл.
Рантайм и host API реальны и проверены на живой инфраструктуре и на настоящих
приложениях, но пока он не попал в стабильный релиз, воспринимайте детали как
рабочую предварительную версию: при обновлении смотрите `CHANGELOG.md` ядра.
Этот SDK следует за ночным ядром, а готовые инструменты в `bin/` собраны из него.

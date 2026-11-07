---
description: Включить режим ВЫКЛ. Классификация, делегирование и советы отключаются
argument-hint: ""
allowed-tools: Bash
disable-noninteractive: false
---

Переключи glm-router в режим ВЫКЛ. Это глобальный режим: он перекрывает включённый OpenRouter. Не меняй модель сессии.

Выполни только:

`node bin/glm-router.mjs mode off`

Рабочий каталог — корень плагина. Покажи stdout. Не читай каталог `~/.zcode` и не делай сетевых запросов.

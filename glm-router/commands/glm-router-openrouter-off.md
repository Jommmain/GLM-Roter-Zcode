---
description: Выключить OpenRouter и исключить одноимённые платные модели GLM
argument-hint: ""
allowed-tools: Bash
disable-noninteractive: false
---

Выключи OpenRouter в glm-router. После этого советник не рассматривает маршруты OpenRouter, включая модели с теми же именами GLM. Встроенная подписка Z.ai остаётся отдельной настройкой.

Выполни только:

`node bin/glm-router.mjs openrouter off`

Покажи stdout. Не читай `~/.zcode` и не делай сетевых запросов.

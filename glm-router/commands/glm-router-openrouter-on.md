---
description: Включить отдельный переключатель OpenRouter. Не снимает лимит и не вызывает API
argument-hint: ""
allowed-tools: Bash
disable-noninteractive: false
---

Включи отдельный переключатель OpenRouter в glm-router. Это не глобальный режим и не разрешение на платный вызов. Пока нет явного списка моделей и лимита расходов, маршруты OpenRouter остаются закрытыми. Глобальный режим ВЫКЛ всё равно отключает советы.

Выполни только:

`node bin/glm-router.mjs openrouter on`

Покажи stdout. Не вставляй API-ключ, не читай `~/.zcode` и не отправляй запрос в OpenRouter.

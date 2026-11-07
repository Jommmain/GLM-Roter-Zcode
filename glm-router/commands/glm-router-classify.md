---
description: Локально классифицировать задачу без смены модели и без сети
argument-hint: "[текст задачи]"
allowed-tools: Bash
disable-noninteractive: false
---

Классифицируй задачу только локальным классификатором glm-router. Не отправляй её в модель и не читай `~/.zcode`.

Если режим плагина ВЫКЛ, классификация не выполняется. Иначе из корня плагина выполни:

`node bin/glm-router.mjs classify --text "$ARGUMENTS" --json`

Покажи `action`, `identity.key` и причины. Если OpenRouter выключен, не предлагай его. Аргумент пользователя:

$ARGUMENTS

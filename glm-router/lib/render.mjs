const TEXT = {
  BOUNDED_LOW_RISK:
    "Короткая одношаговая задача без признаков высокого риска: по локальной эвристике ближе встроенная GLM-5.3-Flash.",
  HIGH_RISK:
    "Есть признаки высокого риска, проектирования или сложного разбора: по эвристике ближе встроенная GLM-5.3.",
  MULTI_STEP: "В формулировке несколько шагов: по эвристике ближе встроенная GLM-5.3.",
  LONG_CONTEXT: "Текст длиннее порога длинного контекста: по эвристике ближе встроенная GLM-5.3.",
  EXPLICIT_MAIN: "В тексте явно названа полная GLM-5.3. Одноимённая модель другого провайдера не выбирается.",
  EXPLICIT_FLASH: "В тексте явно назван Flash.",
  AMBIGUOUS: "Сигналов недостаточно. Нужно уточнение у пользователя, тихо модель не выбираю.",
  RISK_AND_SIMPLE: "Одновременно похоже на короткую правку и на рискованную или многошаговую задачу. Выбор не делаю.",
  IMAGE_FLASH_DOC:
    "Для встроенного канала Coding Plan документация ZCode описывает GLM-5.3-Flash как мультимодальную модель для скриншотов и визуальных вопросов. На другие провайдеры и протоколы это не переносится.",
  IMAGE_UNCLEAR:
    "Есть изображение или скриншот, но задача неясна. Поддержка изображений зависит от провайдера и протокола.",
  IMAGE_AND_RISK: "Есть изображение и признаки сложной или рискованной задачи. Автоматически модель не выбираю.",
  IMAGE_WITH_OTHER_TASK:
    "К запросу приложено изображение, а текст описывает другую задачу. Неясно, нужна ли визуальная модель.",
  LENGTH_OVER_FLASH: "Задача похожа на короткую, но длиннее порога Flash. Подтвердите модель вручную.",
  EXPLICIT_CONFLICT: "Явный запрос модели конфликтует с риском, длиной или многошаговостью. Нужно уточнение.",
  OPENROUTER_DISABLED: "OpenRouter выключен отдельным переключателем. Его маршруты, включая одноимённые GLM, исключены.",
  OPENROUTER_OFF_NO_SUBSTITUTE: "Вместо запрошенного маршрута OpenRouter другая модель тихо не подставляется.",
  SPENDING_CAP_MISSING: "OpenRouter включён, но лимит расходов не задан. Платный маршрут не рассматривается.",
  ALLOWLIST_EMPTY: "OpenRouter включён, но список разрешённых моделей пуст. Платный маршрут не рассматривается.",
  MODEL_NOT_ALLOWLISTED: "Названная модель OpenRouter не входит в явный список разрешённых.",
  MODEL_REQUIRED: "OpenRouter упомянут без конкретной разрешённой модели. Сам я её не выбираю.",
  PRICE_OVER_CAP: "Заявленная оценка стоимости выше заданного лимита. Маршрут отклонён.",
  PRICE_UNKNOWN: "Для модели нет заявленной оценки стоимости. Без неё платный маршрут не рассматривается.",
  AMBIGUOUS_OPENROUTER: "Под описание подходит несколько моделей OpenRouter. Нужен точный идентификатор провайдера и модели.",
  QUOTA_EXHAUSTED:
    "Локально указано, что квота исчерпана. Живой интерфейс квоты не подключён, проценты из клиента в плагин не записаны. Платная замена, включая OpenRouter, не предлагается.",
  QUOTA_UNKNOWN: "Живая квота не проверялась. Если недельный или 5-часовой остаток нулевой, запрос к модели лучше не отправлять.",
  DUPLICATE_EXCLUDED: "Совпадающие имена GLM различаются как провайдер плюс модель. Запись OpenRouter не выбрана.",
  BINDING_UNVERIFIED:
    "Публичные документы не подтверждают, что поле model квалифицирует провайдера. Исполнение остаётся ручным, даже если локальная подпись подтверждена.",
  MANUAL_ONLY:
    "Плагин не меняет модель основной сессии: подтверждённой команды или API переключения в документации нет.",
  AUTO_ADVISORY:
    "Режим ЭКСПЕРИМЕНТ: ПОДЗАДАЧИ — это best-effort просьба делегировать работу субагенту через инструмент Agent, в отдельном контексте и с дополнительным расходом токенов. Это не детерминированное переключение основной сессии. Шаблоны в templates/agents не зарегистрированы и не содержат идентификатора модели.",
  HEURISTIC_NOTE: "Пороги настраиваются в конфиге и не являются общим бенчмарком качества моделей.",
  CAP_OK: "Модель есть в списке OpenRouter, и заявленная цена не выше лимита. Это рассмотрение, не вызов API.",
  ZAI_DISABLED: "Встроенный канал в конфиге плагина выключен. Автоматическую замену на другой провайдер не делаю.",
};

const ACTION_LINE = {
  recommend: "Рекомендация",
  ask: "Нужно уточнение",
  blocked: "Маршрут остановлен",
};

export function renderDecision(decision) {
  if (!decision || decision.type === "passthrough") return "";
  const lines = [
    "glm-router: локальный советник, без сетевых запросов и без переключения сессии.",
    `Режим: ${modeLabel(decision.mode)}.`,
    `OpenRouter: ${decision.openrouter.enabled ? "включён" : "выключен"}.`,
    `${ACTION_LINE[decision.action] || "Совет"}: ${actionSentence(decision)}`,
  ];
  if (decision.identity) {
    lines.push(
      `Идентификатор: ${decision.identity.key}. Провайдер и модель указаны вместе, голое имя GLM недостаточно.`,
    );
    if (decision.identity.provider === "openrouter") {
      lines.push(
        `Оценка вызова: ${decision.identity.declaredUsdPerCall} USD, не выше локального лимита. Выберите эту запись OpenRouter вручную, только если согласны с расходом.`,
      );
    } else {
      lines.push(
        "Выберите в селекторе модели встроенный канал BigModel или Z.ai (Coding Plan), не одноимённую запись OpenRouter.",
      );
    }
  } else if (decision.action === "ask") {
    lines.push("Модель не выбрана. Ответьте, какая запись селектора имеется в виду, либо сузьте задачу.");
  }
  for (const code of decision.reasonCodes) {
    if (TEXT[code]) lines.push(TEXT[code]);
  }
  lines.push("Сырой текст запроса плагин не сохраняет.");
  return lines.join("\n");
}

function actionSentence(decision) {
  if (decision.action === "blocked") return "платный запасной маршрут не предлагается.";
  if (decision.action === "ask") return "пользователь выбирает сам, тихого маршрута нет.";
  if (!decision.identity) return "без идентификатора модели.";
  return `${decision.identity.displayName} (${decision.identity.provider}).`;
}

export function modeLabel(mode) {
  if (mode === "off") return "ВЫКЛ";
  if (mode === "semi") return "ПОЛУАВТО";
  if (mode === "experimental-auto-subtasks") return "ЭКСПЕРИМЕНТ: ПОДЗАДАЧИ";
  return mode;
}

export function renderStatus(loaded) {
  const config = loaded.config;
  const main = config.providers.zai_subscription.models.main;
  const flash = config.providers.zai_subscription.models.flash;
  const openrouter = config.providers.openrouter;
  return [
    `glm-router ${"0.1.0"}`,
    `режим: ${modeLabel(config.mode)} (${config.mode})`,
    `OpenRouter: ${openrouter.enabled ? "ВКЛ" : "ВЫКЛ"}`,
    `лимит OpenRouter, USD: ${openrouter.maxUsdPerRecommendation === null ? "не задан" : openrouter.maxUsdPerRecommendation}`,
    `разрешённых моделей OpenRouter: ${openrouter.allowedModels.length}`,
    `встроенный канал в конфиге плагина: ${config.providers.zai_subscription.enabled ? "включён" : "выключен"} (это не статус клиента ZCode)`,
    `квота: ${config.quota.declaredState} (живая квота не читается)`,
    `подпись GLM-5.3: ${main.bindingConfirmed ? "подтверждена локально" : "не подтверждена"}`,
    `подпись GLM-5.3-Flash: ${flash.bindingConfirmed ? "подтверждена локально" : "не подтверждена"}`,
    `конфиг: ${loaded.file || "не создан"} (${loaded.via})`,
    loaded.ok ? "конфиг: принят" : `конфиг: отклонён, для хука действует режим ВЫКЛ (${loaded.errors.map((item) => item.code).join(", ")})`,
    "исполнение модели: не выполняется, только ручной селектор",
  ].join("\n");
}

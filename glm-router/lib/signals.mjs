const FLASH_VERBS = [
  /исправь опечатк/iu,
  /поправь орфограф/iu,
  /переведи(?:те)?\b/iu,
  /\bперевод\b/iu,
  /кратко перескаж/iu,
  /\bсуммируй\b/iu,
  /\bпереименуй\b/iu,
  /отформатируй/iu,
  /поправь формат/iu,
  /\bfix (the )?typos?\b/iu,
  /\bfix spelling\b/iu,
  /\btranslate\b/iu,
  /\bsummarize\b/iu,
  /\brename\b/iu,
  /\breformat\b/iu,
  /\bformat\b/iu,
  /\bexplain this (function|snippet|line)\b/iu,
  /поясни эту (функцию|строку)/iu,
];

const VISUAL = [
  /что на (этом )?скриншот/iu,
  /опиши (это )?(изображение|скриншот|картинк)/iu,
  /разбери скриншот/iu,
  /\bwhat('?s| is) (in|on) (this|the) (screenshot|image)\b/iu,
  /\bdescribe (this|the) (screenshot|image)\b/iu,
  /\boc[r]?\b/iu,
];

const HIGH_RISK = [
  /миграц/iu,
  /безопасност/iu,
  /аутентиф/iu,
  /\bauth\b/iu,
  /\boauth\b/iu,
  /\bjwt\b/iu,
  /секрет/iu,
  /\bpassword\b/iu,
  /\bcredential/iu,
  /\bproduction\b/iu,
  /прод(?:акшн|е)\b/iu,
  /архитектур/iu,
  /спроектир/iu,
  /\bdesign\b/iu,
  /\brefactor/iu,
  /рефактор/iu,
  /\bdeploy/iu,
  /деплой/iu,
  /\bdatabase\b/iu,
  /баз[аеуы]\b/iu,
  /\bsql\b/iu,
  /\brollback\b/iu,
  /откат/iu,
  /шифрован/iu,
  /\bencrypt/iu,
  /уязвим/iu,
  /\bvulnerab/iu,
  /платеж/iu,
  /\bpayment/iu,
  /многопоточ/iu,
  /\brace condition\b/iu,
  /состояни[ея] гонк/iu,
  /\broot cause\b/iu,
  /разберись,? почему/iu,
  /\bwhy does\b/iu,
  /почему (это )?(падает|ломает)/iu,
];

const SEQUENCE = [
  /сначала/iu,
  /затем/iu,
  /потом/iu,
  /после этого/iu,
  /\bthen\b/iu,
  /\bfirst\b/iu,
  /\bnext\b/iu,
  /по шагам/iu,
  /\bstep by step\b/iu,
];

const IMAGE_WORDS = [
  /скриншот/iu,
  /изображен/iu,
  /картинк/iu,
  /\bscreenshots?\b/iu,
  /\bimages?\b/iu,
  /\bdiagram\b/iu,
];

export const signalStats = { calls: 0 };

export function resetSignalStats() {
  signalStats.calls = 0;
}

function count(patterns, text) {
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

function any(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

export function explicitZaiRole(text) {
  const flash = /glm[-\s]?5\.3[-\s]?flash|используй flash|модель flash|\buse flash\b|\bflash model\b/iu.test(text);
  if (flash) return "flash";
  const main = /glm[-\s]?5\.3\b|полн(ую|ая) модель|\bnot flash\b|не flash/iu.test(text);
  if (main) return "main";
  return null;
}

export function mentionsOpenrouter(text) {
  return /open\s*router|опенроутер|опенрутер/iu.test(text);
}

export function hasImageAttachment(extras) {
  const bags = [extras?.attachments, extras?.images, extras?.files];
  for (const bag of bags) {
    if (!Array.isArray(bag)) continue;
    for (const item of bag) {
      if (!item || typeof item !== "object") continue;
      const mime = String(item.mime || item.media_type || item.mediaType || item.type || "");
      if (mime.toLowerCase().startsWith("image/")) return true;
    }
  }
  return false;
}

export function detectSignals(text, extras = {}, heuristics) {
  signalStats.calls += 1;
  const source = typeof text === "string" ? text : "";
  const length = source.length;
  const sequenceHits = count(SEQUENCE, source);
  const numberedSteps = (source.match(/\d+\.\s/g) || []).length;
  const highRisk = any(HIGH_RISK, source);
  return {
    length,
    bounded: any(FLASH_VERBS, source),
    boundedVisual: any(VISUAL, source),
    highRisk,
    multiStep: sequenceHits >= 2 || numberedSteps >= 2 || ((sequenceHits >= 1 || numberedSteps >= 2) && highRisk),
    image: any(IMAGE_WORDS, source) || hasImageAttachment(extras),
    attachmentImage: hasImageAttachment(extras),
    explicit: explicitZaiRole(source),
    openrouterWord: mentionsOpenrouter(source),
    overFlash: length > heuristics.flashMaxChars,
    long: length > heuristics.longContextChars,
  };
}

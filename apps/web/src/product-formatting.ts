import type { Money } from "@closetsearch/shared";

const japaneseCharacterPattern =
  /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

function safeLocale(locale?: string) {
  const candidate =
    locale?.trim() ||
    (typeof navigator !== "undefined" ? navigator.language : undefined) ||
    "en-US";

  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? "en-US";
  } catch {
    return "en-US";
  }
}

export function getPreferredLocale(locale?: string) {
  return safeLocale(locale);
}

export function getPreferredTimeZone(timeZone?: string) {
  if (timeZone?.trim()) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format();
      return timeZone;
    } catch {
      // Fall back to the browser's reviewed IANA zone.
    }
  }

  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function currencyFractionDigits(currency: string, locale?: string) {
  try {
    return (
      new Intl.NumberFormat(safeLocale(locale), {
        currency,
        style: "currency",
      }).resolvedOptions().maximumFractionDigits ?? (currency.toUpperCase() === "JPY" ? 0 : 2)
    );
  } catch {
    return currency.toUpperCase() === "JPY" ? 0 : 2;
  }
}

export function moneyAmount(money: Money) {
  if (typeof money.amountMinor === "number" && Number.isSafeInteger(money.amountMinor)) {
    const fractionDigits = money.fractionDigits ?? currencyFractionDigits(money.currency);
    return money.amountMinor / 10 ** fractionDigits;
  }

  return money.amount;
}

export function formatMoney(money: Money, locale?: string) {
  const fractionDigits = money.fractionDigits ?? currencyFractionDigits(money.currency, locale);

  try {
    return new Intl.NumberFormat(safeLocale(locale), {
      currency: money.currency,
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
      style: "currency",
    }).format(moneyAmount(money));
  } catch {
    return `${money.currency.toUpperCase()} ${moneyAmount(money).toLocaleString(safeLocale(locale))}`;
  }
}

export function formatMinorMoney(
  amountMinor: number,
  currency: string,
  locale?: string,
  fractionDigits = currencyFractionDigits(currency, locale),
) {
  return formatMoney(
    {
      amount: amountMinor / 10 ** fractionDigits,
      amountMinor,
      currency,
      fractionDigits,
    },
    locale,
  );
}

export function formatDateTime(
  value: string | Date,
  options: {
    locale?: string;
    timeZone?: string;
    includeZone?: boolean;
  } = {},
) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Unknown time";
  }

  const timeZone = getPreferredTimeZone(options.timeZone);

  return new Intl.DateTimeFormat(safeLocale(options.locale), {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    timeZoneName: options.includeZone === false ? undefined : "short",
    year: "numeric",
  }).format(date);
}

export function formatRelativeEndTime(
  value: string,
  options: { locale?: string; now?: Date; timeZone?: string } = {},
) {
  const end = new Date(value);
  const now = options.now ?? new Date();
  const remainingMs = end.getTime() - now.getTime();

  if (!Number.isFinite(remainingMs)) {
    return "End time unavailable";
  }

  if (remainingMs <= 0) {
    return `Ended ${formatDateTime(end, options)}`;
  }

  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const relative =
    days > 0
      ? `${days}d ${hours}h remaining`
      : hours > 0
        ? `${hours}h ${minutes}m remaining`
        : `${minutes}m remaining`;

  return `${relative} · ${formatDateTime(end, options)}`;
}

export function containsJapaneseText(value?: string) {
  return Boolean(value && japaneseCharacterPattern.test(value));
}

export function formatLanguageName(language?: string, locale?: string) {
  if (!language?.trim()) {
    return undefined;
  }

  try {
    return new Intl.DisplayNames([safeLocale(locale)], { type: "language" }).of(language);
  } catch {
    return language;
  }
}

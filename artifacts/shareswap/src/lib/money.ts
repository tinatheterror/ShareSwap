/**
 * How the app writes a price. One rule, shared with the mobile app and the server's notification text:
 *
 *   $20      whole dollars have no cents (formatMoney: sentences, cards, chips)
 *   $20.50   anything else has two decimals
 *   $20.00   always two decimals (formatMoneyExact: checkout lines and totals, so columns line up)
 *   $1,250   thousands are grouped
 *   US$20    only a request still charged in USD (started before the move to CAD) says so
 *
 * Prices are in Canadian dollars, so the bare "$" is right for every amount and the currency is said once,
 * where money is collected (PRICES_IN_CAD_NOTE), instead of on every number.
 */

/** The currency a price is in unless a request says otherwise. */
export const PLATFORM_CURRENCY = "cad";
const LEGACY_PAYMENT_CURRENCY = "usd";

export const PRICES_IN_CAD_NOTE = "Prices in CAD";

export function currencySymbol(currency: string | null | undefined = PLATFORM_CURRENCY): string {
  const code = (currency ?? PLATFORM_CURRENCY).trim().toLowerCase() || PLATFORM_CURRENCY;
  if (code === PLATFORM_CURRENCY) return "$";
  if (code === LEGACY_PAYMENT_CURRENCY) return "US$";
  return `${code.toUpperCase()} `;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function format(value: number | string | null | undefined, currency: string | null | undefined, alwaysCents: boolean): string {
  const symbol = currencySymbol(currency);
  const n = typeof value === "string" ? (value.trim() === "" ? 0 : parseFloat(value)) : value ?? 0;
  const rounded = Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : 0;
  const [whole, cents] = (alwaysCents || !Number.isInteger(rounded) ? rounded.toFixed(2) : rounded.toFixed(0)).split(".");
  const sign = Number.isFinite(n) && n < 0 && rounded > 0 ? "-" : "";
  return `${sign}${symbol}${group(whole)}${cents ? `.${cents}` : ""}`;
}

export function formatMoney(value: number | string | null | undefined, currency?: string | null): string {
  return format(value, currency, false);
}

export function formatMoneyExact(value: number | string | null | undefined, currency?: string | null): string {
  return format(value, currency, true);
}

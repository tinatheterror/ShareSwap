import type { Response } from "express";
import { ANYWHERE, WHOLE_WORD } from "./content-policy-terms";

// One rule for everything people write that other people read: listings, profiles, messages, reviews, wishlist posts and
// the notes on a request. Routes call checkText / rejectDisallowedText before they store or upload anything.

export const CONTENT_NOT_ALLOWED_CODE = "CONTENT_NOT_ALLOWED";
export const CONTENT_NOT_ALLOWED_MESSAGE = "This contains language we don't allow. Please change it and try again.";

/** Characters people swap for letters to get past a filter. Digits only count when they sit inside a word. */
const LOOKALIKES: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "€": "e", "£": "e", "¡": "i",
};

/** Lowercased, accents removed, lookalikes turned back into letters, everything else a space. */
export function normalise(text: string): string {
  const folded = text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
  let out = "";
  for (const ch of folded) {
    if (/\p{L}/u.test(ch)) out += ch;
    else if (LOOKALIKES[ch]) out += LOOKALIKES[ch];
    else out += " ";
  }
  return out;
}

/** "f u c k" is four one-letter tokens: join a run of three or more into one word. */
function joinSpacedLetters(tokens: string[]): string[] {
  const out: string[] = [];
  let run = "";
  const flush = () => {
    if (run.length >= 3) out.push(run);
    else for (const ch of run) out.push(ch);
    run = "";
  };
  for (const token of tokens) {
    if (token.length === 1) run += token;
    else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out;
}

/** A word as typed, with long runs of one letter shortened: "fuuuuck" -> "fuuck" -> "fuck". */
function variants(word: string): string[] {
  const upToTwo = word.replace(/(.)\1{2,}/g, "$1$1");
  const single = word.replace(/(.)\1+/g, "$1");
  return [...new Set([word, upToTwo, single])];
}

const WHOLE = new Set(WHOLE_WORD);

export function containsDisallowedLanguage(text: string): boolean {
  if (!text) return false;
  const tokens = joinSpacedLetters(normalise(text).split(/\s+/).filter(Boolean));
  for (const token of tokens) {
    for (const form of variants(token)) {
      if (WHOLE.has(form)) return true;
      for (const term of ANYWHERE) if (form.includes(term)) return true;
    }
  }
  return false;
}

export type PolicyResult = { ok: true } | { ok: false; field: string };

/** The first field whose text is not allowed. Non-strings (missing fields, numbers) are not text and are ignored. */
export function checkText(fields: Record<string, unknown>): PolicyResult {
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value === "string" && containsDisallowedLanguage(value)) return { ok: false, field };
    if (Array.isArray(value) && value.some((v) => typeof v === "string" && containsDisallowedLanguage(v))) return { ok: false, field };
  }
  return { ok: true };
}

/** Sends the 422 and returns true when a field is not allowed; the caller returns without storing anything. */
export function rejectDisallowedText(res: Response, fields: Record<string, unknown>): boolean {
  const result = checkText(fields);
  if (result.ok) return false;
  // `message` as well as `error`: the sign-up screens read one, the rest of the app the other.
  res.status(422).json({ code: CONTENT_NOT_ALLOWED_CODE, error: CONTENT_NOT_ALLOWED_MESSAGE, message: CONTENT_NOT_ALLOWED_MESSAGE, field: result.field });
  return true;
}

import type { Response } from "express";
import { DataSet, RegExpMatcher, englishDataset, type EnglishProfaneWord, englishRecommendedTransformers, parseRawPattern } from "obscenity";
import { ALLOWED_PHRASES, EXTRA_ANYWHERE, EXTRA_WHOLE_WORD } from "./content-policy-terms";

// One rule for everything people write that other people read: listings, profiles, messages, reviews, wishlist posts and
// the notes on a request. Routes call checkText / rejectDisallowedText before they store or upload anything.
//
// The matching is done by the `obscenity` library (its English dataset and recommended transformers: leetspeak such as "sh1t",
// repeated letters such as "fuuuck", look-alike and accented characters, and its own list of innocent words like "Scunthorpe").
// ShareSwap adds to it in content-policy-terms.ts, and adds one step the library does not have: letters spread out with spaces
// or punctuation ("f u c k", "f.u.c.k").

export const CONTENT_NOT_ALLOWED_CODE = "CONTENT_NOT_ALLOWED";
export const CONTENT_NOT_ALLOWED_MESSAGE = "This contains language we don't allow. Please change it and try again.";

/**
 * The library shortens repeated letters in the text before matching (its recommended settings keep up to two of b, e, o, l, s
 * and g and one of anything else), and does not do the same to its patterns. So a term with a double letter, like "trannies"
 * or "jerkoff", has to be written the way the text will look: "tranies", "jerkof".
 */
export function asMatchedPattern(term: string): string {
  return term.replace(/(.)\1+/g, (run, ch: string) => ch.repeat(Math.min(run.length, "beolsg".includes(ch) ? 2 : 1)));
}

function buildMatcher(): RegExpMatcher {
  // Pattern syntax: `|word|` is a complete word, `word` matches anywhere (see the library's pattern documentation).
  const dataset = new DataSet<{ originalWord: EnglishProfaneWord }>().addAll(englishDataset);
  for (const term of EXTRA_WHOLE_WORD) dataset.addPhrase((phrase) => phrase.addPattern(parseRawPattern(`|${asMatchedPattern(term)}|`)));
  for (const term of EXTRA_ANYWHERE) dataset.addPhrase((phrase) => phrase.addPattern(parseRawPattern(asMatchedPattern(term))));
  const built = dataset.build();
  return new RegExpMatcher({
    blacklistedTerms: built.blacklistedTerms,
    whitelistedTerms: [...(built.whitelistedTerms ?? []), ...ALLOWED_PHRASES],
    ...englishRecommendedTransformers,
  });
}

const matcher = buildMatcher();

/** A run of three or more single letters or digits split up by spaces, dots, dashes, underscores, asterisks or commas. */
const SPREAD_OUT = /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}][\s._\-*,]+){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu;

/** "f u c k" and "f.u.c.k" as one word: the text, plus each spread-out run joined up. Three or more, so "A. B. Smith" and "k.d. lang" are left alone. */
export function withSpreadLettersJoined(text: string): string {
  const joined = text.match(SPREAD_OUT)?.map((run) => run.replace(/[\s._\-*,]+/g, ""));
  return joined?.length ? `${text}\n${joined.join("\n")}` : text;
}

/**
 * The library reads "!" and "|" as the letter i wherever they sit, so "trannies!" becomes "tranniesi" and stops being a whole
 * word. A "!" that ends or starts a word is punctuation, not a letter: open it up into a space. A "!" inside a word ("b!tch")
 * is left for the library to read as a letter.
 */
export function withEdgePunctuationOpened(text: string): string {
  return text.replace(/(?<=\p{L})[!¡|]+(?![\p{L}\p{N}])/gu, " ").replace(/(?<![\p{L}\p{N}])[!¡|]+(?=\p{L})/gu, " ");
}

export function containsDisallowedLanguage(text: string): boolean {
  if (!text) return false;
  const spread = withSpreadLettersJoined(text);
  if (matcher.hasMatch(spread)) return true;
  const opened = withEdgePunctuationOpened(spread);
  return opened !== spread && matcher.hasMatch(opened);
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

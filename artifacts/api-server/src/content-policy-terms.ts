// What ShareSwap adds to, and carves out of, the `obscenity` English dataset (see content-policy.ts). The dataset is the base:
// it covers the common profanity, slurs and sexual terms, with leetspeak, repeated letters and look-alike characters handled by
// the library's transformers. These lists are only for what it gets wrong for a neighbourhood marketplace.
//
// To maintain them: add the plain lowercase word. A term in EXTRA_WHOLE_WORD only matches as a complete word. A term in
// EXTRA_ANYWHERE also matches inside a longer word, so it is only for terms no innocent word contains. A phrase in
// ALLOWED_PHRASES is protected: a blocked term that sits inside it is not counted ("shiitake", "Scunthorpe"-style words).

/** Blocked, as complete words. The old in-house list's terms that the dataset does not cover. */
export const EXTRA_WHOLE_WORD: readonly string[] = [
  "trannies", "shemale", "spics", "beaner", "beaners", "gook", "gooks", "paki", "pakis", "jigaboo",
  "rimjob", "jackoff", "jerkoff",
];

/** Blocked, also inside a longer word: none of these appear inside an innocent English word. */
export const EXTRA_ANYWHERE: readonly string[] = ["nigger", "faggot", "wetback", "motherfuck", "cocksuck"];

/**
 * Ordinary words and phrases that contain a blocked term, or that the dataset blocks but a marketplace needs ("rapeseed",
 * "fire retardant", "shiitake mushrooms", "pussy willow", the Dick's Sporting Goods shop). Lowercase letters; the library
 * matches them against the text after its own transformations (so "Shiitake" and "sh1itake" are protected alike).
 */
export const ALLOWED_PHRASES: readonly string[] = [
  "shiitake", "rapeseed", "rape seed", "retardant", "pussy willow", "dick's sporting goods", "bastard file",
  "fag packet", "niggardly", "dyke wall", "pornographic", "fukushima",
];

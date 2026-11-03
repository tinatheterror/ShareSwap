import assert from "node:assert/strict";
import { test } from "node:test";
import { asMatchedPattern, checkText, containsDisallowedLanguage, withEdgePunctuationOpened, withSpreadLettersJoined } from "./content-policy.js";
import { ALLOWED_PHRASES, EXTRA_ANYWHERE, EXTRA_WHOLE_WORD } from "./content-policy-terms.js";

// The filter has two ways to be wrong: letting the obvious through, and rejecting ordinary words. Both are tested, because a
// marketplace that refuses "cocktail shaker" teaches people to ignore the rule.

test("the obvious is caught, however it is dressed up", () => {
  for (const text of [
    "fuck", "FUCK", "Fuck this drill", "what the fucking hell", "motherfucker",
    "f u c k", "f.u.c.k", "f-u-c-k", "F  U  C  K", "fuuuuck", "fuckkkk", "fück", "fúck",
    "sh1t", "5h1t", "$hit", "shiiit", "s.h.i.t",
    "you are a bitch", "b!tch", "b1tch", "bitchesss", "asshole", "a s s h o l e", "@sshole",
    "c u n t", "cunts", "slut", "whore", "dildo for sale", "free porn", "blowjob",
    "faggot", "xfaggotx", "a faggot remark", "wetback",
    "motherfucking", "cocksucking",
  ]) {
    assert.equal(containsDisallowedLanguage(text), true, text);
  }
});

test("ordinary words that contain or resemble blocked ones are not caught", () => {
  for (const text of [
    "Scunthorpe", "Essex", "Sussex", "class assessment", "cocktail shaker set", "grass trimmer", "Bass guitar amp",
    "analog synth", "cumbersome ladder", "shiitake mushrooms", "shitake mushrooms", "Dickens novel", "Hancock", "Cockburn St",
    "titmouse bird feeder", "assume", "passport holder", "Thomas the Tank Engine", "massage gun", "breast pump", "pussy willow branches",
    "nuts and bolts", "knob and tube wiring", "gay pride flag", "Dick's Sporting Goods", "Weiner dog costume", "bastard file",
    "hoe for the garden", "rape seed oil", "rapeseed", "kill switch", "damn good drill", "hell of a lawnmower", "crap storage bins",
    "Maine Coon cat tree", "raccoon trap", "spic and span", "British fag packet", "sambo lessons", "niggardly", "a dyke wall",
    "fire retardant spray", "porcelain doll", "pornographic font", "fuchsia plant", "fukushima", "title", "I want 4 chairs", "2 drills 4 sale",
    "Vitamin A B C", "Great drill!!!", "wow!!", "100% cotton", "5 cm x 10 cm", "USB-C cable", "k.d. lang CD", "A. B. Smith", "",
  ]) {
    assert.equal(containsDisallowedLanguage(text), false, text);
  }
});

test("checkText names the first field that fails and ignores values that are not text", () => {
  assert.deepEqual(checkText({ name: "Cordless drill", description: "Barely used" }), { ok: true });
  assert.deepEqual(checkText({ name: "Cordless drill", description: "a fucking good drill", brand: "Bosch" }), { ok: false, field: "description" });
  assert.deepEqual(checkText({ name: undefined, description: null, rating: 5, tags: ["fine", "sh1t"] }), { ok: false, field: "tags" });
  assert.deepEqual(checkText({ name: undefined, description: null, rating: 5, tags: ["fine"] }), { ok: true });
});

test("leetspeak, spacing, repeated letters and look-alike characters are caught", () => {
  const variants: Record<string, string[]> = {
    leetspeak: ["sh1t", "5h1t", "$h!t", "f4gg0t", "b1tch", "b!tch", "a$$hole", "@sshole", "c0ck", "fvck", "wh0re", "5lut", "d1ldo", "p0rn", "tr4nn1es", "j3rk0ff"],
    spacing: ["f u c k", "f.u.c.k", "f-u-c-k", "f_u_c_k", "f*u*c*k", "F  U  C  K", "s.h.i.t", "a s s h o l e", "c u n t", "you are a b i t c h", "what the f u c k is this", "w h o r e", "5 h 1 t"],
    "repeated letters": ["fuuuuck", "fuckkkk", "fuuuuuuuck", "shiiiiit", "shhhhit", "biiiitch", "bitchesss", "cuuunt", "asssshole", "fffuck"],
    "accents and look-alikes": ["fück", "fúck", "shít", "bïtch", "ｆｕｃｋ", "fuсk" /* Cyrillic с */],
    "mixed": ["F.u.u.u.c.k", "S H 1 T", "you $lut", "g0 f u c k y0urself"],
  };
  for (const [kind, texts] of Object.entries(variants)) {
    for (const text of texts) assert.equal(containsDisallowedLanguage(text), true, `${kind}: ${text}`);
  }
});

test("spread-out letters only join in runs of three or more, so ordinary initials and lists are left alone", () => {
  assert.equal(withSpreadLettersJoined("f u c k"), "f u c k\nfuck");
  assert.equal(withSpreadLettersJoined("A. B. Smith"), "A. B. Smith");
  assert.equal(withSpreadLettersJoined("k.d. lang"), "k.d. lang");
  assert.equal(withSpreadLettersJoined("size 5 cm x 10 cm"), "size 5 cm x 10 cm");
  assert.equal(withSpreadLettersJoined("Vitamin A B C"), "Vitamin A B C\nABC");
  for (const innocent of ["Vitamin A B C", "plan A B C D", "1 2 3 4 5", "S M L XL sizes", "U.S.A. flag", "a b c song book", "R2 D2 C3 PO toy"]) {
    assert.equal(containsDisallowedLanguage(innocent), false, innocent);
  }
});

test("ShareSwap's own additions are caught whole and, for the few that no innocent word contains, inside longer words", () => {
  for (const term of [...EXTRA_WHOLE_WORD, ...EXTRA_ANYWHERE]) {
    assert.equal(containsDisallowedLanguage(term), true, term);
    assert.equal(containsDisallowedLanguage(`you ${term.toUpperCase()}!`), true, `${term} shouted`);
  }
  for (const term of EXTRA_ANYWHERE) assert.equal(containsDisallowedLanguage(`x${term}x`), true, `${term} inside a word`);
  for (const term of EXTRA_WHOLE_WORD) assert.equal(containsDisallowedLanguage(`x${term}x`), false, `${term} inside a word is left alone`);
});

test("the additions are plain lowercase words, with no overlap that would hide a mistake", () => {
  for (const term of [...EXTRA_WHOLE_WORD, ...EXTRA_ANYWHERE]) assert.match(term, /^[a-z]+$/, term);
  assert.equal(new Set(EXTRA_WHOLE_WORD).size, EXTRA_WHOLE_WORD.length, "EXTRA_WHOLE_WORD has a duplicate");
  for (const term of EXTRA_ANYWHERE) assert.ok(!EXTRA_WHOLE_WORD.includes(term), `${term} is in both lists`);
  // A term that is inside an innocent word must be whole-word only.
  for (const innocent of ["scunthorpe", "shiitake", "niggardly", "cocktail", "assess", "classic", "title", "raccoon"]) {
    for (const term of EXTRA_ANYWHERE) assert.ok(!innocent.includes(term), `${term} is inside ${innocent}`);
  }
  for (const phrase of ALLOWED_PHRASES) assert.match(phrase, /^[a-z' ]+$/, phrase);
});

test("a protected word does not protect abuse written next to it", () => {
  for (const text of ["shiitake you fucking idiot", "rapeseed oil, you cunt", "a fucking fire retardant spray", "pussy willow and a slut"]) {
    assert.equal(containsDisallowedLanguage(text), true, text);
  }
});

test("terms with double letters are written the way the library will see the text", () => {
  assert.equal(asMatchedPattern("trannies"), "tranies");
  assert.equal(asMatchedPattern("jerkoff"), "jerkof");
  assert.equal(asMatchedPattern("gook"), "gook", "o may double");
  assert.equal(asMatchedPattern("faggot"), "faggot", "g may double");
  assert.equal(asMatchedPattern("jigaboo"), "jigaboo");
  for (const term of ["trannies", "jerkoff", "jackoff", "gooks", "beaners"]) assert.equal(containsDisallowedLanguage(`${term} and ${term.toUpperCase()}`), true, term);
});

test("punctuation stuck to a word does not hide it, and a '!' inside a word is still a letter", () => {
  for (const text of ["trannies!", "!trannies", "you JERKOFF!!", "you gooks|", "shut up, beaners!", "sh!t", "b!tch", "f!ck you!"]) {
    assert.equal(containsDisallowedLanguage(text), true, text);
  }
  for (const text of ["Great drill!", "wow!!", "Sale! Everything must go!", "!important", "Hi! I'm Pat!", "50% off!!!"]) {
    assert.equal(containsDisallowedLanguage(text), false, text);
  }
  assert.equal(withEdgePunctuationOpened("trannies!"), "trannies ");
  assert.equal(withEdgePunctuationOpened("b!tch"), "b!tch");
  assert.equal(withEdgePunctuationOpened("a|b"), "a|b");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkText, containsDisallowedLanguage, normalise } from "./content-policy.js";
import { ANYWHERE, WHOLE_WORD } from "./content-policy-terms.js";

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

test("normalise folds case, accents and lookalike characters, and turns everything else into spaces", () => {
  assert.equal(normalise("Héllo, W0RLD!"), "hello  worldi");
  assert.equal(normalise("a_b-c.d"), "a b c d");
});

test("the term lists are lowercase words, with no overlap that would hide a mistake", () => {
  for (const term of [...WHOLE_WORD, ...ANYWHERE]) assert.match(term, /^[a-z]+$/, term);
  assert.equal(new Set(WHOLE_WORD).size, WHOLE_WORD.length, "WHOLE_WORD has a duplicate");
  for (const term of ANYWHERE) assert.ok(!WHOLE_WORD.includes(term), `${term} is in both lists`);
  // A term that is inside an innocent word must be whole-word only.
  for (const innocent of ["scunthorpe", "shiitake", "niggardly", "cocktail", "assess", "classic", "title"]) {
    for (const term of ANYWHERE) assert.ok(!innocent.includes(term), `${term} is inside ${innocent}`);
  }
});

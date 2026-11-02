// The language ShareSwap does not allow in what people write: slurs and the most explicit sexual terms. This is a floor, not
// a ceiling: it is meant to stop the obvious, with reporting and the moderation queue behind it. It is deliberately short and
// avoids ordinary profanity ("damn", "crap") and anything with a common innocent use ("rooster", "pussy willow", "rapeseed",
// "Dick" the name), because a marketplace that rejects "cocktail shaker" teaches people to ignore the rule.
//
// To maintain it: add the plain lowercase word. A word in WHOLE_WORD only matches as a complete word, which is how the
// Scunthorpe problem is avoided for terms that sit inside innocent words. A word in ANYWHERE also matches inside a longer
// word, so it is only for terms no innocent word contains. Plurals and the common inflections are listed explicitly.

/** Matched as a complete word only. */
export const WHOLE_WORD: readonly string[] = [
  // slurs ("nigga" is whole-word because "niggardly" is an ordinary word; "coon", "dyke", "fag", "spic" and "sambo" are left
  // out because of Maine Coon cats, dykes and dikes, British cigarettes, "spic and span" and the martial art)
  "nigga", "niggas", "faggots", "tranny", "trannies", "shemale",
  "kike", "kikes", "spics", "beaner", "beaners", "gook", "gooks", "paki", "pakis", "jigaboo",
  "retard", "retards", "retarded", "cunt", "cunts",
  // explicit sexual terms and abuse
  "bitch", "bitches", "whore", "whores", "slut", "sluts", "asshole", "assholes", "dickhead", "dickheads",
  "twat", "twats", "wanker", "wankers", "blowjob", "blowjobs", "handjob", "handjobs", "rimjob", "cumshot", "cumshots",
  "gangbang", "porn", "porno", "dildo", "dildos", "motherfucker", "motherfuckers", "cocksucker", "cocksuckers",
  "jackoff", "jerkoff", "fuckwit", "shithead", "shitheads",
  // sit inside innocent words ("shiitake", "Scunthorpe"), so only the exact word counts
  "fuck", "fucks", "fucker", "fuckers", "fucking", "fucked", "shit", "shits",
];

/** Also matched inside a longer word: none of these appear inside an innocent English word. */
export const ANYWHERE: readonly string[] = ["nigger", "faggot", "wetback", "motherfuck", "cocksuck"];

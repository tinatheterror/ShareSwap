export interface CatalogProduct {
  brand: string;
  model: string;
  category: "Stroller" | "Car Seat" | "High Chair";
  msrp: number;
  aliases: string[];
}

interface CatalogBrand {
  name: string;
  aliases: string[];
  products: Omit<CatalogProduct, "brand">[];
}

const CATALOG: CatalogBrand[] = [
  // ─── STROLLERS ────────────────────────────────────────────────────────────
  {
    name: "UPPAbaby", aliases: ["uppababy", "uppa baby"],
    products: [
      { model: "Vista V2",     aliases: ["vista v2","vista v3","vista"],       category: "Stroller", msrp: 1099 },
      { model: "Cruz V2",      aliases: ["cruz v2","cruz"],                    category: "Stroller", msrp: 799 },
      { model: "Ridge",        aliases: ["ridge"],                             category: "Stroller", msrp: 899 },
      { model: "Minu V2",      aliases: ["minu v2","minu v3","minu"],          category: "Stroller", msrp: 649 },
      { model: "Alta",         aliases: ["alta"],                              category: "Stroller", msrp: 749 },
      { model: "G-Luxe",       aliases: ["g-luxe","gluxe","g luxe"],           category: "Stroller", msrp: 399 },
      { model: "G-Link 2",     aliases: ["g-link 2","glink","g link"],         category: "Stroller", msrp: 899 },
    ],
  },
  {
    name: "Nuna", aliases: ["nuna"],
    products: [
      { model: "Mixx Next",    aliases: ["mixx next","mixx"],                  category: "Stroller", msrp: 799 },
      { model: "Triv Next",    aliases: ["triv next","triv"],                  category: "Stroller", msrp: 799 },
      { model: "Demi Grow",    aliases: ["demi grow","demi next","demi"],      category: "Stroller", msrp: 999 },
      { model: "TAVO Next",    aliases: ["tavo next","tavo"],                  category: "Stroller", msrp: 599 },
      { model: "Ixxa",         aliases: ["ixxa"],                              category: "Stroller", msrp: 999 },
      { model: "PIPA rx",      aliases: ["pipa rx","pipa rx2","pipa"],         category: "Car Seat", msrp: 399 },
      { model: "PIPA lite rx", aliases: ["pipa lite rx","pipa lite"],          category: "Car Seat", msrp: 299 },
      { model: "RAVA",         aliases: ["rava"],                              category: "Car Seat", msrp: 499 },
      { model: "REBL Plus",    aliases: ["rebl plus","rebl"],                  category: "Car Seat", msrp: 499 },
      { model: "EXEC",         aliases: ["exec"],                              category: "Car Seat", msrp: 649 },
    ],
  },
  {
    name: "Bugaboo", aliases: ["bugaboo"],
    products: [
      { model: "Fox 5",        aliases: ["fox 5","fox 4","fox 3","fox"],       category: "Stroller", msrp: 1499 },
      { model: "Cameleon 3",   aliases: ["cameleon 3","cameleon"],             category: "Stroller", msrp: 1199 },
      { model: "Bee 6",        aliases: ["bee 6","bee 5","bee"],               category: "Stroller", msrp: 899 },
      { model: "Butterfly",    aliases: ["butterfly"],                         category: "Stroller", msrp: 599 },
      { model: "Ant",          aliases: ["ant"],                               category: "Stroller", msrp: 349 },
      { model: "Donkey 5",     aliases: ["donkey 5","donkey 3","donkey"],      category: "Stroller", msrp: 1699 },
    ],
  },
  {
    name: "Baby Jogger", aliases: ["baby jogger","babyjogger"],
    products: [
      { model: "City Mini GT2", aliases: ["city mini gt2","city mini gt","city mini"], category: "Stroller", msrp: 449 },
      { model: "City Mini 2",   aliases: ["city mini 2"],                             category: "Stroller", msrp: 349 },
      { model: "City Select 2", aliases: ["city select 2","city select lux","city select"], category: "Stroller", msrp: 799 },
      { model: "City Tour Lux", aliases: ["city tour lux","city tour lux 2","city tour"], category: "Stroller", msrp: 549 },
      { model: "Summit X3",     aliases: ["summit x3","summit"],                      category: "Stroller", msrp: 649 },
    ],
  },
  {
    name: "Graco", aliases: ["graco"],
    products: [
      { model: "Modes Nest",    aliases: ["modes nest","modes nest2"],          category: "Stroller", msrp: 350 },
      { model: "Modes Element", aliases: ["modes element"],                    category: "Stroller", msrp: 300 },
      { model: "UNO2DUO",       aliases: ["uno2duo","uno 2 duo"],              category: "Stroller", msrp: 599 },
      { model: "Extend2Fit",    aliases: ["extend2fit","extend 2 fit"],        category: "Car Seat", msrp: 249 },
      { model: "SlimFit3 LX",   aliases: ["slimfit3","slimfit 3","slim fit 3"], category: "Car Seat", msrp: 279 },
      { model: "SnugRide 35",   aliases: ["snugride 35","snugride"],           category: "Car Seat", msrp: 229 },
      { model: "Nautilus 65",   aliases: ["nautilus 65","nautilus"],           category: "Car Seat", msrp: 219 },
    ],
  },
  {
    name: "Britax", aliases: ["britax","britax römer","britax romer"],
    products: [
      { model: "B-Lively",   aliases: ["b-lively","b lively","blively"],       category: "Stroller", msrp: 350 },
      { model: "B-Free",     aliases: ["b-free","b free","bfree"],             category: "Stroller", msrp: 449 },
      { model: "B-Agile",    aliases: ["b-agile","b agile","bagile"],          category: "Stroller", msrp: 299 },
      { model: "Advocate",   aliases: ["advocate"],                            category: "Car Seat", msrp: 449 },
      { model: "Marathon",   aliases: ["marathon"],                            category: "Car Seat", msrp: 399 },
      { model: "Boulevard",  aliases: ["boulevard"],                           category: "Car Seat", msrp: 349 },
      { model: "One4Life",   aliases: ["one4life","one 4 life"],               category: "Car Seat", msrp: 449 },
      { model: "B-Safe 35",  aliases: ["b-safe 35","bsafe 35","b safe 35","b safe gen2","bsafe"], category: "Car Seat", msrp: 299 },
    ],
  },
  {
    name: "Cybex", aliases: ["cybex"],
    products: [
      { model: "Balios S Lux", aliases: ["balios s lux","balios s","balios"],  category: "Stroller", msrp: 699 },
      { model: "Priam 4",      aliases: ["priam 4","priam 3","priam"],         category: "Stroller", msrp: 1299 },
      { model: "Gazelle S",    aliases: ["gazelle s","gazelle"],               category: "Stroller", msrp: 1199 },
      { model: "Eezy S Twist", aliases: ["eezy s twist","eezy s+","eezy s plus","eezy twist","eezy"], category: "Stroller", msrp: 449 },
      { model: "Mios",         aliases: ["mios"],                              category: "Stroller", msrp: 849 },
      { model: "Cloud G",      aliases: ["cloud g","cloud g lux","cloud t"],   category: "Car Seat", msrp: 399 },
    ],
  },
  {
    name: "Thule", aliases: ["thule"],
    products: [
      { model: "Spring",        aliases: ["spring"],                           category: "Stroller", msrp: 699 },
      { model: "Sleek",         aliases: ["sleek"],                            category: "Stroller", msrp: 999 },
      { model: "Urban Glide 3", aliases: ["urban glide 3","urban glide 2","urban glide"], category: "Stroller", msrp: 579 },
    ],
  },
  // ─── CAR SEATS ────────────────────────────────────────────────────────────
  {
    name: "Clek", aliases: ["clek"],
    products: [
      { model: "Fllo",     aliases: ["fllo"],                                  category: "Car Seat", msrp: 599 },
      { model: "Foonf",    aliases: ["foonf"],                                 category: "Car Seat", msrp: 699 },
      { model: "Liing",    aliases: ["liing"],                                 category: "Car Seat", msrp: 499 },
      { model: "Oobr",     aliases: ["oobr","oobr max"],                       category: "Car Seat", msrp: 549 },
    ],
  },
  {
    name: "Chicco", aliases: ["chicco"],
    products: [
      { model: "NextFit Max", aliases: ["nextfit max","nextfit","next fit max"], category: "Car Seat", msrp: 399 },
      { model: "KeyFit 35",   aliases: ["keyfit 35","key fit 35"],             category: "Car Seat", msrp: 329 },
      { model: "KeyFit 30",   aliases: ["keyfit 30","key fit 30","keyfit"],    category: "Car Seat", msrp: 279 },
      { model: "Fit4",        aliases: ["fit4","fit 4"],                       category: "Car Seat", msrp: 349 },
      { model: "MyFit Harness", aliases: ["myfit harness","myfit","my fit"],   category: "Car Seat", msrp: 349 },
    ],
  },
  // ─── HIGH CHAIRS ──────────────────────────────────────────────────────────
  {
    name: "Stokke", aliases: ["stokke"],
    products: [
      { model: "Tripp Trapp", aliases: ["tripp trapp","trip trap","triptrapp"], category: "High Chair", msrp: 359 },
      { model: "Steps",       aliases: ["steps baby set","steps"],             category: "High Chair", msrp: 499 },
      { model: "Clikk",       aliases: ["clikk","click"],                      category: "High Chair", msrp: 249 },
      { model: "Nomi",        aliases: ["nomi"],                               category: "High Chair", msrp: 599 },
    ],
  },
  {
    name: "Peg Perego", aliases: ["peg perego","pegperego"],
    products: [
      { model: "Tatamia",            aliases: ["tatamia"],                     category: "High Chair", msrp: 399 },
      { model: "Prima Pappa Zero3",  aliases: ["prima pappa zero3","prima pappa zero 3","prima pappa"], category: "High Chair", msrp: 299 },
      { model: "Prima Pappa Follow Me", aliases: ["prima pappa follow me","follow me"], category: "High Chair", msrp: 299 },
      { model: "Siesta",             aliases: ["siesta"],                      category: "High Chair", msrp: 349 },
    ],
  },
  {
    name: "Maxi-Cosi", aliases: ["maxi-cosi","maxi cosi","maxicosi"],
    products: [
      { model: "Moa 8-in-1",  aliases: ["moa 8-in-1","moa 8 in 1","moa"],    category: "High Chair", msrp: 399 },
      { model: "Minla 6-in-1", aliases: ["minla 6-in-1","minla 6 in 1","minla"], category: "High Chair", msrp: 299 },
    ],
  },
  {
    name: "Abiie", aliases: ["abiie"],
    products: [
      { model: "Beyond Junior Y", aliases: ["beyond junior y","beyond junior","beyond"], category: "High Chair", msrp: 229 },
    ],
  },
  {
    name: "IKEA", aliases: ["ikea"],
    products: [
      { model: "Antilop", aliases: ["antilop"],                               category: "High Chair", msrp: 29 },
      { model: "Langur",  aliases: ["langur"],                                category: "High Chair", msrp: 149 },
      { model: "Blåmes",  aliases: ["blames","blåmes"],                       category: "High Chair", msrp: 79 },
    ],
  },
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function scoreMatch(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const aWords = na.split(" ");
  const bWords = nb.split(" ");
  const overlap = bWords.filter((w) => w.length > 2 && aWords.includes(w)).length;
  if (overlap > 0) return 0.55 + 0.2 * (overlap / Math.max(aWords.length, bWords.length));
  return 0;
}

export interface CatalogMatch {
  brand: string;
  model: string;
  category: string;
  msrp: number;
  confidence: number;
  displayName: string;
  brandOnly: boolean;
}

export function matchCatalog(aiBrand: string, aiModel: string): CatalogMatch | null {
  if (!aiBrand || aiBrand.toLowerCase() === "unknown") return null;

  let bestBrand: CatalogBrand | null = null;
  let bestBrandScore = 0;

  for (const entry of CATALOG) {
    const nameScore = scoreMatch(aiBrand, entry.name);
    const aliasScore = Math.max(...entry.aliases.map((a) => scoreMatch(aiBrand, a)));
    const score = Math.max(nameScore, aliasScore);
    if (score > bestBrandScore) {
      bestBrandScore = score;
      bestBrand = entry;
    }
  }

  if (!bestBrand || bestBrandScore < 0.7) return null;

  if (!aiModel || aiModel.trim() === "") {
    return {
      brand: bestBrand.name,
      model: "",
      category: bestBrand.products[0]?.category ?? "Baby & Kids",
      msrp: 0,
      confidence: bestBrandScore * 0.6,
      displayName: bestBrand.name,
      brandOnly: true,
    };
  }

  let bestProduct: (typeof bestBrand.products)[0] | null = null;
  let bestModelScore = 0;

  for (const product of bestBrand.products) {
    const nameScore = scoreMatch(aiModel, product.model);
    const aliasScore = Math.max(...product.aliases.map((a) => scoreMatch(aiModel, a)));
    const score = Math.max(nameScore, aliasScore);
    if (score > bestModelScore) {
      bestModelScore = score;
      bestProduct = product;
    }
  }

  if (!bestProduct || bestModelScore < 0.5) {
    return {
      brand: bestBrand.name,
      model: "",
      category: bestBrand.products[0]?.category ?? "Baby & Kids",
      msrp: 0,
      confidence: bestBrandScore * 0.6,
      displayName: bestBrand.name,
      brandOnly: true,
    };
  }

  const combined = bestBrandScore * 0.5 + bestModelScore * 0.5;
  return {
    brand: bestBrand.name,
    model: bestProduct.model,
    category: bestProduct.category,
    msrp: bestProduct.msrp,
    confidence: Math.min(0.98, combined),
    displayName: `${bestBrand.name} ${bestProduct.model} ${bestProduct.category}`,
    brandOnly: false,
  };
}

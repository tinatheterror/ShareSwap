// The age of majority in each place ShareSwap is offered: the minimum age to hold an account, because renting, lending against
// a deposit, and being paid out are contracts and a minor cannot make them. Canada is by province or territory, the United
// States by state (and DC). Verified 2026-11-03 against Canadian provincial and territorial statutes as summarised by
// divorce.law, savvynewcanadians.com and Wikipedia ("Minor (law)"), and for the US against Ala. Code 26-1-1, Neb. Rev. Stat.
// 43-2101 and Miss. Code 1-3-27. US territories are NOT offered: Puerto Rico is 21 but was not confirmed, and the others were
// not checked. Counsel should confirm the table before launch, and again whenever a law changes.

export type Region = { code: string; country: "CA" | "US"; name: string; ageOfMajority: number };

export const REGIONS: readonly Region[] = [
  { code: "CA-AB", country: "CA", name: "Alberta", ageOfMajority: 18 },
  { code: "CA-BC", country: "CA", name: "British Columbia", ageOfMajority: 19 },
  { code: "CA-MB", country: "CA", name: "Manitoba", ageOfMajority: 18 },
  { code: "CA-NB", country: "CA", name: "New Brunswick", ageOfMajority: 19 },
  { code: "CA-NL", country: "CA", name: "Newfoundland and Labrador", ageOfMajority: 19 },
  { code: "CA-NS", country: "CA", name: "Nova Scotia", ageOfMajority: 19 },
  { code: "CA-NT", country: "CA", name: "Northwest Territories", ageOfMajority: 19 },
  { code: "CA-NU", country: "CA", name: "Nunavut", ageOfMajority: 19 },
  { code: "CA-ON", country: "CA", name: "Ontario", ageOfMajority: 18 },
  { code: "CA-PE", country: "CA", name: "Prince Edward Island", ageOfMajority: 18 },
  { code: "CA-QC", country: "CA", name: "Quebec", ageOfMajority: 18 },
  { code: "CA-SK", country: "CA", name: "Saskatchewan", ageOfMajority: 18 },
  { code: "CA-YT", country: "CA", name: "Yukon", ageOfMajority: 19 },
  { code: "US-AL", country: "US", name: "Alabama", ageOfMajority: 19 },
  { code: "US-AK", country: "US", name: "Alaska", ageOfMajority: 18 },
  { code: "US-AZ", country: "US", name: "Arizona", ageOfMajority: 18 },
  { code: "US-AR", country: "US", name: "Arkansas", ageOfMajority: 18 },
  { code: "US-CA", country: "US", name: "California", ageOfMajority: 18 },
  { code: "US-CO", country: "US", name: "Colorado", ageOfMajority: 18 },
  { code: "US-CT", country: "US", name: "Connecticut", ageOfMajority: 18 },
  { code: "US-DE", country: "US", name: "Delaware", ageOfMajority: 18 },
  { code: "US-DC", country: "US", name: "District of Columbia", ageOfMajority: 18 },
  { code: "US-FL", country: "US", name: "Florida", ageOfMajority: 18 },
  { code: "US-GA", country: "US", name: "Georgia", ageOfMajority: 18 },
  { code: "US-HI", country: "US", name: "Hawaii", ageOfMajority: 18 },
  { code: "US-ID", country: "US", name: "Idaho", ageOfMajority: 18 },
  { code: "US-IL", country: "US", name: "Illinois", ageOfMajority: 18 },
  { code: "US-IN", country: "US", name: "Indiana", ageOfMajority: 18 },
  { code: "US-IA", country: "US", name: "Iowa", ageOfMajority: 18 },
  { code: "US-KS", country: "US", name: "Kansas", ageOfMajority: 18 },
  { code: "US-KY", country: "US", name: "Kentucky", ageOfMajority: 18 },
  { code: "US-LA", country: "US", name: "Louisiana", ageOfMajority: 18 },
  { code: "US-ME", country: "US", name: "Maine", ageOfMajority: 18 },
  { code: "US-MD", country: "US", name: "Maryland", ageOfMajority: 18 },
  { code: "US-MA", country: "US", name: "Massachusetts", ageOfMajority: 18 },
  { code: "US-MI", country: "US", name: "Michigan", ageOfMajority: 18 },
  { code: "US-MN", country: "US", name: "Minnesota", ageOfMajority: 18 },
  { code: "US-MS", country: "US", name: "Mississippi", ageOfMajority: 21 },
  { code: "US-MO", country: "US", name: "Missouri", ageOfMajority: 18 },
  { code: "US-MT", country: "US", name: "Montana", ageOfMajority: 18 },
  { code: "US-NE", country: "US", name: "Nebraska", ageOfMajority: 19 },
  { code: "US-NV", country: "US", name: "Nevada", ageOfMajority: 18 },
  { code: "US-NH", country: "US", name: "New Hampshire", ageOfMajority: 18 },
  { code: "US-NJ", country: "US", name: "New Jersey", ageOfMajority: 18 },
  { code: "US-NM", country: "US", name: "New Mexico", ageOfMajority: 18 },
  { code: "US-NY", country: "US", name: "New York", ageOfMajority: 18 },
  { code: "US-NC", country: "US", name: "North Carolina", ageOfMajority: 18 },
  { code: "US-ND", country: "US", name: "North Dakota", ageOfMajority: 18 },
  { code: "US-OH", country: "US", name: "Ohio", ageOfMajority: 18 },
  { code: "US-OK", country: "US", name: "Oklahoma", ageOfMajority: 18 },
  { code: "US-OR", country: "US", name: "Oregon", ageOfMajority: 18 },
  { code: "US-PA", country: "US", name: "Pennsylvania", ageOfMajority: 18 },
  { code: "US-RI", country: "US", name: "Rhode Island", ageOfMajority: 18 },
  { code: "US-SC", country: "US", name: "South Carolina", ageOfMajority: 18 },
  { code: "US-SD", country: "US", name: "South Dakota", ageOfMajority: 18 },
  { code: "US-TN", country: "US", name: "Tennessee", ageOfMajority: 18 },
  { code: "US-TX", country: "US", name: "Texas", ageOfMajority: 18 },
  { code: "US-UT", country: "US", name: "Utah", ageOfMajority: 18 },
  { code: "US-VT", country: "US", name: "Vermont", ageOfMajority: 18 },
  { code: "US-VA", country: "US", name: "Virginia", ageOfMajority: 18 },
  { code: "US-WA", country: "US", name: "Washington", ageOfMajority: 18 },
  { code: "US-WV", country: "US", name: "West Virginia", ageOfMajority: 18 },
  { code: "US-WI", country: "US", name: "Wisconsin", ageOfMajority: 18 },
  { code: "US-WY", country: "US", name: "Wyoming", ageOfMajority: 18 },
];

export const regionByCode = (code: unknown): Region | undefined =>
  typeof code === "string" ? REGIONS.find((region) => region.code === code) : undefined;

export type AgeCheck =
  | { ok: true; region: Region }
  | { ok: false; reason: "invalid_date" | "unknown_region" }
  | { ok: false; reason: "underage"; region: Region; minimumAge: number };

/** Whole years between a YYYY-MM-DD birth date and `now` (UTC), or null if the text is not a real date in the past within 120 years. */
export function ageInYears(dateOfBirth: unknown, now: Date = new Date()): number | null {
  if (typeof dateOfBirth !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

/**
 * Whether this birth date and place meet the age of majority there. The birth date is only used to answer this: callers store
 * the place and the date the check passed, never the birth date.
 */
export function checkAgeEligibility(input: { dateOfBirth?: unknown; region?: unknown }, now: Date = new Date()): AgeCheck {
  const region = regionByCode(input.region);
  if (!region) return { ok: false, reason: "unknown_region" };
  const age = ageInYears(input.dateOfBirth, now);
  if (age === null) return { ok: false, reason: "invalid_date" };
  if (age < region.ageOfMajority) return { ok: false, reason: "underage", region, minimumAge: region.ageOfMajority };
  return { ok: true, region };
}

export const AGE_ELIGIBILITY_ERROR_CODE = "AGE_NOT_ELIGIBLE";

/** Whether a person still has to confirm their age: never confirmed, or the place they gave is not one we know. */
export const ageConfirmationRequired = (user: { ageConfirmedAt?: Date | string | null; ageRegion?: string | null }) =>
  !user.ageConfirmedAt || !regionByCode(user.ageRegion);

export function ageErrorResponse(check: Exclude<AgeCheck, { ok: true }>) {
  if (check.reason === "underage") {
    return {
      code: AGE_ELIGIBILITY_ERROR_CODE,
      minimumAge: check.minimumAge,
      message: `You must be at least ${check.minimumAge} to use ShareSwap in ${check.region.name}.`,
    };
  }
  return {
    code: "AGE_INVALID",
    message: check.reason === "unknown_region" ? "Please choose your province, territory or state." : "Please enter your date of birth as YYYY-MM-DD.",
  };
}

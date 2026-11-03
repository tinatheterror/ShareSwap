import { useQuery } from "@tanstack/react-query";

export type AgeRegion = { code: string; country: "CA" | "US"; name: string; ageOfMajority: number };
export type AgeValue = { dateOfBirth: string; region: string };
export const emptyAge: AgeValue = { dateOfBirth: "", region: "" };
export const ageComplete = (value: AgeValue) => /^\d{4}-\d{2}-\d{2}$/.test(value.dateOfBirth) && value.region !== "";

/**
 * Date of birth and province/state: the age of majority where you live is the minimum age for an account. The server uses the
 * birth date once to check it and keeps only the place and the date the check passed (see age-of-majority.ts).
 */
export function AgeFields({ value, onChange, idPrefix = "age" }: { value: AgeValue; onChange: (value: AgeValue) => void; idPrefix?: string }) {
  const { data } = useQuery<{ regions: AgeRegion[] }>({ queryKey: ["/api/legal/age-config"] });
  const regions = data?.regions ?? [];
  const chosen = regions.find((region) => region.code === value.region);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-3" data-testid="age-fields">
      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700" htmlFor={`${idPrefix}-region`}>Where do you live?</label>
        <select
          id={`${idPrefix}-region`}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          value={value.region}
          onChange={(e) => onChange({ ...value, region: e.target.value })}
          data-testid="age-region"
        >
          <option value="">Choose your province, territory or state</option>
          {(["CA", "US"] as const).map((country) => (
            <optgroup key={country} label={country === "CA" ? "Canada" : "United States"}>
              {regions.filter((region) => region.country === country).map((region) => (
                <option key={region.code} value={region.code}>{region.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700" htmlFor={`${idPrefix}-dob`}>Date of birth</label>
        <input
          id={`${idPrefix}-dob`}
          type="date"
          max={today}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          value={value.dateOfBirth}
          onChange={(e) => onChange({ ...value, dateOfBirth: e.target.value })}
          data-testid="age-dob"
        />
      </div>
      <p className="text-xs text-gray-500">
        You must have reached the age of majority where you live{chosen ? ` (${chosen.ageOfMajority} in ${chosen.name})` : ""} to use ShareSwap. We use your date of birth only to check this and do not keep it.
      </p>
    </div>
  );
}

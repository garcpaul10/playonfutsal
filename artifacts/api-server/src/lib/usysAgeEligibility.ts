/**
 * USYS (US Youth Soccer) age eligibility utilities.
 *
 * USYS rule: a player's age for a division is determined as of July 31
 * of the soccer season year, not the event date.
 * - If the event falls Aug 1–Dec 31, the cutoff is July 31 of the NEXT calendar year.
 * - If the event falls Jan 1–Jul 31, the cutoff is July 31 of the CURRENT calendar year.
 *
 * Each U[N] division spans two birth years:
 *   players who are N-1 or N years old as of that July 31 are eligible.
 *   e.g. U8  → ages 7–8 as of July 31
 *        U10 → ages 9–10 as of July 31
 */

export const USYS_AGE_RANGES: Record<string, { min: number; max: number }> = {
  u8:  { min: 7,  max: 8  },
  u9:  { min: 8,  max: 9  },
  u10: { min: 9,  max: 10 },
  u11: { min: 10, max: 11 },
  u12: { min: 11, max: 12 },
  u13: { min: 12, max: 13 },
  u14: { min: 13, max: 14 },
  u15: { min: 14, max: 15 },
  u16: { min: 15, max: 16 },
  u17: { min: 16, max: 17 },
  u18: { min: 17, max: 18 },
  adult:    { min: 18, max: 999 },
  u8_u11:   { min: 7,  max: 11 },
  u12_u15:  { min: 11, max: 15 },
};

/**
 * Returns the USYS season cutoff date (July 31) for a given event date.
 * If eventDate is Aug 1–Dec 31, return July 31 of the next year.
 * If eventDate is Jan 1–Jul 31, return July 31 of the current year.
 */
export function usysCutoffDate(eventDate: Date): Date {
  const month = eventDate.getMonth(); // 0-indexed: July = 6
  const year = eventDate.getFullYear();
  if (month >= 7) {
    return new Date(Date.UTC(year + 1, 6, 31));
  }
  return new Date(Date.UTC(year, 6, 31));
}

/**
 * Returns the player's age in completed years as of the given reference date.
 */
function ageAsOf(dobStr: string, referenceDate: Date): number {
  const dob = new Date(dobStr);
  let age = referenceDate.getUTCFullYear() - dob.getUTCFullYear();
  const mDiff = referenceDate.getUTCMonth() - dob.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && referenceDate.getUTCDate() < dob.getUTCDate())) {
    age--;
  }
  return age;
}

/**
 * Checks USYS age eligibility for a player.
 *
 * @param ageGroup  Single age group string or array of age group strings (e.g. "u10" or ["u9","u10"])
 * @param dob       Player date-of-birth string (ISO date or YYYY-MM-DD). Null/undefined = missing.
 * @param eventDate The event start date (used to calculate the USYS July 31 cutoff).
 * @param waiveredGroups  Optional list of age groups the player has an approved admin waiver for.
 * @returns null if eligible, or an error string explaining why they are ineligible.
 */
export function checkUsysAgeEligibility(
  ageGroup: string | string[],
  dob: string | null | undefined,
  eventDate: Date,
  waiveredGroups: string[] = [],
): string | null {
  const groups = (Array.isArray(ageGroup) ? ageGroup : [ageGroup])
    .map((g) => g.toLowerCase().replace(/[^a-z0-9_]/g, ""));

  if (!groups.length) return null;

  if (groups.includes("all_ages")) return null;

  const knownGroups = groups.filter((g) => USYS_AGE_RANGES[g]);
  if (!knownGroups.length) return null;

  if (knownGroups.some((g) => waiveredGroups.map((w) => w.toLowerCase()).includes(g))) {
    return null;
  }

  if (!dob) return "Player date of birth is required for age verification";

  const cutoff = usysCutoffDate(eventDate);
  const age = ageAsOf(dob, cutoff);

  const cutoffLabel = `July 31, ${cutoff.getUTCFullYear()}`;

  const fits = knownGroups.some((g) => {
    const r = USYS_AGE_RANGES[g];
    return age >= r.min && age <= r.max;
  });

  if (!fits) {
    const labels = knownGroups.map((g) => {
      const r = USYS_AGE_RANGES[g];
      if (r.max === 999) return "18+ (adult)";
      return `ages ${r.min}–${r.max} as of ${cutoffLabel}`;
    });
    return `Player age (${age} as of ${cutoffLabel}) is not within the eligible range for this division (${labels.join(", ")})`;
  }

  return null;
}

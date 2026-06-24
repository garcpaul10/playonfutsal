/**
 * Shared eligibility check utility.
 * Checks a player's DOB and address against an event's eligibility rules.
 */

export type EligibilityRules = {
  minAge?: number;
  maxAge?: number;
  allowedStates?: string[];
  genderRequirement?: string;
  gender?: string;
};

export type EligibilityResult = {
  eligible: boolean;
  reason?: string;
};

/**
 * Calculate age in full years from dateOfBirth to a reference date (default: today).
 */
function calculateAge(dateOfBirth: string | Date, referenceDate?: Date): number {
  const dob = typeof dateOfBirth === "string" ? new Date(dateOfBirth) : dateOfBirth;
  const ref = referenceDate ?? new Date();
  let age = ref.getFullYear() - dob.getFullYear();
  const m = ref.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * Check whether a player is eligible to register for an event.
 *
 * @param playerDob   - Player's date of birth (ISO string or Date)
 * @param playerState - Player's state of residence (2-letter code)
 * @param rules       - Event eligibility rules object
 * @param playerGender - Optional player gender
 * @returns { eligible, reason? }
 */
export function checkEligibility(
  playerDob: string | Date | null | undefined,
  playerState: string | null | undefined,
  rules: EligibilityRules | null | undefined,
  playerGender?: string | null
): EligibilityResult {
  if (!rules) return { eligible: true };

  if (!playerDob) {
    return {
      eligible: false,
      reason: "Your date of birth is required to check eligibility. Please update your profile.",
    };
  }

  const age = calculateAge(playerDob);

  if (rules.minAge !== undefined && age < rules.minAge) {
    return {
      eligible: false,
      reason: `This program requires players to be at least ${rules.minAge} years old. You are ${age}.`,
    };
  }

  if (rules.maxAge !== undefined && age > rules.maxAge) {
    return {
      eligible: false,
      reason: `This program is for players aged ${rules.maxAge} and under. You are ${age}.`,
    };
  }

  if (rules.allowedStates && rules.allowedStates.length > 0) {
    if (!playerState) {
      return {
        eligible: false,
        reason: `This program is restricted to players from: ${rules.allowedStates.join(", ")}. Please update your address.`,
      };
    }
    const stateUpper = playerState.toUpperCase();
    if (!rules.allowedStates.map((s) => s.toUpperCase()).includes(stateUpper)) {
      return {
        eligible: false,
        reason: `This program is only open to players from: ${rules.allowedStates.join(", ")}. Your state: ${playerState}.`,
      };
    }
  }

  if (rules.genderRequirement || rules.gender) {
    const required = (rules.genderRequirement ?? rules.gender ?? "").toLowerCase();
    if (required && required !== "any" && required !== "all" && required !== "open") {
      if (!playerGender) {
        return {
          eligible: false,
          reason: `This program is restricted to ${required} players. Please update your profile.`,
        };
      }
      if (playerGender.toLowerCase() !== required) {
        return {
          eligible: false,
          reason: `This program is restricted to ${required} players.`,
        };
      }
    }
  }

  return { eligible: true };
}

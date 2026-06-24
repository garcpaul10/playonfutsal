/**
 * Shared bracket generation utilities.
 * Used by tournaments.ts route and deadlineScheduler.ts background worker.
 */

export function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function generateDoubleElimBracket(
  tournamentId: number,
  seeds: { teamId: number | null; seed: number }[],
  divisionId?: number | null,
): any[] {
  const n = seeds.length;
  const slots = nextPowerOf2(n);
  const wbRounds = Math.log2(slots);
  const seededIds: (number | null)[] = Array(slots).fill(null);
  seeds.forEach((s) => { seededIds[s.seed - 1] = s.teamId; });
  const fixtures: any[] = [];

  for (let i = 0; i < slots / 2; i++) {
    const home = seededIds[i];
    const away = seededIds[slots - 1 - i];
    fixtures.push({ entityType: "tournament", entityId: tournamentId, homeTeamId: home, awayTeamId: away, status: home == null || away == null ? "bye" : "scheduled", round: 1, phase: "winners", durationMinutes: 60, ...(divisionId ? { divisionId } : {}) });
  }
  for (let round = 2; round <= wbRounds; round++) {
    const count = slots / Math.pow(2, round);
    for (let i = 0; i < count; i++) {
      fixtures.push({ entityType: "tournament", entityId: tournamentId, homeTeamId: null, awayTeamId: null, status: "pending", round, phase: "winners", durationMinutes: 60, ...(divisionId ? { divisionId } : {}) });
    }
  }
  const lbRounds = 2 * (wbRounds - 1);
  for (let lbRound = 1; lbRound <= lbRounds; lbRound++) {
    const groupIndex = Math.floor((lbRound - 1) / 2);
    const count = Math.max(1, (slots / 4) / Math.pow(2, groupIndex));
    for (let i = 0; i < count; i++) {
      fixtures.push({ entityType: "tournament", entityId: tournamentId, homeTeamId: null, awayTeamId: null, status: "pending", round: lbRound, phase: "losers", durationMinutes: 60, ...(divisionId ? { divisionId } : {}) });
    }
  }
  fixtures.push({ entityType: "tournament", entityId: tournamentId, homeTeamId: null, awayTeamId: null, status: "pending", round: 1, phase: "grand_final", durationMinutes: 60, notes: "Grand Final", ...(divisionId ? { divisionId } : {}) });
  return fixtures;
}

export function generateSingleElimBracket(
  tournamentId: number,
  seeds: { teamId: number | null; seed: number }[],
  consolationEnabled: boolean,
  divisionId?: number | null,
): any[] {
  const n = seeds.length;
  const slots = nextPowerOf2(n);
  const rounds = Math.log2(slots);
  const seededIds: (number | null)[] = Array(slots).fill(null);
  seeds.forEach((s) => { seededIds[s.seed - 1] = s.teamId; });
  const fixtures: any[] = [];

  for (let i = 0; i < slots / 2; i++) {
    const home = seededIds[i];
    const away = seededIds[slots - 1 - i];
    fixtures.push({ entityType: "tournament", entityId: tournamentId, homeTeamId: home, awayTeamId: away, status: home == null || away == null ? "bye" : "scheduled", round: 1, phase: "playoff", durationMinutes: 60, ...(divisionId ? { divisionId } : {}) });
  }
  for (let round = 2; round <= rounds; round++) {
    const count = slots / Math.pow(2, round);
    for (let i = 0; i < count; i++) {
      fixtures.push({ entityType: "tournament", entityId: tournamentId, homeTeamId: null, awayTeamId: null, status: "pending", round, phase: "playoff", durationMinutes: 60, ...(divisionId ? { divisionId } : {}) });
    }
  }
  if (consolationEnabled && rounds >= 2) {
    fixtures.push({ entityType: "tournament", entityId: tournamentId, homeTeamId: null, awayTeamId: null, status: "pending", round: rounds, phase: "consolation", durationMinutes: 60, notes: "3rd Place Match", ...(divisionId ? { divisionId } : {}) });
  }
  return fixtures;
}

export function generateGroupStageBracket(
  tournamentId: number,
  groups: { name: string; teamIds: number[] }[],
  divisionId?: number | null,
): any[] {
  const fixtures: any[] = [];
  let round = 1;
  for (const group of groups) {
    const teams = group.teamIds;
    for (let i = 0; i < teams.length - 1; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        fixtures.push({ entityType: "tournament", entityId: tournamentId, homeTeamId: teams[i], awayTeamId: teams[j], status: "scheduled", round: round++, phase: "group", durationMinutes: 50, notes: `Group ${group.name}`, ...(divisionId ? { divisionId } : {}) });
      }
    }
  }
  return fixtures;
}

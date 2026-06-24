/**
 * teamPlacement.ts — team placement service for league/tournament registration.
 *
 * runPlacementChecks: fast synchronous heuristic (capacity + imbalance)
 * runAIPlacement: Claude-powered placement with heuristic fallback on failure
 *
 * Both are called at registration time so every registration gets a placement
 * result (division label, waitlist flag, imbalance alert) persisted in the
 * response for the client and stored in registration notes.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";

export interface PlacementResult {
  waitlisted: boolean;
  division: string | null;
  imbalanceAlert: string | null;
  reasoning: string;
}

const PLACEMENT_MODEL = "claude-haiku-4-5";

/**
 * Fast synchronous placement decision — no I/O.
 * Used as a fallback when the AI call fails/times out.
 */
export function runPlacementChecks(opts: {
  teamId: number;
  offeringId: number;
  offeringType: "league" | "tournament";
  currentCount: number;
  maxTeams: number;
  ageGroup: string | null;
}): PlacementResult {
  const { currentCount, maxTeams, ageGroup } = opts;
  const isFull = maxTeams > 0 && currentCount >= maxTeams;
  const division = ageGroup ?? null;

  let imbalanceAlert: string | null = null;
  if (!isFull) {
    const afterCount = currentCount + 1;
    if (afterCount > 1 && afterCount % 2 !== 0 && maxTeams > 2) {
      imbalanceAlert = `Odd number of teams (${afterCount}/${maxTeams}) — one team may receive a bye each round.`;
    }
    if (maxTeams > 0 && afterCount === maxTeams) {
      const prev = imbalanceAlert ? imbalanceAlert + " " : "";
      imbalanceAlert = `${prev}${opts.offeringType === "league" ? "League" : "Tournament"} is now at full capacity.`;
    }
  }

  return {
    waitlisted: isFull,
    division,
    imbalanceAlert,
    reasoning: isFull
      ? `${opts.offeringType === "league" ? "League" : "Tournament"} at capacity (${currentCount}/${maxTeams}), team waitlisted.`
      : `Team placed in ${division ?? "default division"} (${currentCount + 1}/${maxTeams} teams).`,
  };
}

/**
 * AI-powered placement — calls Claude to determine division, detect imbalance,
 * and reason about the placement. Falls back to runPlacementChecks on failure.
 *
 * Uses claude-haiku for cost/latency efficiency on every registration call.
 */
export async function runAIPlacement(opts: {
  teamId: number;
  teamName: string;
  teamAgeGroup?: string | null;
  offeringId: number;
  offeringName: string;
  offeringType: "league" | "tournament";
  currentCount: number;
  maxTeams: number;
  ageGroup: string | null;
  format?: string | null;
}): Promise<PlacementResult> {
  const heuristic = runPlacementChecks(opts);

  const systemPrompt = `You are a team placement engine for PlayOn futsal. Analyze the team and offering details and decide placement. Respond ONLY with valid JSON, no other text:
{
  "division": "string or null — suggest a sub-division label if applicable (e.g. 'Division A', 'Open Division'), else null",
  "waitlisted": false,
  "imbalanceAlert": "string or null — warn if adding this team creates a lopsided bracket (odd count, uneven groups)",
  "reasoning": "1-2 sentences"
}`;

  const userContent = `TEAM: id=${opts.teamId}, name="${opts.teamName}", ageGroup="${opts.teamAgeGroup ?? "unknown"}"
OFFERING: id=${opts.offeringId}, type=${opts.offeringType}, name="${opts.offeringName}", ageGroup="${opts.ageGroup}", format="${opts.format ?? "N/A"}", maxTeams=${opts.maxTeams}
CURRENT TEAM COUNT: ${opts.currentCount}/${opts.maxTeams}
IS FULL: ${heuristic.waitlisted}
Place this team. If full, set waitlisted=true. If odd teams after placement, explain imbalance.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const msg = await anthropic.messages.create({
      model: PLACEMENT_MODEL,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    clearTimeout(timeout);

    const block = msg.content[0];
    const text = block.type === "text" ? block.text : "";
    const cleaned = text.replace(/^```json?\s*/m, "").replace(/```\s*$/m, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      waitlisted: parsed.waitlisted ?? heuristic.waitlisted,
      division: parsed.division ?? heuristic.division,
      imbalanceAlert: parsed.imbalanceAlert ?? heuristic.imbalanceAlert,
      reasoning: parsed.reasoning ?? heuristic.reasoning,
    };
  } catch {
    return heuristic;
  }
}

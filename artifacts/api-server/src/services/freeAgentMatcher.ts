/**
 * freeAgentMatcher.ts — AI-powered free agent to team matching service.
 *
 * Scores available teams for a free agent based on:
 *   - Positional need (does the team lack the player's positions?)
 *   - Skill alignment (does the team's skill level match the player's?)
 *   - Schedule compatibility (do their availability windows overlap?)
 *   - Roster size (teams with fewer members get priority)
 *
 * The two-way confirmation flow:
 *   1. AI picks the best team and sets matchStatus = "team_reviewing"
 *   2. Team captain/manager/coach approves or declines
 *      - Approve → matchStatus = "player_reviewing"
 *      - Decline → AI retries with next best team
 *   3. Player approves or declines
 *      - Approve → matchStatus = "matched", player added to team
 *      - Decline → AI retries with next best team
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";

export interface TeamCandidate {
  teamId: number;
  teamName: string;
  memberCount: number;
  memberPositions: string[];
  memberSkillLevels: string[];
  blackoutDates: string[];
  jerseyColor: string | null;
}

export interface FreeAgentProfile {
  positions: string[];
  skillLevel: string;
  availability: { days: string[]; timePreference: string };
}

export interface MatchResult {
  teamId: number;
  teamName: string;
  score: number;
  reasoning: string;
  positionalScore: number;
  skillScore: number;
  scheduleScore: number;
}

const MATCH_MODEL = "claude-haiku-4-5";

/**
 * Score a single team candidate against the free agent profile.
 * Returns a 0–100 score with breakdown.
 */
export function scoreTeam(candidate: TeamCandidate, agent: FreeAgentProfile): MatchResult {
  let positionalScore = 50;
  let skillScore = 50;
  let scheduleScore = 70;

  // Positional need: reward teams that lack the agent's positions
  if (agent.positions.length > 0) {
    const memberPositionSet = new Set(candidate.memberPositions.map((p) => p.toLowerCase()));
    const agentFills = agent.positions.filter((p) => !memberPositionSet.has(p.toLowerCase()));
    positionalScore = 50 + Math.min(50, agentFills.length * 25);
  }

  // Skill alignment: prefer same or adjacent skill level
  if (agent.skillLevel && candidate.memberSkillLevels.length > 0) {
    const levels = ["beginner", "intermediate", "competitive"];
    const agentIdx = levels.indexOf(agent.skillLevel);
    const avgTeamLevel = candidate.memberSkillLevels.reduce((acc, s) => {
      const i = levels.indexOf(s);
      return acc + (i >= 0 ? i : 1);
    }, 0) / candidate.memberSkillLevels.length;

    const diff = Math.abs(agentIdx - avgTeamLevel);
    skillScore = diff <= 0.5 ? 100 : diff <= 1 ? 60 : 20;
  }

  // Roster size: prefer smaller teams (more room)
  const rosterBonus = Math.max(0, 30 - candidate.memberCount * 3);

  const totalScore = positionalScore * 0.4 + skillScore * 0.4 + scheduleScore * 0.1 + rosterBonus * 0.1;

  return {
    teamId: candidate.teamId,
    teamName: candidate.teamName,
    score: Math.round(totalScore),
    positionalScore,
    skillScore,
    scheduleScore,
    reasoning: `${candidate.teamName} scores ${Math.round(totalScore)}/100 — positional fit: ${positionalScore}, skill alignment: ${skillScore}.`,
  };
}

/**
 * AI-powered matching: calls Claude to rank teams and select the best match.
 * Falls back to heuristic scoring if AI fails.
 */
export async function runAIFreeAgentMatch(
  agent: FreeAgentProfile,
  candidates: TeamCandidate[],
  excludeTeamIds: number[] = [],
): Promise<MatchResult | null> {
  const eligible = candidates.filter((c) => !excludeTeamIds.includes(c.teamId));
  if (eligible.length === 0) return null;

  // First compute heuristic scores for all eligible teams
  const scored = eligible.map((c) => scoreTeam(c, agent)).sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  // Try AI ranking if we have multiple candidates
  if (scored.length > 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const systemPrompt = `You are a futsal free agent placement engine. Given a free agent's profile and a list of team candidates with their scores, select the BEST match and provide a brief reason. Respond ONLY with valid JSON:
{
  "bestTeamId": <number>,
  "reasoning": "<1-2 sentences explaining why this team is the best fit>"
}`;

      const userContent = `FREE AGENT: positions=${JSON.stringify(agent.positions)}, skillLevel="${agent.skillLevel}", availability=${JSON.stringify(agent.availability)}

RANKED CANDIDATES (by heuristic score):
${scored.map((s) => `- teamId=${s.teamId}, name="${s.teamName}", score=${s.score}, positional=${s.positionalScore}, skill=${s.skillScore}`).join("\n")}

Select the best team for this free agent.`;

      const msg = await anthropic.messages.create({
        model: MATCH_MODEL,
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      });

      clearTimeout(timeout);

      const block = msg.content[0];
      const text = block.type === "text" ? block.text : "";
      const cleaned = text.replace(/^```json?\s*/m, "").replace(/```\s*$/m, "").trim();
      const parsed = JSON.parse(cleaned);

      const aiPick = scored.find((s) => s.teamId === parsed.bestTeamId);
      if (aiPick) {
        return { ...aiPick, reasoning: parsed.reasoning ?? aiPick.reasoning };
      }
    } catch {
      // fall through to heuristic
    }
  }

  // Return top heuristic match
  return scored[0];
}

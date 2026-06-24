-- Add unique constraint on standings (league_id, team_id) to prevent duplicate rows

-- Remove any existing duplicate rows first, keeping the most-recently-updated one
DELETE FROM standings s1
USING standings s2
WHERE s1.id < s2.id
  AND s1.league_id = s2.league_id
  AND s1.team_id = s2.team_id;

-- Add the unique constraint
ALTER TABLE standings
  ADD CONSTRAINT standings_league_team_unique UNIQUE (league_id, team_id);

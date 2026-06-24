-- P10: Update assistant_conversations default model from gpt-4o to claude-sonnet-4-5
ALTER TABLE assistant_conversations ALTER COLUMN model SET DEFAULT 'claude-sonnet-4-5';

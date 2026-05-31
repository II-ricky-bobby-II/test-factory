export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";

export function getClaudeModel(): string {
  return process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
}

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

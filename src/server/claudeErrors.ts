export class ClaudeIntegrationError extends Error {
  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ClaudeIntegrationError";
  }
}

export function safeClaudeErrorMessage(error: unknown): string {
  if (error instanceof ClaudeIntegrationError) return error.message;
  if (error instanceof Error) return redactSecretFragments(error.message);
  return redactSecretFragments(String(error));
}

export function redactSecretFragments(value: string): string {
  return value
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\bfill\((["'`])(?:(?!\1).)*\1\)/g, 'fill("[redacted]")')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[redacted]")
    .replace(/password=[^&\s]+/gi, "password=[redacted]")
    .replace(/token=[^&\s]+/gi, "token=[redacted]")
    .replace(/api[_-]?key[=:]\s*[^&\s"]+/gi, "api_key=[redacted]");
}

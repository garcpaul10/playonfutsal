import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    if (!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
      throw new Error(
        "AI_INTEGRATIONS_ANTHROPIC_BASE_URL must be set. Did you forget to provision the Anthropic AI integration?",
      );
    }
    if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
      throw new Error(
        "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Did you forget to provision the Anthropic AI integration?",
      );
    }
    _client = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
  }
  return _client;
}

/**
 * Lazy Anthropic client proxy.
 * The SDK client is created on first method call — missing env vars only
 * throw when an AI endpoint is actually invoked, not at module import time.
 * This prevents the entire API server from failing at startup just because
 * the Anthropic integration hasn't been provisioned.
 */
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    const client = getClient();
    const value = (client as any)[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

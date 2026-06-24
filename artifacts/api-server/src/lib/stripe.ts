import Stripe from "stripe";

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken || !hostname) {
    throw new Error("Stripe connector env vars not found (REPLIT_CONNECTORS_HOSTNAME / REPL_IDENTITY)");
  }

  const connectorName = "stripe";
  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";

  // STRIPE_TEST_MODE: set to "true" in production secrets to force test (development)
  // Stripe keys even on the deployed app. Remove or set to "false" to restore live mode.
  // No code changes are needed — toggling this secret is enough to switch modes.
  const testModeOverride = process.env.STRIPE_TEST_MODE === "true";
  if (isProduction && testModeOverride) {
    console.warn("[Stripe] STRIPE_TEST_MODE=true — using test keys (development connection) in production");
  } else {
    const activeMode = isProduction ? "production (live keys)" : "development (test keys)";
    console.log(`[Stripe] mode: ${activeMode}`);
  }

  const targetEnvironment = (isProduction && !testModeOverride) ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", connectorName);
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Replit-Token": xReplitToken,
    },
  });

  const data = await response.json() as { items?: Array<{ settings: { publishable: string; secret: string } }> };
  const connectionSettings = data.items?.[0];

  if (!connectionSettings?.settings?.publishable || !connectionSettings?.settings?.secret) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, {
    apiVersion: "2025-08-27.basil" as any,
  });
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey(): Promise<string> {
  const { secretKey } = await getCredentials();
  return secretKey;
}

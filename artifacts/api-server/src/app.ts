import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import stripeWebhookRouter from "./routes/stripeWebhook";
import clerkWebhookRouter from "./routes/clerkWebhook";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const allowedOrigins: string[] = (() => {
  const raw = process.env.ALLOWED_ORIGINS;
  if (raw) return raw.split(",").map((o) => o.trim()).filter(Boolean);
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return [`https://${dev}`];
  return [];
})();

app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.some((o) => origin === o || origin.endsWith(`.${o.replace(/^https?:\/\//, "")}`)))
        return cb(null, true);
      cb(new Error(`CORS: origin '${origin}' not allowed`));
    },
  }),
);

// Stripe webhook must receive the raw body for signature verification
app.use(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req: Request, _res: Response, next: NextFunction) => {
    (req as any).rawBody = req.body;
    next();
  },
);

// Clerk webhook must receive the raw body for Svix signature verification
app.use(
  "/api/webhooks/clerk",
  express.raw({ type: "application/json" }),
  (req: Request, _res: Response, next: NextFunction) => {
    (req as any).rawBody = req.body;
    next();
  },
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// OpenAPI spec + Swagger UI docs (public, no auth)
app.get("/api/openapi.yaml", (_req: Request, res: Response) => {
  try {
    const yamlPath = resolve(__dirname, "../../../lib/api-spec/openapi.yaml");
    const spec = readFileSync(yamlPath, "utf-8");
    res.setHeader("Content-Type", "application/yaml");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(spec);
  } catch {
    res.status(404).json({ error: "OpenAPI spec not found" });
  }
});

app.get("/api/docs", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PlayOn API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0f1416; }
    .swagger-ui { font-family: 'Outfit', sans-serif; }
    .topbar { background: #740D2A !important; }
    .topbar-wrapper img { content: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30"><text y="22" font-size="20" font-weight="bold" fill="white" font-family="sans-serif">PlayOn API</text></svg>'); height: 28px; }
    .info .title { color: #f1efef; }
    body .swagger-ui .opblock-tag { color: #f1efef; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({
        url: "/api/openapi.yaml",
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: "StandaloneLayout",
        deepLinking: true,
        persistAuthorization: true,
        tryItOutEnabled: true,
      });
    };
  </script>
</body>
</html>`);
});

// Stripe and Clerk webhooks registered before main router (raw body)
app.use("/api", stripeWebhookRouter);
app.use("/api", clerkWebhookRouter);
app.use("/api", router);

export default app;

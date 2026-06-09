import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Kysely } from "kysely";
import type { AppConfig } from "./config";
import { checkDatabase } from "./db";
import { createCorrelationId, log } from "./logger";
import { issuePowerSyncCredentials } from "./powersync";
import type { DB } from "./schema";

type AppBindings = {
  Variables: {
    correlationId: string;
  };
};

export function createApp(config: AppConfig, db: Kysely<DB>): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use("*", async (context, next) => {
    const correlationId = context.req.header("x-correlation-id") ?? createCorrelationId();
    context.set("correlationId", correlationId);
    context.header("x-correlation-id", correlationId);
    await next();
  });

  app.onError((error, context) => {
    const correlationId = context.get("correlationId") ?? createCorrelationId();
    const status = error instanceof HTTPException ? error.status : 500;
    log("error", "request failed", {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
      path: context.req.path,
      status
    });
    return context.json({ error: "request_failed", correlationId }, status);
  });

  app.get("/health", async (context) => {
    const correlationId = context.get("correlationId");
    const database = await checkDatabase(db);
    return context.json({
      status: "ok",
      service: "origin-backend",
      time: new Date().toISOString(),
      correlationId,
      database,
      devIdentity: {
        userId: config.devUserId,
        deviceId: config.devDeviceId
      }
    });
  });

  app.get("/v1/diagnostics", async (context) => {
    const correlationId = context.get("correlationId");
    const database = await checkDatabase(db);
    return context.json({
      backendUrl: `http://${config.backendHost}:${config.backendPort}`,
      correlationId,
      database,
      deviceId: config.devDeviceId,
      powersyncUrl: config.powersyncUrl,
      status: "ok",
      userId: config.devUserId
    });
  });

  app.post("/v1/powersync/credentials", async (context) => {
    const correlationId = context.get("correlationId");
    const deviceId = context.req.header("x-device-id");
    if (deviceId !== config.devDeviceId) {
      throw new HTTPException(401, { message: "unknown development device" });
    }

    const credentials = await issuePowerSyncCredentials(config);
    log("info", "issued powersync credentials", {
      correlationId,
      deviceId,
      userId: credentials.userId,
      expiresAt: credentials.expiresAt
    });
    return context.json({ ...credentials, correlationId });
  });

  app.post("/v1/powersync/upload", async (context) => {
    const correlationId = context.get("correlationId");
    log("info", "powersync upload checked", {
      correlationId,
      note: "slice 1 has no local command-intent writes"
    });
    return context.json({ status: "ok", processed: 0, correlationId });
  });

  return app;
}

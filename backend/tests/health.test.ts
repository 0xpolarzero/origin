import { afterAll, describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { createApp } from "../src/app";
import { createDb } from "../src/db";

type HealthBody = {
  status: string;
  database: { ok: boolean };
  devIdentity: { userId: string; deviceId: string };
};

type CredentialsBody = {
  endpoint: string;
  token: string;
  userId: string;
};

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = createApp(config, db);

afterAll(async () => {
  await db.destroy();
});

describe("backend diagnostics", () => {
  test("health returns database-backed status and correlation id", async () => {
    const response = await app.fetch(
      new Request("http://origin.local/health", {
        headers: { "x-correlation-id": "test-correlation" }
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("test-correlation");
    const body = (await response.json()) as HealthBody;
    expect(body.status).toBe("ok");
    expect(body.database.ok).toBe(true);
    expect(body.devIdentity.userId).toBe(config.devUserId);
    expect(body.devIdentity.deviceId).toBe(config.devDeviceId);
  });

  test("PowerSync credentials require the seeded development device", async () => {
    const rejected = await app.fetch(new Request("http://origin.local/v1/powersync/credentials", { method: "POST" }));
    expect(rejected.status).toBe(401);

    const accepted = await app.fetch(
      new Request("http://origin.local/v1/powersync/credentials", {
        method: "POST",
        headers: { "x-device-id": config.devDeviceId }
      })
    );

    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as CredentialsBody;
    expect(body.endpoint).toBe(config.powersyncUrl);
    expect(body.token.length).toBeGreaterThan(40);
    expect(body.userId).toBe(config.devUserId);
  });
});

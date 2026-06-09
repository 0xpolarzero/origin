import { loadConfig } from "./config";
import { createApp } from "./app";
import { createDb } from "./db";
import { log } from "./logger";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = createApp(config, db);

log("info", "backend starting", {
  host: config.backendHost,
  port: config.backendPort,
  powersyncUrl: config.powersyncUrl
});

export default {
  port: config.backendPort,
  hostname: config.backendHost,
  fetch: app.fetch
};

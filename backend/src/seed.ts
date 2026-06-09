import { loadConfig } from "./config";
import { createDb } from "./db";
import { log } from "./logger";

const config = loadConfig();
const db = createDb(config.databaseUrl);

await db
  .insertInto("users")
  .values({
    id: config.devUserId,
    email: "dev@origin.local",
    display_name: "Dev User"
  })
  .onConflict((conflict) =>
    conflict.column("id").doUpdateSet({
      email: "dev@origin.local",
      display_name: "Dev User",
      updated_at: new Date()
    })
  )
  .execute();

await db
  .insertInto("devices")
  .values({
    id: config.devDeviceId,
    user_id: config.devUserId,
    name: "Development Simulator",
    platform: "apple",
    last_seen_at: new Date()
  })
  .onConflict((conflict) =>
    conflict.column("id").doUpdateSet({
      user_id: config.devUserId,
      name: "Development Simulator",
      platform: "apple",
      last_seen_at: new Date(),
      updated_at: new Date()
    })
  )
  .execute();

log("info", "seed complete", {
  userId: config.devUserId,
  deviceId: config.devDeviceId
});

await db.destroy();

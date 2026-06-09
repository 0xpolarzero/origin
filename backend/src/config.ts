import { Schema } from "effect";

const ConfigSchema = Schema.Struct({
  backendHost: Schema.NonEmptyString,
  backendPort: Schema.NumberFromString.pipe(Schema.int(), Schema.positive()),
  databaseUrl: Schema.NonEmptyString,
  devUserId: Schema.NonEmptyString,
  devDeviceId: Schema.NonEmptyString,
  powersyncUrl: Schema.NonEmptyString,
  powersyncJwtSecretB64Url: Schema.NonEmptyString
});

export type AppConfig = typeof ConfigSchema.Type;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return Schema.decodeUnknownSync(ConfigSchema)({
    backendHost: env.BACKEND_HOST ?? "127.0.0.1",
    backendPort: env.BACKEND_PORT ?? "3000",
    databaseUrl: env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/origin",
    devUserId: env.DEV_USER_ID ?? "dev_user",
    devDeviceId: env.DEV_DEVICE_ID ?? "dev_device",
    powersyncUrl: env.POWERSYNC_URL ?? "http://127.0.0.1:8080",
    powersyncJwtSecretB64Url:
      env.POWERSYNC_JWT_SECRET_B64URL ?? "Fp2RrM4RoZtNTrh5L1Kd1kQl1YUN3S3G0hV4nA1cX8s"
  });
}

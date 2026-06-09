import { SignJWT, base64url } from "jose";
import type { AppConfig } from "./config";

export type PowerSyncCredentialsResponse = {
  endpoint: string;
  expiresAt: string;
  token: string;
  userId: string;
};

export async function issuePowerSyncCredentials(config: AppConfig): Promise<PowerSyncCredentialsResponse> {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const secret = base64url.decode(config.powersyncJwtSecretB64Url);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", kid: "dev-key-1" })
    .setSubject(config.devUserId)
    .setAudience(config.powersyncUrl)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);

  return {
    endpoint: config.powersyncUrl,
    expiresAt: expiresAt.toISOString(),
    token,
    userId: config.devUserId
  };
}

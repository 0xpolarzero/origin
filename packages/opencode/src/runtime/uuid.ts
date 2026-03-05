import { randomBytes } from "crypto"
import z from "zod"

const uuid_v7_pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const uuid_v7 = z.string().regex(uuid_v7_pattern)

function hex(input: Uint8Array) {
  return Array.from(input)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export function create_uuid_v7(given?: string) {
  if (given) return uuid_v7.parse(given).toLowerCase()

  const now = BigInt(Date.now())
  const bytes = randomBytes(16)

  bytes[0] = Number((now >> 40n) & 0xffn)
  bytes[1] = Number((now >> 32n) & 0xffn)
  bytes[2] = Number((now >> 24n) & 0xffn)
  bytes[3] = Number((now >> 16n) & 0xffn)
  bytes[4] = Number((now >> 8n) & 0xffn)
  bytes[5] = Number(now & 0xffn)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const raw = hex(bytes)
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`
}

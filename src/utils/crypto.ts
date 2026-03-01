import crypto from "crypto";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomOtp6(): string {
  // 000000–999999, padded
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

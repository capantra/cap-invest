import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { randomToken, sha256 } from "../utils/crypto";

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function createSession(params: {
  userId: string;
  ip?: string;
  userAgent?: string;
  days?: number;
}) {
  const raw = randomToken(32);
  const sessionTokenHash = sha256(raw);
  const days = params.days ?? 14;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId: params.userId,
      sessionTokenHash,
      expiresAt,
      ip: params.ip,
      userAgent: params.userAgent,
    },
  });

  return { raw, expiresAt };
}

export async function revokeSession(rawToken: string) {
  const tokenHash = sha256(rawToken);
  await prisma.session.updateMany({
    where: { sessionTokenHash: tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

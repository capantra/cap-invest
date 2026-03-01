import { prisma } from "../prisma";
import { randomToken, sha256 } from "../utils/crypto";

export async function createUnsubscribeToken(params: { userId: string; ttlDays: number }) {
  const raw = randomToken(24);
  const tokenHash = sha256(raw);
  const expiresAt = new Date(Date.now() + params.ttlDays * 24 * 60 * 60 * 1000);

  await prisma.unsubscribeToken.create({
    data: { userId: params.userId, tokenHash, expiresAt },
  });

  return raw;
}

export async function consumeUnsubscribeToken(rawToken: string) {
  const tokenHash = sha256(rawToken);
  const record = await prisma.unsubscribeToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) return null;

  await prisma.unsubscribeToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  // Opt out user from bulk updates
  await prisma.emailPreference.upsert({
    where: { userId: record.userId },
    update: { bulkUpdatesOptOut: true },
    create: { userId: record.userId, bulkUpdatesOptOut: true },
  });

  return record.userId;
}

import { prisma } from "../prisma";
import { sha256 } from "../utils/crypto";

export async function getLatestConfidentialityAgreement() {
  return prisma.agreement.findFirst({
    where: { key: "CONFIDENTIALITY" },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function acceptAgreement(params: {
  userId: string;
  agreementId: string;
  ip?: string;
  userAgent?: string;
}) {
  return prisma.agreementAcceptance.upsert({
    where: { userId_agreementId: { userId: params.userId, agreementId: params.agreementId } },
    update: { acceptedAt: new Date(), ip: params.ip, userAgent: params.userAgent },
    create: {
      userId: params.userId,
      agreementId: params.agreementId,
      ip: params.ip,
      userAgent: params.userAgent,
    },
  });
}

export function computeAgreementSha(bodyHtml: string) {
  return sha256(bodyHtml);
}

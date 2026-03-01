import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Generates SAFE-YYYY-### or NOTE-YYYY-### using SERIALIZABLE transaction + retry.
 * Avoids collisions via @@unique([type, refYear, refSeq]) and @unique(instrumentRef).
 */
export async function createInvestorInstrumentWithRef(args: {
  prisma: PrismaClient;
  investorId: string;
  type: "SAFE" | "NOTE";
  signedAt: Date;
  purchaseAmountCents: number;
  discountPercent?: number | null;
  status?: "OUTSTANDING" | "CONVERTED" | "CANCELLED";
  currency?: string;
  notes?: string | null;
}) {
  const {
    prisma,
    investorId,
    type,
    signedAt,
    purchaseAmountCents,
    discountPercent = null,
    status = "OUTSTANDING",
    currency = "AUD",
    notes = null,
  } = args;

  const refYear = signedAt.getFullYear();
  const prefix = `${type}-${refYear}-`;

  // retry on unique collisions or serialization failures
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // find the current max sequence for this type+year
          const latest = await tx.investorInstrument.findFirst({
            where: { type, refYear },
            orderBy: { refSeq: "desc" },
            select: { refSeq: true },
          });

          const nextSeq = (latest?.refSeq ?? 0) + 1;
          const seqPadded = String(nextSeq).padStart(3, "0");
          const instrumentRef = `${prefix}${seqPadded}`;

          const created = await tx.investorInstrument.create({
            data: {
              investorId,
              type,
              status,
              instrumentRef,
              refYear,
              refSeq: nextSeq,
              signedAt,
              purchaseAmountCents,
              currency,
              discountPercent,
              convertedAt: status === "CONVERTED" ? new Date() : null,
              notes,
            },
          });

          // keep quick flag in sync (optional but useful for list filtering)
          await tx.user.update({
            where: { id: investorId },
            data: { preInvestorInstrument: type },
          });

          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (err: any) {
      // Common transient errors:
      // - Unique constraint failed (two writers picked same nextSeq)
      // - Serialization conflict
      const msg = String(err?.message || "");
      const isRetryable =
        msg.includes("Unique constraint") ||
        msg.includes("unique constraint") ||
        msg.includes("Serialization") ||
        msg.includes("could not serialize") ||
        msg.includes("P2002");

      if (!isRetryable || attempt === maxAttempts) throw err;

      // small jitter
      await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 60)));
      continue;
    }
  }

  throw new Error("Failed to allocate instrument reference after retries.");
}

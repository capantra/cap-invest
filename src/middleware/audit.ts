import { Request } from "express";
import { prisma } from "../prisma";

export async function audit(req: Request, action: string, target?: { type?: string; id?: string }, metadata?: any) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: req.user?.id,
        action,
        targetType: target?.type,
        targetId: target?.id,
        metadataJson: metadata ?? undefined,
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip,
        userAgent: req.headers["user-agent"] || undefined,
      },
    });
  } catch {
    // never block user flow because audit write failed
  }
}

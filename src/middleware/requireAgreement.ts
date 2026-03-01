import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";

export async function requireAgreementAccepted(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.redirect("/login");

  const latest = await prisma.agreement.findFirst({
    where: { key: "CONFIDENTIALITY" },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
  });

  if (!latest) return res.status(500).send("Agreement not configured.");

  const acceptance = await prisma.agreementAcceptance.findUnique({
    where: { userId_agreementId: { userId: req.user.id, agreementId: latest.id } },
  });

  if (!acceptance) return res.redirect("/agreement");
  next();
}

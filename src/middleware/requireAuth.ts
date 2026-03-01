import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { sha256 } from "../utils/crypto";

declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email: string; role: string; name?: string | null; canViewTreasury?: boolean };
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  if (!token) return res.redirect("/login");

  const tokenHash = sha256(token);
  const session = await prisma.session.findUnique({
    where: { sessionTokenHash: tokenHash },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    res.clearCookie("session");
    return res.redirect("/login");
  }

  if (!session.user.isActive) {
    res.clearCookie("session");
    return res.status(403).send("Account disabled.");
  }

  req.user = {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
    name: session.user.name,
    canViewTreasury: session.user.canViewTreasury,
  };

  next();
}

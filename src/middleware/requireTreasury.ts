import { Request, Response, NextFunction } from "express";

export function requireTreasuryAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.redirect("/login");
  if (req.user.role !== "ADMIN") return res.status(403).send("Forbidden");
  if (!req.user.canViewTreasury) return res.status(403).send("Treasury access required.");
  next();
}

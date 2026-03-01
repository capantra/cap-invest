import { Request, Response, NextFunction } from "express";

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.redirect("/login");
    if (!roles.includes(req.user.role)) return res.status(403).send("Forbidden");
    next();
  };
}

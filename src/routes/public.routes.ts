import { Router } from "express";
import { prisma } from "../prisma";
import { sha256 } from "../utils/crypto";
import { audit } from "../middleware/audit";
import { createSession, hashPassword, verifyPassword } from "../services/auth.service";
import { issueLoginOtp, verifyLoginOtp } from "../services/otp.service";
import { getLatestConfidentialityAgreement, acceptAgreement } from "../services/agreements.service";
import { consumeUnsubscribeToken } from "../services/unsubscribe.service";

export const publicRoutes = Router();

/**
 * Helpers
 */
function getIp(req: any) {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip;
}
function getUA(req: any) {
  return req.headers["user-agent"] || "";
}

function setFlash(res: any, type: "error" | "success", message: string) {
  // simplest flash: cookie-based
  res.cookie("flash", JSON.stringify({ type, message }), { httpOnly: true, sameSite: "lax" });
}
function consumeFlash(req: any, res: any) {
  const raw = req.cookies?.flash;
  if (!raw) return null;
  res.clearCookie("flash");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * GET /login
 */
publicRoutes.get("/login", async (req, res) => {
  if (req.cookies?.session) return res.redirect("/dashboard");
  const flash = consumeFlash(req, res);
  res.render("public/login", { flash, turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || "" });
});

/**
 * POST /login
 * - verify email+password
 * - if user is INVESTOR -> require OTP
 * - else create session immediately (but still must accept agreement before app access)
 */
publicRoutes.post("/login", async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const password = String(req.body.password || "");
  if (!email || !password) {
    setFlash(res, "error", "Enter your email and password.");
    return res.redirect("/login");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !user.isActive) {
    setFlash(res, "error", "Invalid login.");
    return res.redirect("/login");
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await audit(req, "LOGIN_FAILED", { type: "User", id: user.id }, { email });
    setFlash(res, "error", "Invalid login.");
    return res.redirect("/login");
  }

  // Investors: OTP required
  if (user.role === "INVESTOR") {
    await issueLoginOtp({
      userId: user.id,
      email: user.email,
      ttlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
    });

    await audit(req, "OTP_SENT", { type: "User", id: user.id }, { purpose: "LOGIN_2FA" });

    // Store pending user id in short-lived cookie
    res.cookie("pending_2fa", user.id, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
    });

    setFlash(res, "success", "Verification code sent to your email.");
    return res.redirect("/login/otp");
  }

  // Preinvestor/Admin (if you ever allow admin on public login): session immediately
  const { raw } = await createSession({
    userId: user.id,
    ip: getIp(req),
    userAgent: getUA(req),
  });

  res.cookie("session", raw, { httpOnly: true, sameSite: "lax" });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(req, "LOGIN_SUCCESS", { type: "User", id: user.id });

  return res.redirect("/dashboard");
});

/**
 * GET /login/otp
 */
publicRoutes.get("/login/otp", async (req, res) => {
  const pendingUserId = req.cookies?.pending_2fa;
  if (!pendingUserId) return res.redirect("/login");

  const flash = consumeFlash(req, res);
  res.render("public/otp", { flash });
});

/**
 * POST /login/otp
 */
publicRoutes.post("/login/otp", async (req, res) => {
  const pendingUserId = req.cookies?.pending_2fa;
  if (!pendingUserId) return res.redirect("/login");

  const otp = String(req.body.otp || "").trim();
  if (!otp || otp.length < 6) {
    setFlash(res, "error", "Enter the 6-digit code.");
    return res.redirect("/login/otp");
  }

  const ok = await verifyLoginOtp({ userId: pendingUserId, otp });
  if (!ok) {
    await audit(req, "OTP_VERIFY_FAILED", { type: "User", id: pendingUserId });
    setFlash(res, "error", "Invalid or expired code.");
    return res.redirect("/login/otp");
  }

  const user = await prisma.user.findUnique({ where: { id: pendingUserId } });
  if (!user || !user.isActive) {
    setFlash(res, "error", "Account disabled.");
    return res.redirect("/login");
  }

  const { raw } = await createSession({
    userId: user.id,
    ip: getIp(req),
    userAgent: getUA(req),
  });

  res.clearCookie("pending_2fa");
  res.cookie("session", raw, { httpOnly: true, sameSite: "lax" });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(req, "LOGIN_SUCCESS_2FA", { type: "User", id: user.id });

  return res.redirect("/dashboard");
});

/**
 * GET /logout
 */
publicRoutes.get("/logout", async (req, res) => {
  const raw = req.cookies?.session;
  if (raw) {
    const hash = sha256(raw);
    await prisma.session.updateMany({
      where: { sessionTokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.clearCookie("session");
  res.clearCookie("pending_2fa");
  return res.redirect("/login");
});

/**
 * GET /invite/:token
 * - validate invite token (hash match)
 * - show set password form
 */
publicRoutes.get("/invite/:token", async (req, res) => {
  const raw = String(req.params.token || "");
  if (!raw) return res.status(400).send("Invalid invite.");

  const tokenHash = sha256(raw);
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    setFlash(res, "error", "Invite link is invalid or has expired.");
    return res.redirect("/login");
  }

  const flash = consumeFlash(req, res);
  res.render("public/invite", { flash, email: invite.email });
});

/**
 * POST /invite/:token
 * - create user if doesn't exist
 * - set password
 * - mark invite used
 * - create session (investors will still do OTP at next login)
 * - redirect to agreement
 */
publicRoutes.post("/invite/:token", async (req, res) => {
  const raw = String(req.params.token || "");
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").trim();

  if (password.length < 10) {
    setFlash(res, "error", "Password must be at least 10 characters.");
    return res.redirect(`/invite/${raw}`);
  }

  const tokenHash = sha256(raw);
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    setFlash(res, "error", "Invite link is invalid or has expired.");
    return res.redirect("/login");
  }

  const email = invite.email.toLowerCase();
  const pwHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash: pwHash,
      name: name || undefined,
      role: invite.role,
      isActive: true,
      canViewTreasury: invite.canViewTreasury,
    },
    create: {
      email,
      passwordHash: pwHash,
      name: name || undefined,
      role: invite.role,
      canViewTreasury: invite.canViewTreasury,
    },
  });

  await prisma.invite.update({
    where: { id: invite.id },
    data: { usedAt: new Date() },
  });

  const { raw: sessionRaw } = await createSession({
    userId: user.id,
    ip: getIp(req),
    userAgent: getUA(req),
  });

  res.cookie("session", sessionRaw, { httpOnly: true, sameSite: "lax" });

  await audit(req, "INVITE_ACCEPTED", { type: "User", id: user.id }, { role: user.role });

  // Must accept agreement before anything else
  return res.redirect("/agreement");
});

/**
 * GET /agreement
 * - show latest confidentiality agreement
 */
publicRoutes.get("/agreement", async (req, res) => {
  // We allow showing this only if user has a session
  const raw = req.cookies?.session;
  if (!raw) return res.redirect("/login");

  const session = await prisma.session.findUnique({
    where: { sessionTokenHash: sha256(raw) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    res.clearCookie("session");
    return res.redirect("/login");
  }

  const agreement = await getLatestConfidentialityAgreement();
  if (!agreement) return res.status(500).send("Agreement not configured.");

  const flash = consumeFlash(req, res);
  res.render("public/agreement", { flash, agreement, user: session.user });
});

/**
 * POST /agreement/accept
 */
publicRoutes.post("/agreement/accept", async (req, res) => {
  const raw = req.cookies?.session;
  if (!raw) return res.redirect("/login");

  const session = await prisma.session.findUnique({
    where: { sessionTokenHash: sha256(raw) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    res.clearCookie("session");
    return res.redirect("/login");
  }

  const agree = String(req.body.agree || "") === "on";
  if (!agree) {
    setFlash(res, "error", "You must accept the agreement to continue.");
    return res.redirect("/agreement");
  }

  const agreement = await getLatestConfidentialityAgreement();
  if (!agreement) return res.status(500).send("Agreement not configured.");

  await acceptAgreement({
    userId: session.user.id,
    agreementId: agreement.id,
    ip: getIp(req),
    userAgent: getUA(req),
  });

  await audit(req, "AGREEMENT_ACCEPTED", { type: "Agreement", id: agreement.id }, { version: agreement.version });

  return res.redirect("/dashboard");
});

/**
 * GET /unsubscribe?token=...
 * - one-click: consumes token, sets opt-out, shows confirmation
 */
publicRoutes.get("/unsubscribe", async (req, res) => {
  const token = String(req.query.token || "");
  const flash = consumeFlash(req, res);

  if (!token) return res.render("public/unsubscribe", { flash, status: "missing" });

  const userId = await consumeUnsubscribeToken(token);
  if (!userId) return res.render("public/unsubscribe", { flash, status: "invalid" });

  return res.render("public/unsubscribe", { flash, status: "ok" });
});

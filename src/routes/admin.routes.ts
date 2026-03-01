import { Router } from "express";
import { Prisma } from "@prisma/client";

import { requireAuth } from "../middleware/requireAuth";
import { requireAgreementAccepted } from "../middleware/requireAgreement";
import { requireRole } from "../middleware/requireRole";
import { prisma } from "../prisma";
import { audit } from "../middleware/audit";
import { createInvite } from "../services/invite.service";
import { sendBulkUpdateForPublishedUpdate } from "../services/updates.service";
import { createInvestorInstrumentWithRef } from "../services/instrumentRef.service";
import { sendEmail } from "../services/email.service";
import { renderEmailTemplate, escapeHtml } from "../services/email.templates";
import { treasuryRoutes } from "./treasury.routes";
import { upload } from "../middleware/upload";
import { s3Service } from "../services/s3.service";
import { requireTreasuryAccess } from "../middleware/requireTreasury";

export const adminRoutes = Router();

adminRoutes.use(requireAuth);
adminRoutes.use(requireAgreementAccepted);
adminRoutes.use(requireRole("ADMIN"));

// locals
adminRoutes.use((req, res, next) => {
  res.locals.user = req.user;
  // you said you fixed nav rendering via a key — keep that consistent
  res.locals.navKey = "admin";
  next();
});

// Mount treasury routes
adminRoutes.use("/treasury", requireTreasuryAccess, treasuryRoutes);

function appUrl() {
  return String(process.env.APP_URL || process.env.APP_BASE_URL || "http://localhost:4000");
}

function csvEscape(v: any) {
  const s = v === null || typeof v === "undefined" ? "" : String(v);
  const needs = /[",\n\r]/.test(s);
  const safe = s.replace(/"/g, '""');
  return needs ? `"${safe}"` : safe;
}

function isValidDate(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Admin home
 * NOTE: adminRoutes is mounted at /admin
 */
adminRoutes.get("/", async (req, res) => {
  const [users, updates, campaigns, auditCount, recentAudit] = await Promise.all([
    prisma.user.count(),
    prisma.update.count(),
    prisma.emailCampaign.count(),
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { actor: true },
    }),
  ]);

  // Calculate total company valuation
  const allShareholders = await prisma.shareholdingProfile.findMany();
  
  let totalCompanyValuation = 0;
  let averageSharePrice = 0;
  
  if (allShareholders.length > 0) {
    const totalPrice = allShareholders.reduce((sum, sh) => {
      return sum + parseFloat(sh.pricePerShare.toString());
    }, 0);
    
    averageSharePrice = totalPrice / allShareholders.length;
    
    totalCompanyValuation = allShareholders.reduce((sum, sh) => {
      return sum + (sh.sharesTotal * averageSharePrice);
    }, 0);
  }

  res.render("app/admin/index", {
    title: "Admin",
    stats: { users, updates, campaigns, audit: auditCount },
    recentAudit,
    totalCompanyValuation,
    averageSharePrice,
  });
});

/**
 * Users / Invites
 * NOTE: view lives at src/views/app/admin/users.ejs.
 */
adminRoutes.get("/users", async (req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const invites = await prisma.invite.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  res.render("app/admin/users", { title: "Users", users, invites });
});

adminRoutes.post("/users/invite", async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const roleRaw = String(req.body.role || "").trim().toUpperCase();
  const allowedRoles = ["ADMIN", "INVESTOR", "PREINVESTOR"];

  if (!email || !allowedRoles.includes(roleRaw)) {
    return res.status(400).send("Invalid request.");
  }

  const role = roleRaw as "ADMIN" | "INVESTOR" | "PREINVESTOR";
  const canViewTreasury =
    role === "ADMIN" && (String(req.body.canViewTreasury || "").toLowerCase() === "on" ||
      String(req.body.canViewTreasury || "").toLowerCase() === "true");

  const ttlHours = Number(process.env.INVITE_TTL_HOURS || 72);

  await createInvite({
    email,
    role,
    canViewTreasury,
    createdBy: req.user!.id,
    appUrl: appUrl(),
    ttlHours,
  });

  await audit(req, "INVITE_CREATED", { type: "Invite", id: email }, { email, role, ttlHours });

  res.redirect("/admin/users");
});

/* ============================================================
 * ADMIN → INVESTORS
 * ============================================================ */

adminRoutes.get("/investors", async (req, res) => {
  const [investors, preinvestors] = await Promise.all([
    prisma.user.findMany({
      where: { role: "INVESTOR" },
      orderBy: { email: "asc" },
      include: { shareholdingProfile: true },
      take: 2000,
    }),
    prisma.user.findMany({
      where: { role: "PREINVESTOR" },
      orderBy: { email: "asc" },
      include: {
        investorInstruments: {
          orderBy: { signedAt: "desc" },
          take: 1,
        },
      },
      take: 2000,
    }),
  ]);

  res.render("app/admin/investors/index", {
    title: "Investors",
    investors,
    preinvestors,
  });
});

adminRoutes.get("/investors/new", async (req, res) => {
  const role = String(req.query.role || "INVESTOR").toUpperCase();
  const safeRole = role === "PREINVESTOR" ? "PREINVESTOR" : "INVESTOR";

  res.render("app/admin/investors/new", {
    title: safeRole === "INVESTOR" ? "Add Investor" : "Add Pre-investor",
    role: safeRole,
    flash: res.locals.flash,
  });
});

adminRoutes.post("/investors", async (req, res) => {
  const role = String(req.body.role || "INVESTOR").toUpperCase();
  const safeRole = role === "PREINVESTOR" ? "PREINVESTOR" : "INVESTOR";

  const contactEmail = String(req.body.contactEmail || "").trim().toLowerCase();
  const contactFirstName = String(req.body.contactFirstName || "").trim();
  const contactLastName = String(req.body.contactLastName || "").trim() || null;
  const contactPhone = String(req.body.contactPhone || "").trim() || null;

  const email = contactEmail;
  const name = contactFirstName;

  if (!email) return res.status(400).send("Missing email (contactEmail).");
  if (!name) return res.status(400).send("Missing name (contactFirstName).");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(400).send("A user with this email already exists.");

  const preInvestorInstrumentRaw = String(req.body.preInvestorInstrument || "NONE").toUpperCase();
  const preInvestorInstrument =
    preInvestorInstrumentRaw === "SAFE"
      ? "SAFE"
      : preInvestorInstrumentRaw === "NOTE"
      ? "NOTE"
      : "NONE";

  const preInvestorNotes = String(req.body.preInvestorNotes || "").trim() || null;

  const createdUser = await prisma.user.create({
    data: {
      email,
      name,
      role: safeRole as any,
      isActive: true,
      preInvestorInstrument: safeRole === "PREINVESTOR" ? (preInvestorInstrument as any) : "NONE",
      preInvestorNotes: safeRole === "PREINVESTOR" ? preInvestorNotes : null,
    },
  });

  if (safeRole === "INVESTOR") {
    const shareholdingTypeRaw = String(req.body.shareholdingType || "INDIVIDUAL").toUpperCase();
    const shareholdingType = (shareholdingTypeRaw === "BUSINESS" ? "BUSINESS" : "INDIVIDUAL") as any;

    const businessName = String(req.body.businessName || "").trim() || null;

    const sharesTotalRaw = Number(req.body.sharesTotal || 0);
    const sharesTotal = Number.isFinite(sharesTotalRaw) ? Math.max(0, Math.floor(sharesTotalRaw)) : 0;

    const pricePerShareRaw = String(req.body.pricePerShare || "0").trim();
    const unpaidPerShareRaw = String(req.body.unpaidPerShare || "").trim();

    const currency = String(req.body.currency || "AUD").trim().toUpperCase() || "AUD";

    const addressLine1 = String(req.body.addressLine1 || "").trim();
    const addressLine2 = String(req.body.addressLine2 || "").trim() || null;
    const suburbOrCity = String(req.body.suburbOrCity || "").trim();
    const stateOrRegion = String(req.body.stateOrRegion || "").trim() || null;
    const postcode = String(req.body.postcode || "").trim() || null;
    const country = String(req.body.country || "AU").trim().toUpperCase() || "AU";

    if (!addressLine1 || !suburbOrCity) {
      return res.status(400).send("Missing address line 1 or suburb/city.");
    }

    await prisma.shareholdingProfile.create({
      data: {
        userId: createdUser.id,
        shareholdingType,

        contactEmail,
        contactPhone,
        contactFirstName,
        contactLastName,

        businessName: shareholdingType === "BUSINESS" ? businessName : null,

        addressLine1,
        addressLine2,
        suburbOrCity,
        stateOrRegion,
        postcode,
        country,

        sharesTotal,
        pricePerShare: new Prisma.Decimal(pricePerShareRaw || "0"),
        unpaidPerShare: unpaidPerShareRaw ? new Prisma.Decimal(unpaidPerShareRaw) : null,
        currency,
      },
    });
  }

  if (safeRole === "PREINVESTOR" && (preInvestorInstrument === "SAFE" || preInvestorInstrument === "NOTE")) {
    const instrumentSignedAtRaw = String(req.body.instrumentSignedAt || "").trim();
    const instrumentSignedAt = instrumentSignedAtRaw ? new Date(instrumentSignedAtRaw) : new Date();
    if (!isValidDate(instrumentSignedAt)) return res.status(400).send("Invalid instrument signed date.");

    const purchaseAmountRaw = String(req.body.instrumentPurchaseAmount || "").trim();
    const purchaseAmount = Number(purchaseAmountRaw);
    const hasPurchaseAmount = Number.isFinite(purchaseAmount) && purchaseAmount > 0;

    if (hasPurchaseAmount) {
      const purchaseAmountCents = Math.round(purchaseAmount * 100);

      const discountRaw = String(req.body.instrumentDiscountPercent || "").trim();
      const discountPercent = discountRaw === "" ? null : Number(discountRaw);

      if (discountPercent !== null) {
        if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
          return res.status(400).send("Discount % must be an integer between 0 and 100.");
        }
      }

      const statusRaw = String(req.body.instrumentStatus || "OUTSTANDING").toUpperCase();
      const status =
        statusRaw === "CONVERTED" ? "CONVERTED" : statusRaw === "CANCELLED" ? "CANCELLED" : "OUTSTANDING";

      await createInvestorInstrumentWithRef({
        prisma,
        investorId: createdUser.id,
        type: preInvestorInstrument as "SAFE" | "NOTE",
        signedAt: instrumentSignedAt,
        purchaseAmountCents,
        discountPercent,
        status,
        notes: String(req.body.instrumentNotes || "").trim() || null,
      });

      await audit(
        req,
        "INVESTOR_INSTRUMENT_CREATED",
        { type: "User", id: createdUser.id },
        { instrumentType: preInvestorInstrument, purchaseAmount }
      );
    }
  }

  const ttlHours = Number(process.env.INVITE_TTL_HOURS || 72);

  await createInvite({
    email,
    role: safeRole as any,
    canViewTreasury: false,
    createdBy: req.user!.id,
    appUrl: appUrl(),
    ttlHours,
  });

  await audit(req, "ADMIN_USER_CREATED", { type: "User", id: createdUser.id }, { role: safeRole, email });

  res.redirect("/admin/investors");
});

adminRoutes.get("/investors/:id", async (req, res) => {
  const id = String(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id },
    include: { shareholdingProfile: true },
  });

  if (!user) return res.status(404).render("public/404", { title: "Not Found" });

  res.render("app/admin/investors/view", {
    title: "Investor profile",
    user,
    shareholding: user.shareholdingProfile,
  });
});

adminRoutes.get("/investors/:id/edit", async (req, res) => {
  const id = String(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      shareholdingProfile: true,
      investorInstruments: { orderBy: { signedAt: "desc" } },
    },
  });

  if (!user) return res.status(404).render("public/404", { title: "Not Found" });

  res.render("app/admin/investors/edit", {
    title: "Edit Investor",
    user,
    shareholding: user.shareholdingProfile,
    instruments: user.investorInstruments,
    flash: res.locals.flash,
  });
});

adminRoutes.post("/investors/:id", async (req, res) => {
  const id = String(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id },
    include: { shareholdingProfile: true },
  });

  if (!user) return res.status(404).render("public/404", { title: "Not Found" });

  const name = String(req.body.contactFirstName || "").trim();
  const isActive = String(req.body.isActive || "true") === "true";
  if (!name) return res.status(400).send("Missing name (contactFirstName).");

  const preInvestorInstrumentRaw = String(
    req.body.preInvestorInstrument || user.preInvestorInstrument || "NONE"
  ).toUpperCase();
  const preInvestorInstrument =
    preInvestorInstrumentRaw === "SAFE"
      ? "SAFE"
      : preInvestorInstrumentRaw === "NOTE"
      ? "NOTE"
      : "NONE";

  const preInvestorNotes = String(req.body.preInvestorNotes || "").trim() || null;

  await prisma.user.update({
    where: { id },
    data: {
      name,
      isActive,
      ...(user.role === "PREINVESTOR"
        ? { preInvestorInstrument: preInvestorInstrument as any, preInvestorNotes }
        : {}),
    },
  });

  if (user.role === "INVESTOR") {
    const shareholdingTypeRaw = String(req.body.shareholdingType || "INDIVIDUAL").toUpperCase();
    const shareholdingType = (shareholdingTypeRaw === "BUSINESS" ? "BUSINESS" : "INDIVIDUAL") as any;

    const contactEmail = String(req.body.contactEmail || user.email).trim().toLowerCase();
    const contactFirstName = String(req.body.contactFirstName || "").trim();
    const contactLastName = String(req.body.contactLastName || "").trim() || null;
    const contactPhone = String(req.body.contactPhone || "").trim() || null;

    const businessName = String(req.body.businessName || "").trim() || null;

    const sharesTotalRaw = Number(req.body.sharesTotal || 0);
    const sharesTotal = Number.isFinite(sharesTotalRaw) ? Math.max(0, Math.floor(sharesTotalRaw)) : 0;

    const pricePerShareRaw = String(req.body.pricePerShare || "0").trim();
    const unpaidPerShareRaw = String(req.body.unpaidPerShare || "").trim();
    const currency = String(req.body.currency || "AUD").trim().toUpperCase() || "AUD";

    const addressLine1 = String(req.body.addressLine1 || "").trim();
    const addressLine2 = String(req.body.addressLine2 || "").trim() || null;
    const suburbOrCity = String(req.body.suburbOrCity || "").trim();
    const stateOrRegion = String(req.body.stateOrRegion || "").trim() || null;
    const postcode = String(req.body.postcode || "").trim() || null;
    const country = String(req.body.country || "AU").trim().toUpperCase() || "AU";

    if (!addressLine1 || !suburbOrCity) {
      return res.status(400).send("Missing address line 1 or suburb/city.");
    }

    await prisma.shareholdingProfile.upsert({
      where: { userId: user.id },
      update: {
        shareholdingType,
        contactEmail,
        contactPhone,
        contactFirstName,
        contactLastName,
        businessName: shareholdingType === "BUSINESS" ? businessName : null,
        addressLine1,
        addressLine2,
        suburbOrCity,
        stateOrRegion,
        postcode,
        country,
        sharesTotal,
        pricePerShare: new Prisma.Decimal(pricePerShareRaw || "0"),
        unpaidPerShare: unpaidPerShareRaw ? new Prisma.Decimal(unpaidPerShareRaw) : null,
        currency,
      },
      create: {
        userId: user.id,
        shareholdingType,
        contactEmail,
        contactPhone,
        contactFirstName,
        contactLastName,
        businessName: shareholdingType === "BUSINESS" ? businessName : null,
        addressLine1,
        addressLine2,
        suburbOrCity,
        stateOrRegion,
        postcode,
        country,
        sharesTotal,
        pricePerShare: new Prisma.Decimal(pricePerShareRaw || "0"),
        unpaidPerShare: unpaidPerShareRaw ? new Prisma.Decimal(unpaidPerShareRaw) : null,
        currency,
      },
    });
  }

  await audit(req, "ADMIN_USER_UPDATED", { type: "User", id: user.id }, { role: user.role });

  res.redirect("/admin/investors");
});

adminRoutes.post("/investors/:id/instruments", async (req, res) => {
  const investorId = String(req.params.id);

  const user = await prisma.user.findUnique({ where: { id: investorId }, select: { id: true, role: true } });
  if (!user) return res.status(404).send("User not found.");
  if (user.role !== "PREINVESTOR") {
    return res.status(400).send("Instruments can only be attached to PREINVESTOR users.");
  }

  const typeRaw = String(req.body.type || "").toUpperCase();
  const type = typeRaw === "NOTE" ? "NOTE" : "SAFE";

  const signedAtRaw = String(req.body.signedAt || "").trim();
  const signedAt = signedAtRaw ? new Date(signedAtRaw) : new Date();
  if (!isValidDate(signedAt)) return res.status(400).send("Invalid signedAt date.");

  const amount = Number(String(req.body.purchaseAmount || "").trim());
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).send("Purchase amount must be a positive number.");
  const purchaseAmountCents = Math.round(amount * 100);

  const discountRaw = String(req.body.discountPercent || "").trim();
  const discountPercent = discountRaw === "" ? null : Number(discountRaw);
  if (discountPercent !== null) {
    if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      return res.status(400).send("Discount % must be an integer between 0 and 100.");
    }
  }

  const statusRaw = String(req.body.status || "OUTSTANDING").toUpperCase();
  const status =
    statusRaw === "CONVERTED" ? "CONVERTED" : statusRaw === "CANCELLED" ? "CANCELLED" : "OUTSTANDING";

  const notes = String(req.body.notes || "").trim() || null;

  await createInvestorInstrumentWithRef({
    prisma,
    investorId,
    type: type as any,
    signedAt,
    purchaseAmountCents,
    discountPercent,
    status: status as any,
    notes,
  });

  await audit(req, "INVESTOR_INSTRUMENT_CREATED", { type: "User", id: investorId }, { type, amount });

  res.redirect(`/admin/investors/${investorId}/edit`);
});

adminRoutes.post("/instruments/:instrumentId/status", async (req, res) => {
  const instrumentId = String(req.params.instrumentId);

  const statusRaw = String(req.body.status || "").toUpperCase();
  if (!["OUTSTANDING", "CONVERTED", "CANCELLED"].includes(statusRaw)) {
    return res.status(400).send("Invalid status.");
  }

  const instrument = await prisma.investorInstrument.findUnique({
    where: { id: instrumentId },
    include: { investor: { select: { id: true, role: true } } },
  });
  if (!instrument) return res.status(404).send("Instrument not found.");

  if (!instrument.investor || instrument.investor.role !== "PREINVESTOR") {
    return res.status(400).send("Instruments are only supported for PREINVESTOR users.");
  }

  const updated = await prisma.investorInstrument.update({
    where: { id: instrumentId },
    data: {
      status: statusRaw as any,
      convertedAt: statusRaw === "CONVERTED" ? new Date() : null,
    },
  });

  const latest = await prisma.investorInstrument.findFirst({
    where: { investorId: updated.investorId, status: "OUTSTANDING" },
    orderBy: { signedAt: "desc" },
    select: { type: true },
  });

  await prisma.user.update({
    where: { id: updated.investorId },
    data: { preInvestorInstrument: (latest?.type ?? "NONE") as any },
  });

  await audit(
    req,
    "INVESTOR_INSTRUMENT_STATUS_UPDATED",
    { type: "InvestorInstrument", id: instrumentId },
    { status: statusRaw }
  );

  res.redirect(`/admin/investors/${updated.investorId}/edit`);
});

/* ============================================================
 * ADMIN → INSTRUMENTS
 * ============================================================ */

adminRoutes.get("/instruments", async (req, res) => {
  const type = String(req.query.type || "ALL").toUpperCase(); // ALL | SAFE | NOTE
  const status = String(req.query.status || "ALL").toUpperCase(); // ALL | OUTSTANDING | CONVERTED | CANCELLED

  const instruments = await prisma.investorInstrument.findMany({
    where: {
      ...(type !== "ALL" ? { type: type as any } : {}),
      ...(status !== "ALL" ? { status: status as any } : {}),
      investor: { role: "PREINVESTOR" },
    },
    orderBy: [{ signedAt: "desc" }, { instrumentRef: "desc" }],
    include: { investor: { select: { id: true, email: true, name: true, role: true } } },
    take: 2000,
  });

  res.render("app/admin/instruments/index", {
    title: "Instruments",
    instruments,
    filters: { type, status },
  });
});

adminRoutes.get("/instruments/export/safe.csv", async (req, res) => {
  const type = String(req.query.type || "SAFE").toUpperCase();
  if (!["SAFE", "NOTE"].includes(type)) return res.status(400).send("Invalid type.");

  const instruments = await prisma.investorInstrument.findMany({
    where: { type: type as any, investor: { role: "PREINVESTOR" } },
    orderBy: [{ signedAt: "desc" }, { instrumentRef: "desc" }],
    include: { investor: { select: { id: true, email: true, name: true, role: true } } },
    take: 10000,
  });

  const header = [
    "InstrumentRef",
    "Type",
    "Status",
    "SignedAt",
    "PurchaseAmount",
    "Currency",
    "DiscountPercent",
    "InvestorName",
    "InvestorEmail",
    "InvestorRole",
    "ConvertedAt",
    "Notes",
  ];

  const rows = instruments.map((i) => {
    const amount = (i.purchaseAmountCents || 0) / 100;
    return [
      i.instrumentRef,
      i.type,
      i.status,
      i.signedAt ? new Date(i.signedAt).toISOString().slice(0, 10) : "",
      amount.toFixed(2),
      i.currency || "AUD",
      i.discountPercent ?? "",
      i.investor?.name ?? "",
      i.investor?.email ?? "",
      i.investor?.role ?? "",
      i.convertedAt ? new Date(i.convertedAt).toISOString().slice(0, 10) : "",
      i.notes ?? "",
    ]
      .map(csvEscape)
      .join(",");
  });

  const csv = [header.join(","), ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="capantra_${type.toLowerCase()}_register_${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(csv);
});

adminRoutes.post("/investors/:id/delete", async (req, res) => {
  const id = String(req.params.id);

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).render("public/404", { title: "Not Found" });

  if (user.role !== "PREINVESTOR") {
    return res.status(400).send("Only PREINVESTOR accounts can be deleted.");
  }

  await prisma.$transaction([
    prisma.investorInstrument.deleteMany({ where: { investorId: id } }),
    prisma.session.deleteMany({ where: { userId: id } }),
    prisma.emailOtp.deleteMany({ where: { userId: id } }),
    prisma.agreementAcceptance.deleteMany({ where: { userId: id } }),
    prisma.emailPreference.deleteMany({ where: { userId: id } }),
    prisma.unsubscribeToken.deleteMany({ where: { userId: id } }),
    prisma.emailCampaignRecipient.deleteMany({ where: { userId: id } }),
    prisma.invite.deleteMany({ where: { email: user.email } }),
    prisma.user.delete({ where: { id } }),
  ]);

  await audit(req, "ADMIN_PREINVESTOR_DELETED", { type: "User", id }, { email: user.email });

  res.redirect("/admin/investors");
});

/* ============================================================
 * ADMIN → UPDATES (create, view, publish, list)
 * Views live under: src/views/app/admin/updates/*
 * ============================================================ */

adminRoutes.get("/updates", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const visibility = typeof req.query.visibility === "string" ? req.query.visibility.trim() : "ALL";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "ALL"; // ALL|PUBLISHED|DRAFT

  const where: any = {};
  if (q) where.title = { contains: q, mode: "insensitive" };
  if (visibility !== "ALL") where.visibility = visibility;
  if (status === "PUBLISHED") where.publishedAt = { not: null };
  if (status === "DRAFT") where.publishedAt = null;

  const updates = await prisma.update.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 300,
    include: {
      type: true,
      tags: { include: { tag: true } },
      attachments: { orderBy: { createdAt: "asc" } },
      creator: true,
    },
  });

  res.render("app/admin/updates/index", {
    title: "Updates",
    updates,
    filters: { q, visibility, status },
  });
});

adminRoutes.get("/updates/new", async (req, res) => {
  const types = await prisma.updateType.findMany({ orderBy: { name: "asc" } });
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });

  res.render("app/admin/updates/new", { title: "Create Update", types, tags });
});

adminRoutes.post("/updates", async (req, res) => {
  const title = String(req.body.title || "").trim();
  const bodyHtml = String(req.body.bodyHtml || "").trim() || null;
  const typeId = String(req.body.typeId || "").trim();
  const visibility = String(req.body.visibility || "PORTAL_ALL").trim() as any;
  const isPdfDistribution = String(req.body.isPdfDistribution || "") === "on";

  const tagNames = String(req.body.tags || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!title || !typeId || !["PORTAL_ALL", "INVESTOR_ONLY"].includes(visibility)) {
    return res.status(400).send("Missing required fields.");
  }

  const update = await prisma.update.create({
    data: {
      title,
      bodyHtml,
      typeId,
      visibility,
      isPdfDistribution,
      createdBy: req.user!.id,
    },
  });

  for (const nameRaw of tagNames) {
    const name = String(nameRaw).trim();
    if (!name) continue;

    const tag = await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
    });

    await prisma.updateTag.upsert({
      where: { updateId_tagId: { updateId: update.id, tagId: tag.id } },
      update: {},
      create: { updateId: update.id, tagId: tag.id },
    });
  }

  await audit(req, "UPDATE_CREATED", { type: "Update", id: update.id }, { title, visibility, isPdfDistribution });

  res.redirect(`/admin/updates/${update.id}`);
});

adminRoutes.get("/updates/:id", async (req, res) => {
  const id = String(req.params.id);

  const update = await prisma.update.findUnique({
    where: { id },
    include: {
      type: true,
      attachments: { orderBy: { createdAt: "asc" } },
      tags: { include: { tag: true } },
      creator: true,
    },
  });
  if (!update) return res.status(404).render("public/404", { title: "Not Found" });

  res.render("app/admin/updates/view", { title: update.title, update });
});

/**
 * Attachment create - now handles file uploads to S3
 */
adminRoutes.post("/updates/:id/attachments", upload.single("file"), async (req, res) => {
  const updateId = String(req.params.id);

  if (!req.file) return res.status(400).send("No file uploaded.");

  const exists = await prisma.update.findUnique({ where: { id: updateId }, select: { id: true } });
  if (!exists) return res.status(404).send("Update not found.");

  // Upload to S3
  const { key, url } = await s3Service.uploadFile(req.file, "updates");

  // Create attachment record
  const attachment = await prisma.attachment.create({
    data: {
      updateId,
      storageKey: key,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    },
  });

  await audit(req, "ATTACHMENT_CREATED", { type: "Attachment", id: attachment.id }, { updateId, fileName: req.file.originalname, s3Url: url });

  res.redirect(`/admin/updates/${updateId}`);
});

adminRoutes.post("/updates/:id/publish", async (req, res) => {
  const updateId = String(req.params.id);

  const update = await prisma.update.findUnique({
    where: { id: updateId },
    include: { attachments: true, type: true },
  });
  if (!update) return res.status(404).send("Not found.");

  if (update.publishedAt) return res.redirect(`/admin/updates/${updateId}`);

  if (update.isPdfDistribution && update.attachments.length === 0) {
    return res.status(400).send("This update requires a PDF attachment before publishing.");
  }

  const published = await prisma.update.update({
    where: { id: updateId },
    data: { publishedAt: new Date() },
    include: { type: true },
  });

  await audit(req, "UPDATE_PUBLISHED", { type: "Update", id: updateId }, { title: published.title });

  await sendBulkUpdateForPublishedUpdate({
    updateId,
    actorUserId: req.user!.id,
    appUrl: appUrl(),
    audienceMode: String(req.body.audienceMode || "AUTO").trim(),
    selectedEmails: String(req.body.selectedEmails || ""),
  });

  res.redirect(`/admin/updates/${updateId}`);
});

/* ============================================================
 * ADMIN → VOTING
 * ============================================================ */

adminRoutes.get("/votes", async (_req, res) => {
  const voteRequests = await prisma.voteRequest.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: {
      _count: { select: { responses: true, attachments: true } },
    },
  });

  res.render("app/admin/votes/index", { title: "Voting", voteRequests });
});

adminRoutes.get("/votes/new", async (_req, res) => {
  res.render("app/admin/votes/new", { title: "Create Vote Request" });
});

adminRoutes.post("/votes", upload.array("files"), async (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim() || null;
  const closesAtRaw = String(req.body.closesAt || "").trim();
  const closesAt = closesAtRaw ? new Date(closesAtRaw) : null;

  if (!title) return res.status(400).send("Title is required.");
  if (closesAt && Number.isNaN(closesAt.getTime())) {
    return res.status(400).send("Invalid close date.");
  }

  const voteRequest = await prisma.voteRequest.create({
    data: {
      title,
      description,
      createdBy: req.user!.id,
      closesAt,
    },
  });

  const files = (req.files || []) as Express.Multer.File[];
  const emailAttachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  for (const file of files) {
    const { key } = await s3Service.uploadFile(file, "votes");
    const attachment = await prisma.voteAttachment.create({
      data: {
        voteRequestId: voteRequest.id,
        storageKey: key,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });

    emailAttachments.push({
      filename: file.originalname,
      content: file.buffer,
      contentType: file.mimetype,
    });

    await audit(
      req,
      "VOTE_ATTACHMENT_CREATED",
      { type: "VoteAttachment", id: attachment.id },
      { voteRequestId: voteRequest.id, fileName: file.originalname }
    );
  }

  await audit(req, "VOTE_REQUEST_CREATED", { type: "VoteRequest", id: voteRequest.id }, { title });

  const investors = await prisma.user.findMany({
    where: { role: "INVESTOR", isActive: true },
    select: { id: true, email: true },
  });

  const voteLink = `${appUrl()}/votes/${voteRequest.id}`;
  const inner = `
    <p style="margin:0 0 10px;">
      A new investor vote is available in the portal.
    </p>
    <p style="margin:0 0 10px;">
      <strong>Topic:</strong> ${escapeHtml(title)}
    </p>
    ${description ? `<p style="margin:0 0 10px;">${escapeHtml(description)}</p>` : ""}
    ${voteRequest.closesAt ? `<p style="margin:0 0 10px;"><strong>Closes:</strong> ${escapeHtml(new Date(voteRequest.closesAt).toLocaleString())}</p>` : ""}
  `.trim();

  const html = renderEmailTemplate({
    title: `Vote required: ${title}`,
    preheader: "Please cast your vote in the investor portal.",
    bodyHtml: inner,
    primaryAction: { label: "Cast your vote", href: voteLink },
    secondaryAction: { label: "Open portal", href: appUrl() },
  });

  for (const investor of investors) {
    try {
      await sendEmail({
        to: investor.email,
        subject: `Vote required: ${title}`,
        html,
        attachments: emailAttachments.length ? emailAttachments : undefined,
        configurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
        tags: { kind: "vote_request", voteRequestId: voteRequest.id },
      });
    } catch (err) {
      console.error("Vote request email failed:", err);
    }
  }

  await audit(req, "VOTE_REQUEST_EMAIL_SENT", { type: "VoteRequest", id: voteRequest.id }, {
    recipients: investors.length,
  });

  res.redirect(`/admin/votes/${voteRequest.id}`);
});

adminRoutes.get("/votes/:id", async (req, res) => {
  const id = String(req.params.id);

  const voteRequest = await prisma.voteRequest.findUnique({
    where: { id },
    include: {
      attachments: { orderBy: { createdAt: "asc" } },
      responses: {
        orderBy: { createdAt: "desc" },
        include: { user: true },
      },
      creator: true,
    },
  });

  if (!voteRequest) return res.status(404).render("public/404", { title: "Not Found" });

  const eligibleInvestors = await prisma.user.findMany({
    where: { role: "INVESTOR", isActive: true },
    orderBy: { email: "asc" },
  });

  const respondedIds = new Set(voteRequest.responses.map((r) => r.userId));
  const notVoted = eligibleInvestors.filter((u) => !respondedIds.has(u.id));

  const totalResponses = voteRequest.responses.length;
  const counts = voteRequest.responses.reduce(
    (acc, r) => {
      if (r.choice === "FOR") acc.for += 1;
      else if (r.choice === "AGAINST") acc.against += 1;
      else acc.abstain += 1;
      return acc;
    },
    { for: 0, against: 0, abstain: 0 }
  );

  const pct = {
    for: totalResponses ? Math.round((counts.for / totalResponses) * 100) : 0,
    against: totalResponses ? Math.round((counts.against / totalResponses) * 100) : 0,
    abstain: totalResponses ? Math.round((counts.abstain / totalResponses) * 100) : 0,
  };

  res.render("app/admin/votes/view", {
    title: voteRequest.title,
    voteRequest,
    eligibleCount: eligibleInvestors.length,
    notVoted,
    voteCounts: counts,
    votePct: pct,
  });
});

adminRoutes.post("/votes/:id/attachments", upload.single("file"), async (req, res) => {
  const voteRequestId = String(req.params.id);

  if (!req.file) return res.status(400).send("No file uploaded.");

  const exists = await prisma.voteRequest.findUnique({ where: { id: voteRequestId }, select: { id: true } });
  if (!exists) return res.status(404).send("Vote request not found.");

  const { key } = await s3Service.uploadFile(req.file, "votes");

  const attachment = await prisma.voteAttachment.create({
    data: {
      voteRequestId,
      storageKey: key,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    },
  });

  await audit(
    req,
    "VOTE_ATTACHMENT_CREATED",
    { type: "VoteAttachment", id: attachment.id },
    { voteRequestId, fileName: req.file.originalname }
  );

  res.redirect(`/admin/votes/${voteRequestId}`);
});

adminRoutes.post("/votes/:id/close", async (req, res) => {
  const voteRequestId = String(req.params.id);

  const voteRequest = await prisma.voteRequest.findUnique({ where: { id: voteRequestId } });
  if (!voteRequest) return res.status(404).send("Vote request not found.");

  if (voteRequest.status === "CLOSED") {
    return res.redirect(`/admin/votes/${voteRequestId}`);
  }

  await prisma.voteRequest.update({
    where: { id: voteRequestId },
    data: { status: "CLOSED", closesAt: voteRequest.closesAt || new Date() },
  });

  await audit(req, "VOTE_REQUEST_CLOSED", { type: "VoteRequest", id: voteRequestId });

  res.redirect(`/admin/votes/${voteRequestId}`);
});

/**
 * Campaign builder
 * FIX: never render "something.new" (Express thinks ".new" is a template engine)
 */
adminRoutes.get("/campaigns/new", async (req, res) => {
  // Create the view later if you want. For now: render a safe placeholder page or 501.
  res.status(501).send("Campaign builder not implemented. Use Update publish distribution for now.");
});

/**
 * Audit logs
 */
adminRoutes.get("/audit", async (req, res) => {
  const action = String(req.query.action || "").trim();
  const actorEmail = String(req.query.actor || "").trim().toLowerCase();

  let actorId: string | undefined = undefined;
  if (actorEmail) {
    const actor = await prisma.user.findUnique({ where: { email: actorEmail } });
    actorId = actor?.id;
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      ...(action ? { action } : {}),
      ...(actorId ? { actorUserId: actorId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { actor: true },
  });

  res.render("app/admin/audit", { title: "Audit Log", logs, filters: { action, actorEmail } });
});

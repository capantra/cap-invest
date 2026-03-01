import { Router } from "express";

import { requireAuth } from "../middleware/requireAuth";
import { requireAgreementAccepted } from "../middleware/requireAgreement";
import { audit } from "../middleware/audit";
import { prisma } from "../prisma";
import { s3Service } from "../services/s3.service";

export const appRoutes = Router();

appRoutes.use(requireAuth);
appRoutes.use(requireAgreementAccepted);

// Shared locals
appRoutes.use((req, res, next) => {
  res.locals.user = req.user;

  res.locals.navKey =
  req.user?.role === "ADMIN"
    ? "admin"
    : req.user?.role === "PREINVESTOR"
    ? "preinvestor"
    : "investor";

  next();
});

function getIp(req: any) {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip;
}

function getUA(req: any) {
  return req.headers["user-agent"] || "";
}

/**
 * DASHBOARD
 */
appRoutes.get("/dashboard", async (req, res) => {
  await audit(req, "DASHBOARD_VIEWED");
  
  const shareholding = await prisma.shareholdingProfile.findUnique({
    where: { userId: req.user!.id },
  });
  
  // Calculate blended average price per share across all shareholders
  let averagePricePerShare = shareholding?.pricePerShare || 0;
  
  if (shareholding) {
    const allShareholders = await prisma.shareholdingProfile.findMany();
    
    if (allShareholders.length > 0) {
      const totalPrice = allShareholders.reduce((sum, sh) => {
        return sum + parseFloat(sh.pricePerShare.toString());
      }, 0);
      
      averagePricePerShare = totalPrice / allShareholders.length;
    }
  }
  
  // Fetch instruments for pre-investors
  const instruments = await prisma.investorInstrument.findMany({
    where: { investorId: req.user!.id },
    orderBy: { signedAt: "desc" },
  });
  
  res.render("app/dashboard", { 
    title: "Dashboard",
    shareholding,
    averagePricePerShare,
    instruments,
  });
});

/**
 * Request to purchase additional shares
 */
appRoutes.post("/dashboard/request-shares", async (req, res) => {
  const { shares, notes } = req.body;
  
  if (!shares || isNaN(parseInt(shares)) || parseInt(shares) <= 0) {
    return res.status(400).json({ error: "Invalid share quantity" });
  }
  
  try {
    await audit(req, "SHARE_PURCHASE_REQUESTED", null, { 
      shares: parseInt(shares),
      notes 
    });
    
    res.json({ 
      success: true, 
      message: "Your share purchase request has been submitted. We will review and contact you shortly." 
    });
  } catch (error) {
    console.error("Share purchase request error:", error);
    res.status(500).json({ error: "Failed to submit request" });
  }
});

/**
 * ACCOUNT
 */
appRoutes.get("/account", async (_req, res) => {
  res.render("app/account", { title: "Account" });
});

/**
 * Preferences
 */
appRoutes.get("/account/preferences", async (req, res) => {
  const pref = await prisma.emailPreference.findUnique({
    where: { userId: req.user!.id },
  });
  res.render("app/preferences", { title: "Email Preferences", pref });
});

appRoutes.post("/account/preferences", async (req, res) => {
  const bulk = String(req.body.bulkUpdatesOptOut || "") === "on";

  await prisma.emailPreference.upsert({
    where: { userId: req.user!.id },
    update: { bulkUpdatesOptOut: bulk },
    create: { userId: req.user!.id, bulkUpdatesOptOut: bulk },
  });

  await audit(req, "PREFERENCES_UPDATED", { type: "User", id: req.user!.id }, { bulkUpdatesOptOut: bulk });

  res.redirect("/account/preferences");
});

/**
 * UPDATES: list + filter
 */
appRoutes.get("/updates", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const tag = typeof req.query.tag === "string" ? req.query.tag.trim() : "";
  const typeId = typeof req.query.typeId === "string" ? req.query.typeId.trim() : "";

  const where: any = {};

  if (q) where.title = { contains: q, mode: "insensitive" };
  if (typeId) where.type = { is: { id: typeId } };
  if (tag) where.tags = { some: { tag: { is: { name: tag } } } };

  const [types, updatesRaw] = await Promise.all([
    prisma.updateType.findMany({ orderBy: { name: "asc" } }),
    prisma.update.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: 50,
      include: {
        type: true,
        tags: { include: { tag: true } },
        attachments: { orderBy: { createdAt: "asc" } },
      },
    }),
  ]);

  await audit(req, "UPDATES_LIST_VIEWED", undefined, { q, tag, typeId });

  const updates = updatesRaw.map((u) => ({
    id: u.id,
    title: u.title,
    body: u.bodyHtml || "",
    investorOnly: u.visibility === "INVESTOR_ONLY",
    publishedAt: u.publishedAt,
    type: u.type ? { id: u.type.id, name: u.type.name } : null,
    tags: (u.tags || []).map((ut) => ut.tag?.name).filter(Boolean) as string[],
  }));

  res.render("app/updates/index", {
    title: "Updates",
    updates,
    types,
    filters: { q, tag, typeId },
  });
});

/**
 * DATA ROOM
 * - Investors: all published documents
 * - Pre-investors: only PORTAL_ALL documents
 */
appRoutes.get("/documents", async (req, res) => {
  const role = req.user?.role || "INVESTOR";
  const isPreInvestor = role === "PREINVESTOR";
  const visibility = isPreInvestor ? ["PORTAL_ALL"] : ["PORTAL_ALL", "INVESTOR_ONLY"];

  const attachments = await prisma.attachment.findMany({
    where: {
      update: {
        publishedAt: { not: null },
        visibility: { in: visibility as any },
      },
    },
    include: {
      update: {
        select: {
          id: true,
          title: true,
          visibility: true,
          publishedAt: true,
          type: { select: { name: true } },
        },
      },
    },
    orderBy: [{ update: { publishedAt: "desc" } }, { createdAt: "desc" }],
  });

  await audit(req, "DATAROOM_VIEWED", undefined, { role });

  res.render("app/documents/index", {
    title: isPreInvestor ? "Teaser Pack" : "Data Room",
    isPreInvestor,
    attachments,
  });
});

/**
 * VOTING (investors only)
 */
appRoutes.get("/votes", async (req, res) => {
  if (req.user?.role !== "INVESTOR") {
    return res.status(403).send("Investors only.");
  }

  const voteRequests = await prisma.voteRequest.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: {
      _count: { select: { attachments: true, responses: true } },
      responses: {
        where: { userId: req.user!.id },
        select: { id: true, choice: true, createdAt: true },
      },
    },
  });

  res.render("app/votes/index", { title: "Voting", voteRequests });
});

appRoutes.get("/votes/:id", async (req, res) => {
  if (req.user?.role !== "INVESTOR") {
    return res.status(403).send("Investors only.");
  }

  const id = String(req.params.id);
  const voteRequest = await prisma.voteRequest.findUnique({
    where: { id },
    include: {
      attachments: { orderBy: { createdAt: "asc" } },
      responses: {
        where: { userId: req.user!.id },
        select: { id: true, choice: true, legalName: true, createdAt: true },
      },
    },
  });

  if (!voteRequest) return res.status(404).render("public/404", { title: "Not Found" });

  const existingResponse = voteRequest.responses[0] || null;

  res.render("app/votes/show", {
    title: voteRequest.title,
    voteRequest,
    existingResponse,
  });
});

appRoutes.post("/votes/:id", async (req, res) => {
  if (req.user?.role !== "INVESTOR") {
    return res.status(403).send("Investors only.");
  }

  const id = String(req.params.id);
  const choiceRaw = String(req.body.choice || "").trim().toUpperCase();
  const legalName = String(req.body.legalName || "").trim();

  if (!legalName) return res.status(400).send("Full legal name is required.");
  if (!["FOR", "AGAINST", "ABSTAIN"].includes(choiceRaw)) {
    return res.status(400).send("Invalid choice.");
  }

  const voteRequest = await prisma.voteRequest.findUnique({ where: { id } });
  if (!voteRequest) return res.status(404).send("Vote request not found.");
  if (voteRequest.status !== "OPEN") return res.status(400).send("Voting is closed.");

  const existing = await prisma.voteResponse.findUnique({
    where: { voteRequestId_userId: { voteRequestId: id, userId: req.user!.id } },
  });
  if (existing) return res.redirect(`/votes/${id}`);

  await prisma.voteResponse.create({
    data: {
      voteRequestId: id,
      userId: req.user!.id,
      choice: choiceRaw as any,
      legalName,
      ip: getIp(req),
      userAgent: getUA(req),
    },
  });

  await audit(req, "VOTE_CAST", { type: "VoteRequest", id }, { choice: choiceRaw });

  res.redirect(`/votes/${id}`);
});

/**
 * UPDATES: show
 */
appRoutes.get("/updates/:id", async (req, res) => {
  const id = String(req.params.id);

  const u = await prisma.update.findUnique({
    where: { id },
    include: {
      type: true,
      tags: { include: { tag: true } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!u) return res.status(404).render("public/404", { title: "Not Found" });

  await audit(req, "UPDATE_VIEWED", { type: "Update", id: u.id });

  const update = {
    id: u.id,
    title: u.title,
    body: u.bodyHtml || "",
    investorOnly: u.visibility === "INVESTOR_ONLY",
    publishedAt: u.publishedAt,
    type: u.type ? { id: u.type.id, name: u.type.name } : null,
    tags: (u.tags || []).map((ut) => ut.tag?.name).filter(Boolean) as string[],
    attachments: (u.attachments || []).map((a) => ({
      id: a.id,
      storageKey: a.storageKey,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      url: `/attachments/${encodeURIComponent(a.storageKey)}`,
    })),
  };

  res.render("app/updates/show", { title: update.title ?? "Update", update });
});

/**
 * Notifications API - count new updates since last login
 */
appRoutes.get("/api/notifications/count", async (req, res) => {
  const user = req.user!;
  
  // Only show notifications for investors and preinvestors
  if (user.role === "ADMIN") {
    return res.json({ count: 0, hasNew: false });
  }

  // Get user's last login time
  const lastLogin = user.lastLoginAt || new Date(0); // If never logged in, show all

  // Count updates published since last login
  const count = await prisma.update.count({
    where: {
      publishedAt: { not: null, gt: lastLogin },
      visibility: user.role === "PREINVESTOR" ? "PORTAL_ALL" : undefined, // Preinvestors only see PORTAL_ALL
    },
  });

  res.json({ count, hasNew: count > 0 });
});

/**
 * Votes API - count open votes not yet responded to
 */
appRoutes.get("/api/votes/pending-count", async (req, res) => {
  const user = req.user!;

  if (user.role !== "INVESTOR") {
    return res.json({ count: 0, hasPending: false });
  }

  const count = await prisma.voteRequest.count({
    where: {
      status: "OPEN",
      responses: { none: { userId: user.id } },
    },
  });

  res.json({ count, hasPending: count > 0 });
});

/**
 * Attachments download route (authenticated) - now serves from S3
 */
appRoutes.get(/^\/vote-attachments\/(.+)$/, async (req, res) => {
  const storageKey = req.params[0] || "";

  if (!storageKey) {
    return res.status(400).send("Invalid file");
  }

  if (req.user?.role === "PREINVESTOR") {
    return res.status(403).send("Forbidden");
  }

  try {
    const attachment = await prisma.voteAttachment.findFirst({
      where: { storageKey },
    });

    if (!attachment) {
      return res.status(404).send("Attachment not found");
    }

    const buffer = await s3Service.downloadFile(storageKey);

    await audit(req, "VOTE_ATTACHMENT_DOWNLOADED", undefined, { storageKey, voteRequestId: attachment.voteRequestId });

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${attachment.fileName}"`);
    res.send(buffer);
  } catch (err) {
    console.error("Failed to download vote attachment:", err);
    res.status(500).send("Failed to download file");
  }
});

appRoutes.get(/^\/attachments\/(.+)$/, async (req, res) => {
  const storageKey = req.params[0] || "";

  if (!storageKey) {
    return res.status(400).send("Invalid file");
  }

  try {
    // Find attachment to get metadata
    const attachment = await prisma.attachment.findFirst({
      where: { storageKey },
    });

    if (!attachment) {
      return res.status(404).send("Attachment not found");
    }

    // Download from S3
    const buffer = await s3Service.downloadFile(storageKey);

    await audit(req, "ATTACHMENT_DOWNLOADED", undefined, { storageKey });

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${attachment.fileName}"`);
    res.send(buffer);
  } catch (err) {
    console.error("Failed to download attachment:", err);
    res.status(500).send("Failed to download file");
  }
});

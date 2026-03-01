// src/routes/treasury.routes.ts
import { Router } from "express";
import { prisma } from "../prisma";
import { basiqService } from "../services/basiq.service";
import { audit } from "../middleware/audit";

export const treasuryRoutes = Router();

/** * GET /admin/treasury/setup
 * Setup page for connecting bank accounts
 */
treasuryRoutes.get("/setup", async (req, res) => {
  try {
    const basiqUserId = req.cookies?.basiqUserId;
    
    res.render("app/admin/treasury/setup", {
      title: "Treasury Setup",
      pageTitle: "Connect Bank Accounts",
      basiqUserId: basiqUserId || null,
    });
  } catch (error) {
    console.error("Treasury setup error:", error);
    res.status(500).send("Failed to load setup page");
  }
});

/**
 * GET /admin/treasury/setup/reset
 * Reset the setup process
 */
treasuryRoutes.get("/setup/reset", async (req, res) => {
  try {
    res.clearCookie("basiqUserId");
    res.redirect("/admin/treasury/setup");
  } catch (error) {
    console.error("Treasury setup reset error:", error);
    res.status(500).send("Failed to reset setup");
  }
});

/**
 * POST /admin/treasury/setup/create-user
 * Create a Basiq user and return auth link
 */
treasuryRoutes.post("/setup/create-user", async (req, res) => {
  const { email, mobile } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  if (!mobile) {
    return res.status(400).json({ error: "Mobile number is required" });
  }

  try {
    const { userId } = await basiqService.createUser(email, mobile);
    const { url, id } = await basiqService.createAuthLink(userId);

    // Store userId in cookie for later use
    res.cookie("basiqUserId", userId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    await audit(req, "BASIQ_USER_CREATED", { type: "BasiqUser", id: userId }, { email });

    res.json({ success: true, userId, authUrl: url, authLinkId: id });
  } catch (error) {
    console.error("Create Basiq user error:", error);
    res.status(500).json({ success: false, error: "Failed to create Basiq user" });
  }
});

/**
 * POST /admin/treasury/setup/import-accounts
 * Import accounts after connection is established
 */
treasuryRoutes.post("/setup/import-accounts", async (req, res) => {
  const { userId } = req.body;
  const basiqUserId = userId || req.cookies?.basiqUserId;

  if (!basiqUserId) {
    return res.status(400).json({ success: false, error: "No Basiq user ID found" });
  }

  try {
    // Get user's connections
    const connections = await basiqService.getUserConnections(basiqUserId);

    if (connections.length === 0) {
      return res.json({ 
        success: false, 
        error: "No connections found. Please complete the bank connection first." 
      });
    }

    // Get accounts for each connection
    let importedCount = 0;
    const importedAccounts = [];

    for (const connection of connections) {
      const accounts = await basiqService.fetchAccounts(basiqUserId);
      
      for (const account of accounts) {
        // Only import Macquarie accounts
        if (account.institution.toLowerCase().includes("macquarie")) {
          const dbAccountId = await basiqService.syncAccount(account.id, connection.id);
          importedAccounts.push({
            id: dbAccountId,
            name: account.name,
            institution: account.institution,
          });
          importedCount++;
        }
      }
    }

    await audit(req, "TREASURY_ACCOUNTS_IMPORTED", { type: "Import", id: basiqUserId }, {
      count: importedCount,
      accounts: importedAccounts,
    });

    res.json({ 
      success: true, 
      imported: importedCount,
      accounts: importedAccounts,
    });
  } catch (error) {
    console.error("Import accounts error:", error);
    res.status(500).json({ success: false, error: "Failed to import accounts" });
  }
});

/** * GET /admin/treasury
 * Dashboard showing all treasury accounts
 */
treasuryRoutes.get("/", async (req, res) => {
  try {
    const accounts = await basiqService.getTreasuryAccounts();
    
    // Get reconciliation stats for each account
    const accountsWithStats = await Promise.all(
      accounts.map(async (account) => {
        const [totalTransactions, unreconciledCount, reconciledCount] = await Promise.all([
          prisma.bankTransaction.count({ where: { bankAccountId: account.id } }),
          prisma.bankTransaction.count({ where: { bankAccountId: account.id, isReconciled: false } }),
          prisma.bankTransaction.count({ where: { bankAccountId: account.id, isReconciled: true } }),
        ]);

        return {
          ...account,
          stats: {
            totalTransactions,
            unreconciledCount,
            reconciledCount,
          },
        };
      })
    );

    res.render("app/admin/treasury/index", {
      title: "Treasury Management",
      pageTitle: "Treasury Management",
      accounts: accountsWithStats,
    });
  } catch (error) {
    console.error("Treasury dashboard error:", error);
    res.status(500).send("Failed to load treasury dashboard");
  }
});

/**
 * POST /admin/treasury/sync/:accountId
 * Sync transactions for a specific account
 */
treasuryRoutes.post("/sync/:accountId", async (req, res) => {
  const { accountId } = req.params;

  try {
    const syncedCount = await basiqService.syncTransactions(accountId);
    
    await audit(req, "TREASURY_SYNC", { type: "BankAccount", id: accountId }, { 
      syncedCount 
    });

    res.json({ success: true, syncedCount });
  } catch (error) {
    console.error("Treasury sync error:", error);
    res.status(500).json({ success: false, error: "Failed to sync transactions" });
  }
});

/**
 * GET /admin/treasury/accounts/:accountId
 * View account details and transactions
 */
treasuryRoutes.get("/accounts/:accountId", async (req, res) => {
  const { accountId } = req.params;
  const page = parseInt(String(req.query.page || "1"));
  const pageSize = 50;

  try {
    const account = await prisma.bankAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      return res.status(404).send("Account not found");
    }

    const [transactions, totalCount, unreconciledCount] = await Promise.all([
      prisma.bankTransaction.findMany({
        where: { bankAccountId: accountId },
        orderBy: { transactionDate: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          reconciliations: {
            include: {
              investor: { select: { email: true, name: true } },
              reconciler: { select: { email: true, name: true } },
            },
          },
        },
      }),
      prisma.bankTransaction.count({ where: { bankAccountId: accountId } }),
      prisma.bankTransaction.count({ where: { bankAccountId: accountId, isReconciled: false } }),
    ]);

    const totalPages = Math.ceil(totalCount / pageSize);

    res.render("app/admin/treasury/account", {
      title: `Treasury - ${account.accountName}`,
      pageTitle: account.accountName,
      account,
      transactions,
      unreconciledCount,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        pageSize,
      },
    });
  } catch (error) {
    console.error("Treasury account error:", error);
    res.status(500).send("Failed to load account details");
  }
});

/**
 * GET /admin/treasury/reconcile
 * Reconciliation interface
 */
treasuryRoutes.get("/reconcile", async (req, res) => {
  const accountId = String(req.query.accountId || "");

  try {
    const accounts = await basiqService.getTreasuryAccounts();
    
    let unreconciledTransactions: any[] = [];
    let investors: any[] = [];
    let selectedAccount: any = null;

    if (accountId) {
      selectedAccount = await prisma.bankAccount.findUnique({
        where: { id: accountId },
      });

      // Get unreconciled credit transactions (deposits)
      unreconciledTransactions = await basiqService.getUnreconciledTransactions(accountId, 100); // Min $1

      // Get investors with instruments
      investors = await prisma.user.findMany({
        where: { 
          role: { in: ["INVESTOR", "PREINVESTOR"] },
          isActive: true,
        },
        include: {
          investorInstruments: {
            where: { status: "OUTSTANDING" },
          },
          shareholdingProfile: true,
        },
        orderBy: { email: "asc" },
      });
    }

    res.render("app/admin/treasury/reconcile", {
      title: "Transaction Reconciliation",
      pageTitle: "Reconcile Transactions",
      accounts,
      selectedAccount,
      unreconciledTransactions,
      investors,
    });
  } catch (error) {
    console.error("Reconciliation page error:", error);
    res.status(500).send("Failed to load reconciliation page");
  }
});

/**
 * POST /admin/treasury/reconcile
 * Create a reconciliation
 */
treasuryRoutes.post("/reconcile", async (req, res) => {
  const {
    transactionId,
    investorId,
    expectedAmountCents,
    instrumentId,
    shareholdingId,
    notes,
  } = req.body;

  try {
    const transaction = await prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      include: { bankAccount: true },
    });

    if (!transaction) {
      return res.status(404).json({ success: false, error: "Transaction not found" });
    }

    const expectedAmount = parseInt(expectedAmountCents);
    const varianceCents = transaction.amountCents - expectedAmount;
    const isMatch = Math.abs(varianceCents) <= 1; // Allow 1 cent rounding difference

    const reconciliation = await prisma.transactionReconciliation.create({
      data: {
        bankTransactionId: transactionId,
        bankAccountId: transaction.bankAccountId,
        investorId,
        expectedAmountCents: expectedAmount,
        actualAmountCents: transaction.amountCents,
        varianceCents,
        status: isMatch ? "RECONCILED" : "DISPUTED",
        instrumentId: instrumentId || null,
        shareholdingId: shareholdingId || null,
        notes: notes || null,
        reconciledBy: (req as any).user.id,
        reconciledAt: new Date(),
      },
    });

    // Mark transaction as reconciled if it matches
    if (isMatch) {
      await prisma.bankTransaction.update({
        where: { id: transactionId },
        data: { isReconciled: true },
      });
    }

    await audit(req, "TRANSACTION_RECONCILED", { type: "BankTransaction", id: transactionId }, {
      investorId,
      expectedAmountCents: expectedAmount,
      actualAmountCents: transaction.amountCents,
      varianceCents,
      status: reconciliation.status,
    });

    res.json({ success: true, reconciliation });
  } catch (error) {
    console.error("Reconciliation error:", error);
    res.status(500).json({ success: false, error: "Failed to create reconciliation" });
  }
});

/**
 * GET /admin/treasury/reports
 * Reconciliation reports
 */
treasuryRoutes.get("/reports", async (req, res) => {
  try {
    const fromDate = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const toDate = req.query.to ? new Date(String(req.query.to)) : new Date();

    const [
      reconciledTransactions,
      unreconciledTransactions,
      disputedTransactions,
      totalReconciled,
      totalUnreconciled,
    ] = await Promise.all([
      prisma.transactionReconciliation.findMany({
        where: {
          reconciledAt: {
            gte: fromDate,
            lte: toDate,
          },
          status: "RECONCILED",
        },
        include: {
          investor: { select: { email: true, name: true } },
          bankTransaction: { select: { description: true, transactionDate: true, amountCents: true } },
          bankAccount: { select: { accountName: true } },
        },
        orderBy: { reconciledAt: "desc" },
      }),
      prisma.bankTransaction.findMany({
        where: {
          transactionDate: {
            gte: fromDate,
            lte: toDate,
          },
          isReconciled: false,
          transactionType: "CREDIT",
        },
        include: {
          bankAccount: { select: { accountName: true } },
        },
        orderBy: { transactionDate: "desc" },
      }),
      prisma.transactionReconciliation.findMany({
        where: {
          status: "DISPUTED",
          reconciledAt: {
            gte: fromDate,
            lte: toDate,
          },
        },
        include: {
          investor: { select: { email: true, name: true } },
          bankTransaction: { select: { description: true, transactionDate: true, amountCents: true } },
          bankAccount: { select: { accountName: true } },
        },
        orderBy: { reconciledAt: "desc" },
      }),
      prisma.transactionReconciliation.aggregate({
        where: { status: "RECONCILED" },
        _sum: { actualAmountCents: true },
        _count: true,
      }),
      prisma.bankTransaction.aggregate({
        where: { 
          isReconciled: false,
          transactionType: "CREDIT",
        },
        _sum: { amountCents: true },
        _count: true,
      }),
    ]);

    res.render("app/admin/treasury/reports", {
      title: "Reconciliation Reports",
      pageTitle: "Reconciliation Reports",
      fromDate,
      toDate,
      reconciledTransactions,
      unreconciledTransactions,
      disputedTransactions,
      summary: {
        totalReconciledAmount: totalReconciled._sum.actualAmountCents || 0,
        totalReconciledCount: totalReconciled._count,
        totalUnreconciledAmount: totalUnreconciled._sum.amountCents || 0,
        totalUnreconciledCount: totalUnreconciled._count,
      },
    });
  } catch (error) {
    console.error("Reports error:", error);
    res.status(500).send("Failed to load reports");
  }
});

/**
 * GET /admin/treasury/investor/:investorId
 * View all reconciliations for a specific investor
 */
treasuryRoutes.get("/investor/:investorId", async (req, res) => {
  const { investorId } = req.params;

  try {
    const [investor, reconciliations, instruments, shareholding] = await Promise.all([
      prisma.user.findUnique({
        where: { id: investorId },
        select: { id: true, email: true, name: true, role: true },
      }),
      prisma.transactionReconciliation.findMany({
        where: { investorId },
        include: {
          bankTransaction: { select: { description: true, transactionDate: true, amountCents: true } },
          bankAccount: { select: { accountName: true } },
          reconciler: { select: { email: true, name: true } },
        },
        orderBy: { reconciledAt: "desc" },
      }),
      prisma.investorInstrument.findMany({
        where: { investorId },
      }),
      prisma.shareholdingProfile.findUnique({
        where: { userId: investorId },
      }),
    ]);

    if (!investor) {
      return res.status(404).send("Investor not found");
    }

    // Calculate expected vs reconciled amounts
    const totalExpected = reconciliations.reduce((sum, r) => sum + r.expectedAmountCents, 0);
    const totalActual = reconciliations.reduce((sum, r) => sum + r.actualAmountCents, 0);
    const totalVariance = totalActual - totalExpected;

    res.render("app/admin/treasury/investor", {
      title: `Treasury - ${investor.email}`,
      pageTitle: `Investor Reconciliations`,
      investor,
      reconciliations,
      instruments,
      shareholding,
      summary: {
        totalExpected,
        totalActual,
        totalVariance,
        reconciledCount: reconciliations.filter((r) => r.status === "RECONCILED").length,
        disputedCount: reconciliations.filter((r) => r.status === "DISPUTED").length,
      },
    });
  } catch (error) {
    console.error("Investor reconciliation error:", error);
    res.status(500).send("Failed to load investor reconciliations");
  }
});

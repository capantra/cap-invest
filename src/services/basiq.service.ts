// src/services/basiq.service.ts
import { prisma } from "../prisma";

/**
 * Basiq API Service
 * Handles integration with Basiq for bank account and transaction data
 */

interface BasiqAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface BasiqAccount {
  id: string;
  accountNo: string;
  bsb: string;
  name: string;
  institution: string;
  type: string;
  balance: {
    current: number;
    available: number;
  };
  currency: string;
}

interface BasiqTransaction {
  id: string;
  description: string;
  amount: number;
  type: "debit" | "credit";
  transactionDate: string;
  postDate: string;
  balance: number;
  category?: string;
  merchant?: string;
  reference?: string;
}

interface BasiqAccountsResponse {
  data: BasiqAccount[];
}

interface BasiqTransactionsResponse {
  data: BasiqTransaction[];
}

class BasiqService {
  private apiKey: string;
  private baseUrl: string = "https://au-api.basiq.io";
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.apiKey = process.env.BASIQ_API_KEY || "";
    if (!this.apiKey) {
      console.warn("⚠️  BASIQ_API_KEY not configured in environment");
    }
  }

  /**
   * Authenticate with Basiq and get access token
   */
  private async authenticate(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (!this.apiKey) {
      throw new Error("BASIQ_API_KEY is not configured");
    }

    try {
      // Check if API key is already base64 encoded
      // Basiq API keys are typically provided as base64-encoded "clientId:secret"
      const authString = this.apiKey.includes(':') 
        ? Buffer.from(this.apiKey).toString("base64")
        : this.apiKey;
      
      const response = await fetch(`${this.baseUrl}/token`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${authString}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "basiq-version": "3.0",
        },
        body: "scope=SERVER_ACCESS",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Basiq auth error response:", errorText);
        throw new Error(`Basiq auth failed: ${response.status} ${response.statusText}`);
      }

      const data: BasiqAuthResponse = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min early

      return this.accessToken;
    } catch (error) {
      console.error("Basiq authentication error:", error);
      throw new Error("Failed to authenticate with Basiq. Check your BASIQ_API_KEY.");
    }
  }

  /**
   * Fetch accounts for a connection
   */
  async fetchAccounts(connectionId: string): Promise<BasiqAccount[]> {
    const token = await this.authenticate();

    try {
      const response = await fetch(`${this.baseUrl}/users/${connectionId}/accounts`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "basiq-version": "3.0",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch accounts: ${response.statusText}`);
      }

      const data: BasiqAccountsResponse = await response.json();
      return data.data;
    } catch (error) {
      console.error("Basiq fetch accounts error:", error);
      throw error;
    }
  }

  /**
   * Fetch transactions for an account
   */
  async fetchTransactions(accountId: string, fromDate?: Date): Promise<BasiqTransaction[]> {
    const token = await this.authenticate();

    let url = `${this.baseUrl}/accounts/${accountId}/transactions`;
    if (fromDate) {
      const dateStr = fromDate.toISOString().split("T")[0];
      url += `?filter=transaction.postDate.gt('${dateStr}')`;
    }

    try {
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "basiq-version": "3.0",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch transactions: ${response.statusText}`);
      }

      const data: BasiqTransactionsResponse = await response.json();
      return data.data;
    } catch (error) {
      console.error("Basiq fetch transactions error:", error);
      throw error;
    }
  }

  /**
   * Sync bank account from Basiq to database
   */
  async syncAccount(basiqAccountId: string, connectionId: string): Promise<string> {
    const accounts = await this.fetchAccounts(connectionId);
    const account = accounts.find((a) => a.id === basiqAccountId);

    if (!account) {
      throw new Error(`Account ${basiqAccountId} not found in Basiq`);
    }

    // Upsert to database
    const dbAccount = await prisma.bankAccount.upsert({
      where: { basiqAccountId: account.id },
      update: {
        accountName: account.name,
        accountNumber: account.accountNo,
        bsb: account.bsb,
        institution: account.institution,
        accountType: account.type,
        currentBalanceCents: Math.round(account.balance.current * 100),
        availableBalanceCents: Math.round(account.balance.available * 100),
        currency: account.currency,
        lastSyncedAt: new Date(),
        basiqConnectionId: connectionId,
      },
      create: {
        basiqAccountId: account.id,
        basiqConnectionId: connectionId,
        accountName: account.name,
        accountNumber: account.accountNo,
        bsb: account.bsb,
        institution: account.institution,
        accountType: account.type,
        currentBalanceCents: Math.round(account.balance.current * 100),
        availableBalanceCents: Math.round(account.balance.available * 100),
        currency: account.currency,
        lastSyncedAt: new Date(),
        isActive: true,
      },
    });

    return dbAccount.id;
  }

  /**
   * Sync transactions for an account
   */
  async syncTransactions(accountId: string): Promise<number> {
    const dbAccount = await prisma.bankAccount.findUnique({
      where: { id: accountId },
    });

    if (!dbAccount) {
      throw new Error(`Account ${accountId} not found in database`);
    }

    // Fetch transactions from last sync or last 90 days
    const fromDate = dbAccount.lastSyncedAt || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const transactions = await this.fetchTransactions(dbAccount.basiqAccountId, fromDate);

    let syncedCount = 0;

    for (const txn of transactions) {
      await prisma.bankTransaction.upsert({
        where: { basiqTransactionId: txn.id },
        update: {
          description: txn.description,
          amountCents: Math.round(txn.amount * 100),
          transactionType: txn.type === "credit" ? "CREDIT" : "DEBIT",
          transactionDate: new Date(txn.transactionDate),
          postDate: txn.postDate ? new Date(txn.postDate) : null,
          category: txn.category,
          merchant: txn.merchant,
          reference: txn.reference,
          balance: txn.balance ? Math.round(txn.balance * 100) : null,
        },
        create: {
          bankAccountId: dbAccount.id,
          basiqTransactionId: txn.id,
          description: txn.description,
          amountCents: Math.round(txn.amount * 100),
          transactionType: txn.type === "credit" ? "CREDIT" : "DEBIT",
          transactionDate: new Date(txn.transactionDate),
          postDate: txn.postDate ? new Date(txn.postDate) : null,
          category: txn.category,
          merchant: txn.merchant,
          reference: txn.reference,
          balance: txn.balance ? Math.round(txn.balance * 100) : null,
        },
      });
      syncedCount++;
    }

    // Update last synced timestamp
    await prisma.bankAccount.update({
      where: { id: accountId },
      data: { lastSyncedAt: new Date() },
    });

    return syncedCount;
  }

  /**
   * Create a Basiq user
   */
  async createUser(email: string, mobile?: string): Promise<{ userId: string }> {
    const token = await this.authenticate();

    try {
      const body: any = { email };
      if (mobile) {
        body.mobile = mobile;
      }

      const response = await fetch(`${this.baseUrl}/users`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "basiq-version": "3.0",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Basiq create user error response:", errorText);
        throw new Error(`Failed to create user: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return { userId: data.id };
    } catch (error) {
      console.error("Basiq create user error:", error);
      throw error;
    }
  }

  /**
   * Create a connection auth link for a user
   */
  async createAuthLink(userId: string): Promise<{ url: string; id: string }> {
    const token = await this.authenticate();

    try {
      const response = await fetch(`${this.baseUrl}/users/${userId}/auth_link`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "basiq-version": "3.0",
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Basiq create auth link error response:", errorText);
        throw new Error(`Failed to create auth link: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return { url: data.links.public, id: data.id };
    } catch (error) {
      console.error("Basiq create auth link error:", error);
      throw error;
    }
  }

  /**
   * Get connections for a user
   */
  async getUserConnections(userId: string): Promise<any[]> {
    const token = await this.authenticate();

    try {
      const response = await fetch(`${this.baseUrl}/users/${userId}/connections`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "basiq-version": "3.0",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get connections: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("Basiq get connections error:", error);
      throw error;
    }
  }

  /**
   * Get all active treasury accounts
   */
  async getTreasuryAccounts() {
    return await prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: { accountName: "asc" },
    });
  }

  /**
   * Get unreconciled transactions for a bank account
   */
  async getUnreconciledTransactions(accountId: string, minAmountCents: number = 0) {
    return await prisma.bankTransaction.findMany({
      where: {
        bankAccountId: accountId,
        isReconciled: false,
        transactionType: "CREDIT", // Only credits (deposits)
        amountCents: { gte: minAmountCents },
      },
      orderBy: { transactionDate: "desc" },
      take: 100,
    });
  }
}

export const basiqService = new BasiqService();

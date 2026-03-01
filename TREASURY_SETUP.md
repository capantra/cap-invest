# Treasury Management System - Setup Guide

## Overview

The Treasury Management System integrates with Basiq to:
- Connect to Macquarie Cash Management and Cash Management Accelerator accounts
- Sync bank transactions automatically
- Reconcile investor payments with their instruments/shareholdings
- Generate compliance reports for auditing
- Track all treasury operations with full audit logging

## Features Implemented

### 1. Database Schema
- **BankAccount**: Stores connected bank accounts from Basiq
- **BankTransaction**: Stores all transactions synced from Basiq
- **TransactionReconciliation**: Links transactions to investors and instruments
- Full audit trail with status tracking (UNRECONCILED, RECONCILED, DISPUTED)

### 2. Basiq API Integration
- OAuth2 authentication with automatic token refresh
- Account syncing (balances, details, metadata)
- Transaction syncing with configurable date ranges
- Error handling and retry logic

### 3. Admin-Only Features
- `/admin/treasury` - Dashboard showing all treasury accounts
- `/admin/treasury/accounts/:id` - View account transactions
- `/admin/treasury/reconcile` - Reconcile transactions with investors
- `/admin/treasury/reports` - View reconciliation reports
- `/admin/treasury/investor/:id` - View investor-specific reconciliations

### 4. Transaction Reconciliation
- Match bank transactions to investor payments
- Link to InvestorInstruments (SAFE/NOTE) or ShareholdingProfiles
- Automatic variance detection (± 1 cent tolerance)
- Status tracking: RECONCILED (exact match), DISPUTED (has variance)
- Notes field for additional context

### 5. Compliance & Auditing
- All treasury operations logged to AuditLog table
- Reconciliation history tracked per investor
- Reports showing reconciled vs unreconciled amounts
- Date-range filtering for periodic reports
- Full trail: who reconciled, when, and with what variance

## Setup Instructions

### Step 1: Basiq Account Setup

1. **Sign up for Basiq**: https://basiq.io
2. **Create an API application** in the Basiq dashboard
3. **Get your API Key** (format: `<application_id>:<secret>`)
4. **Enable Server Access scope**

### Step 2: Environment Configuration

Add to your `.env` file:

```env
BASIQ_API_KEY=your_application_id:your_secret
```

### Step 3: Connect Your Bank Accounts

You'll need to use the Basiq Consent UI to connect your Macquarie accounts:

**Option A: Manual Connection (Recommended for Testing)**
1. Use Basiq's Connection UI or API to create a user and connection
2. Authenticate with Macquarie Bank credentials
3. Select the two accounts:
   - Macquarie Cash Management
   - Cash Management Accelerator
4. Note the connection ID and account IDs

**Option B: Programmatic Connection**
```typescript
// Example code to create a connection
const response = await fetch('https://au-api.basiq.io/users', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'admin@capantra.com',
    mobile: '+61400000000',
  }),
});

const user = await response.json();
// Then use the Consent UI to connect accounts
```

### Step 4: Initial Account Sync

Once connected, sync your accounts:

1. Navigate to `/admin/treasury`
2. Use the "Sync Transactions" button for each account
3. Transactions will be pulled from Basiq and stored in your database

You can configure the sync to run automatically:
```typescript
// Add to a cron job or scheduled task
import { basiqService } from './services/basiq.service';

async function syncAllAccounts() {
  const accounts = await basiqService.getTreasuryAccounts();
  for (const account of accounts) {
    await basiqService.syncTransactions(account.id);
  }
}
```

### Step 5: Set Up Macquarie Accounts

After initial sync, you should see both accounts:
- Macquarie Cash Management
- Cash Management Accelerator

The system will display:
- Current and available balances
- Transaction counts
- Reconciliation status
- Last sync timestamp

## Usage Guide

### Reconciling Transactions

#### Step 1: Navigate to Reconciliation
1. Go to `/admin/treasury`
2. Click "Reconcile" for an account
3. Or go directly to `/admin/treasury/reconcile`

#### Step 2: Select Account
Choose the bank account containing unreconciled transactions

#### Step 3: Match Transactions
For each unreconciled transaction:
1. Select the investor from the dropdown
2. View their instruments and shareholdings (auto-populated)
3. Enter the expected amount in cents
4. Optionally select a specific instrument
5. Add notes if needed
6. Click "Reconcile Transaction"

#### Step 4: Review Status
- **Reconciled**: Amount matches exactly (± 1 cent)
- **Disputed**: Variance detected, requires review

### Viewing Reports

Navigate to `/admin/treasury/reports` to see:
- Total reconciled amounts and counts
- Unreconciled transactions requiring action
- Disputed transactions requiring review
- Date range filtering for periodic reporting

### Investor Requirement: Reconciled Transactions

**Important**: An investor MUST have at least one reconciled transaction matching their investment amount before they are considered fully onboarded.

To check compliance:
1. Go to `/admin/treasury/investor/:investorId`
2. Review their reconciliation history
3. Verify total reconciled amount matches expected investment
4. Check for any disputed transactions

You can enforce this requirement programmatically:
```typescript
// Example: Check if investor has reconciled transactions
const reconciliations = await prisma.transactionReconciliation.findMany({
  where: {
    investorId: userId,
    status: 'RECONCILED',
  },
});

const totalReconciled = reconciliations.reduce(
  (sum, r) => sum + r.actualAmountCents,
  0
);

// Compare with expected investment amount from instruments/shareholding
```

## API Reference

### Basiq Service Methods

```typescript
// Sync account from Basiq
await basiqService.syncAccount(basiqAccountId, connectionId);

// Sync transactions for an account
await basiqService.syncTransactions(accountId);

// Get treasury accounts
const accounts = await basiqService.getTreasuryAccounts();

// Get unreconciled transactions
const txns = await basiqService.getUnreconciledTransactions(accountId, minAmountCents);
```

### Database Queries

```typescript
// Get all reconciliations for an investor
const reconciliations = await prisma.transactionReconciliation.findMany({
  where: { investorId },
  include: {
    bankTransaction: true,
    bankAccount: true,
  },
});

// Get unreconciled transactions
const unreconciled = await prisma.bankTransaction.findMany({
  where: {
    isReconciled: false,
    transactionType: 'CREDIT',
  },
});
```

## Security & Compliance

### Admin-Only Access
All treasury routes are protected by:
1. `requireAuth` - Must be logged in
2. `requireAgreementAccepted` - Must have accepted agreements
3. `requireRole("ADMIN")` - Must be ADMIN role

### Audit Logging
All treasury operations are logged:
- `TREASURY_SYNC` - When transactions are synced
- `TRANSACTION_RECONCILED` - When a transaction is matched to an investor

View logs at `/admin/audit`

### Data Privacy
- Only admins can view treasury data
- Investors cannot see treasury accounts or other investors' transactions
- All financial data stored in cents (integers) to avoid floating-point errors

## Troubleshooting

### "No treasury accounts configured"
- Verify `BASIQ_API_KEY` is set in `.env`
- Check that you've connected bank accounts via Basiq Consent UI
- Run account sync to populate the database

### Transactions not syncing
- Check Basiq API key is valid
- Verify account connection is still active in Basiq dashboard
- Check for errors in server logs
- Ensure date ranges are correct (default: last 90 days)

### Reconciliation variance
- Transactions marked DISPUTED have an amount variance
- Review the transaction description for details
- Check if fees or charges were applied
- Verify the expected amount was entered correctly (in cents)

## Future Enhancements

Consider adding:
- Automated reconciliation rules (match by reference number, description patterns)
- Bulk reconciliation for multiple transactions
- Export reconciliation reports to CSV/PDF
- Email notifications for disputed transactions
- Scheduled syncing via cron jobs
- Integration with accounting software (Xero, QuickBooks)

## Support

For issues or questions:
1. Check server logs for errors
2. Review Basiq API documentation: https://api.basiq.io/reference/
3. Check the audit log for operation history
4. Contact Basiq support if API issues persist

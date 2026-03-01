# Investors Portal

Investor portal with updates, data room, admin tools, and voting workflows. Built with Node.js, Express, Prisma, and EJS.

## Requirements
- Node.js 20+
- pnpm
- PostgreSQL
- AWS credentials for S3/SES (if using uploads/email)

## Quick Start
```bash
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate dev
pnpm exec prisma db seed
pnpm dev
```

## Environment Variables
Create a `.env` file in the project root. Common keys:
- DATABASE_URL
- APP_URL (or APP_BASE_URL)
- AWS_REGION
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- S3_BUCKET_NAME
- MAIL_FROM (or MAIL_FROM_NAME + MAIL_FROM_EMAIL)
- SES_CONFIGURATION_SET (optional)
- INVITE_TTL_HOURS (optional)
- OTP_TTL_MINUTES (optional)
- TURNSTILE_SITE_KEY (optional)
- COMPANY_LEGAL_NAME (optional)
- SEED_ADMIN_EMAIL (optional)
- SEED_ADMIN_PASSWORD (optional)

## Scripts
- `pnpm dev` - Start dev server
- `pnpm prisma:generate` - Generate Prisma client
- `pnpm prisma:migrate` - Run migrations in dev
- `pnpm seed` - Run database seed

## Database
- Dev migrations:
  ```bash
  pnpm exec prisma migrate dev
  ```
- Production migrations:
  ```bash
  pnpm exec prisma migrate deploy
  ```

## Admin Features
- Users & invites
- Investor management
- Updates with attachments
- Treasury (optional access)
- Voting (create requests, collect responses, view results)

## Data Room
- `/documents` lists all published update attachments
- Pre-investors only see `PORTAL_ALL` documents

## Voting
- Admins create vote requests and attach documents
- Investors vote For/Against/Abstain with legal name and IP captured

## Notes
- File uploads use S3.
- Email delivery uses SES.
- If you add new Prisma models, run `pnpm exec prisma generate` and restart the server.

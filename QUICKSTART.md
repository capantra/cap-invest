# Quick Start Guide - Updates System

## Prerequisites

1. AWS account with S3 access
2. Environment variables configured

## Setup Steps

### 1. Configure Environment

Add to your `.env` file:

```env
S3_BUCKET_NAME=capantra-investor-portal
AWS_REGION=ap-southeast-4
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

### 2. Create S3 Bucket

```bash
aws s3 mb s3://capantra-investor-portal --region ap-southeast-4
```

### 3. Restart Server

```bash
pnpm dev
```

## Usage

### Upload PDF to Update

1. Go to `/admin/updates`
2. Click on an existing update
3. Scroll to "Attachments" section
4. Click "Choose File" and select PDF
5. Click "Upload attachment"
6. Wait for upload to complete

### Publish Update with Email

1. After uploading PDF, scroll to "Publish & distribute"
2. Select audience (Investors, All, etc.)
3. Click "Publish & send emails"
4. PDFs will be automatically attached to emails

### View Notification Badge

1. Login as investor or pre-investor
2. New updates will show count badge next to "Updates"
3. Badge clears after logging out and back in

### View PDF in Portal

1. Click "Updates" in navigation
2. Click on any update with attachment
3. PDF displays inline below update content
4. Click "Download" to save PDF

## Troubleshooting

### "Missing env var: S3_BUCKET_NAME"

Add `S3_BUCKET_NAME` to your `.env` file.

### "Access Denied" when uploading

Check AWS credentials have S3 PutObject permission.

### Notification badge not showing

1. Check browser console for errors
2. Verify `/api/notifications/count` returns data
3. Clear cookies and login again

### PDF not displaying inline

1. Check attachment record has correct storageKey
2. Verify S3 file exists: `aws s3 ls s3://bucket-name/updates/`
3. Check Content-Type is `application/pdf`

## Development Notes

- Files upload to `updates/{timestamp}_{filename}` in S3
- Notification badge checks `lastLoginAt` vs `Update.publishedAt`
- PDF iframe height is 600px (adjust in show.ejs if needed)
- Email attachments have 10MB limit (SES restriction)

## Quick Commands

```bash
# Check S3 bucket contents
aws s3 ls s3://capantra-investor-portal/updates/ --recursive

# Download file from S3
aws s3 cp s3://capantra-investor-portal/updates/FILE_KEY ./test.pdf

# Check bucket size
aws s3 ls s3://capantra-investor-portal --recursive --summarize | grep "Total Size"

# View recent uploads (audit log)
psql $DATABASE_URL -c "SELECT * FROM \"AuditLog\" WHERE action='ATTACHMENT_CREATED' ORDER BY \"createdAt\" DESC LIMIT 10;"
```

## Support

For detailed setup instructions, see `S3_SETUP.md`
For implementation details, see `UPDATES_IMPLEMENTATION.md`

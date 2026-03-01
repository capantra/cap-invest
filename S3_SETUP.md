# S3 Configuration for Updates and Attachments

## Overview

The system now uploads PDF attachments to AWS S3 instead of storing them locally. This enables:
1. **Local file upload** → Automatic upload to S3
2. **PDF attachments in emails** → Downloaded from S3 and attached to update emails
3. **PDF display in portal** → Embedded iframe showing PDF inline
4. **Notification badges** → Shows count of new updates since last login

## Required Environment Variables

Add the following to your `.env` file:

```env
# S3 Configuration
S3_BUCKET_NAME=capantra-investor-portal
AWS_REGION=ap-southeast-4
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
```

## AWS S3 Setup

### 1. Create S3 Bucket

```bash
aws s3 mb s3://capantra-investor-portal --region ap-southeast-4
```

### 2. Configure Bucket Policy

The bucket needs to allow:
- **PutObject** - Upload files
- **GetObject** - Download files for email attachments and portal viewing
- **ListBucket** - List objects (optional, for management)

Example bucket policy (replace `YOUR_ACCOUNT_ID`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAppAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::YOUR_ACCOUNT_ID:user/capantra-portal-app"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::capantra-investor-portal/*"
    },
    {
      "Sid": "AllowListBucket",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::YOUR_ACCOUNT_ID:user/capantra-portal-app"
      },
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::capantra-investor-portal"
    }
  ]
}
```

### 3. Configure CORS (Optional - for direct browser access)

If you want to allow direct browser access to S3 files:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["https://yourdomain.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## IAM User Setup

Create an IAM user with programmatic access:

```bash
aws iam create-user --user-name capantra-portal-app
```

Attach policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::capantra-investor-portal",
        "arn:aws:s3:::capantra-investor-portal/*"
      ]
    }
  ]
}
```

Generate access keys:

```bash
aws iam create-access-key --user-name capantra-portal-app
```

## How It Works

### 1. Upload Flow

1. Admin creates/edits an update at `/admin/updates/new`
2. Admin uploads a PDF file using the file input
3. File is stored in memory via multer
4. File is uploaded to S3 at `updates/{timestamp}_{filename}`
5. Attachment record is created with S3 key in database

### 2. Email Distribution

1. Admin publishes update
2. System fetches all attachments from S3
3. PDFs are downloaded as Buffer objects
4. Emails are sent with PDFs as MIME attachments
5. Recipients receive email with PDF attached

### 3. Portal Viewing

1. User clicks "Updates" in navigation
2. Badge shows count of new updates since last login
3. User views update
4. PDF is embedded in iframe using `/attachments/{storageKey}` route
5. Route fetches PDF from S3 and serves it inline

## Testing

### Test S3 Upload

```bash
# Upload test file
curl -X POST http://localhost:5500/admin/updates/UPDATE_ID/attachments \
  -H "Cookie: session=YOUR_SESSION" \
  -F "file=@test.pdf"
```

### Test Email Attachment

1. Create update with PDF attachment
2. Publish update
3. Check email - PDF should be attached

### Test Notification Badge

1. Login as investor
2. Admin creates and publishes new update
3. Refresh investor dashboard
4. Badge should show "1" next to "Updates"
5. After viewing updates, next login won't show badge

## Troubleshooting

### "Access Denied" errors

- Check IAM user has correct permissions
- Verify bucket policy allows the IAM user
- Check AWS credentials in .env are correct

### PDFs not showing in email

- Check S3 download is working: `aws s3 cp s3://capantra-investor-portal/updates/test.pdf -`
- Check email service logs for attachment errors
- Verify file size is under SES limit (10MB per email)

### Notification badge not appearing

- Check `/api/notifications/count` returns correct data
- Verify `lastLoginAt` is being updated on login
- Check browser console for JavaScript errors

## File Structure

```
src/
├── services/
│   ├── s3.service.ts          # S3 upload/download operations
│   ├── email.service.ts       # Email with attachments support
│   └── updates.service.ts     # Update distribution with PDFs
├── routes/
│   ├── admin.routes.ts        # Updated attachment upload route
│   └── app.routes.ts          # Notification API + attachment serving
├── middleware/
│   └── upload.ts              # Changed to memoryStorage for S3
└── views/
    ├── partials/
    │   ├── nav.investor.ejs   # Notification badge
    │   └── nav.preinvestor.ejs # Notification badge
    └── app/
        ├── updates/
        │   └── show.ejs       # PDF iframe embed
        └── admin/
            └── updates/
                └── view.ejs   # File upload form
```

## Cost Considerations

### S3 Storage
- First 50 TB: $0.023 per GB/month
- Estimated: 100 PDFs × 2MB = 200MB = ~$0.005/month

### S3 Requests
- PUT requests: $0.005 per 1,000 requests
- GET requests: $0.0004 per 1,000 requests
- Estimated: 100 uploads + 1,000 downloads = ~$0.01/month

### Data Transfer
- First 100 GB/month: Free
- After: $0.114 per GB
- Estimated: 1,000 downloads × 2MB = 2GB = Free

**Total estimated cost: ~$0.02/month**

## Security Notes

1. **Private bucket** - Files are not publicly accessible
2. **Authenticated access** - All downloads require valid session
3. **Presigned URLs** - Can be used for time-limited external access (not currently implemented)
4. **Audit logging** - All downloads are logged in audit trail
5. **File validation** - Only PDFs accepted for attachments
6. **Size limits** - 25MB max upload size

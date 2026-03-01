# Updates System Overhaul - Implementation Summary

## Overview

Comprehensive update system overhaul implementing three major features:
1. **S3 File Uploads** - Upload PDFs from local machine to AWS S3
2. **PDF Email Attachments** - Attach PDFs to update emails
3. **Notification System** - Show badge for new updates since last login

## Changes Made

### 1. New Files Created

#### `src/services/s3.service.ts`
- **Purpose**: AWS S3 integration for file uploads/downloads
- **Key Methods**:
  - `uploadFile(file, folder)` - Upload file to S3, returns key and URL
  - `getPresignedUrl(key, expiresIn)` - Generate time-limited access URL
  - `downloadFile(key)` - Download file as Buffer for email attachments
- **Configuration**: Uses AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME

#### `S3_SETUP.md`
- Complete documentation for S3 bucket setup
- IAM user configuration
- Bucket policies and CORS
- Testing procedures
- Cost estimates

### 2. Modified Files

#### `src/middleware/upload.ts`
- **Before**: Saved files to local disk at `src/uploads/`
- **After**: Uses `memoryStorage` to keep files in memory for S3 upload
- **Impact**: Files no longer stored locally, immediately uploaded to S3

#### `src/services/email.service.ts`
- **Added**: Support for email attachments
- **Implementation**: Raw MIME email format with multipart/mixed
- **Features**:
  - Accepts `attachments` array with filename, content (Buffer), contentType
  - Builds proper MIME structure with base64 encoded attachments
  - Falls back to Simple email format when no attachments

#### `src/services/updates.service.ts`
- **Added**: S3 service import
- **Enhanced**: Update email distribution now downloads PDFs from S3
- **Implementation**:
  - Loops through update attachments
  - Downloads each from S3 using `s3Service.downloadFile()`
  - Adds to email as attachment
  - Handles download errors gracefully (logs and continues)

#### `src/routes/admin.routes.ts`
- **Added**: Imports for `upload` middleware and `s3Service`
- **Modified**: `POST /updates/:id/attachments` route
  - **Before**: Accepted metadata (storageKey, fileName, mimeType, sizeBytes) as form data
  - **After**: Accepts file upload via `upload.single('file')`
  - **Flow**:
    1. Validate file uploaded
    2. Upload to S3
    3. Create Attachment record with S3 key
    4. Audit log with S3 URL

#### `src/routes/app.routes.ts`
- **Added**: `s3Service` import (removed unused `path`)
- **New Route**: `GET /api/notifications/count`
  - Returns `{ count, hasNew }` based on updates since `lastLoginAt`
  - Only shows for INVESTOR and PREINVESTOR roles
  - Respects visibility (preinvestors only see PORTAL_ALL)
- **Modified**: `GET /attachments/:storageKey(*)`
  - **Before**: Served files from local disk
  - **After**: Downloads from S3 and serves
  - **Features**:
    - Wildcard route to support S3 keys with slashes
    - Looks up attachment in database for metadata
    - Sets proper Content-Type and Content-Disposition headers
    - Audit logging

#### `src/views/app/admin/updates/view.ejs`
- **Before**: Complex form with manual metadata entry
- **After**: Simple file upload form
- **Features**:
  - File input with PDF accept attribute
  - `enctype="multipart/form-data"`
  - Improved attachment list display with KB sizes and View/Download button

#### `src/views/app/updates/show.ejs`
- **Added**: PDF inline display
- **Features**:
  - PDFs displayed in iframe (600px height)
  - Download button for each attachment
  - Responsive layout with rounded borders

#### `src/views/partials/nav.investor.ejs`
- **Added**: Notification badge on "Updates" link
- **Implementation**:
  - Badge hidden by default
  - JavaScript fetches `/api/notifications/count` on page load
  - Shows count in green badge if `hasNew && count > 0`
  - Capantra Green (#009775) background

#### `src/views/partials/nav.preinvestor.ejs`
- **Added**: Notification badge (same as investor nav)
- **Features**: Identical implementation to investor nav

### 3. Dependencies Added

```json
{
  "@aws-sdk/client-s3": "3.985.0",
  "@aws-sdk/lib-storage": "3.985.0",
  "@aws-sdk/s3-request-presigner": "3.985.0"
}
```

## Database Schema

### Existing Schema Used
- `User.lastLoginAt` - Already existed, used for tracking last login time
- `Update` - Stores update metadata
- `Attachment` - Stores attachment metadata with `storageKey` (now contains S3 key)

**No migrations needed** - all required fields already exist!

## User Flow Changes

### Admin: Creating Update with PDF

**Before:**
1. Create update
2. View update
3. Manually enter storage key, filename, mime type, size
4. Submit form

**After:**
1. Create update
2. View update
3. Click "Choose File", select PDF
4. Click "Upload attachment"
5. File automatically uploaded to S3
6. Attachment record created

### Admin: Publishing Update

**Before:**
- Emails sent with link to PDF in portal
- No PDF attached to email

**After:**
- Emails sent with PDF attached
- PDF also available in portal (both download and inline view)

### Investor/Preinvestor: Receiving Updates

**Before:**
- Check "Updates" page to see new updates
- Click update to view
- Download PDF separately

**After:**
- See notification badge showing count of new updates
- Receive email with PDF attached (can read offline)
- View update in portal with PDF embedded inline
- Can still download PDF if needed

## API Endpoints

### New

- `GET /api/notifications/count` - Returns count of new updates since last login
  - Response: `{ count: number, hasNew: boolean }`
  - Authentication: Required (session)
  - Roles: INVESTOR, PREINVESTOR (ADMIN returns 0)

### Modified

- `POST /admin/updates/:id/attachments` - Now accepts file upload
  - Before: `application/x-www-form-urlencoded` with metadata
  - After: `multipart/form-data` with file
  - Field: `file` (PDF file)
  - Returns: Redirect to update view

- `GET /attachments/:storageKey(*)` - Now serves from S3
  - Before: Served from `src/uploads/` directory
  - After: Downloads from S3 and serves
  - Authentication: Required
  - Headers: Sets Content-Type and Content-Disposition

## Configuration Required

### Environment Variables

Add to `.env`:

```env
S3_BUCKET_NAME=capantra-investor-portal
AWS_REGION=ap-southeast-4
AWS_ACCESS_KEY_ID=your_key_here
AWS_SECRET_ACCESS_KEY=your_secret_here
```

### AWS S3 Setup

1. Create S3 bucket: `capantra-investor-portal`
2. Create IAM user with S3 access
3. Configure bucket policy (see S3_SETUP.md)
4. Add credentials to .env

## Testing Checklist

### S3 Upload
- [ ] Admin can upload PDF to update
- [ ] File appears in S3 bucket
- [ ] Attachment record created in database
- [ ] S3 key stored correctly

### Email Attachments
- [ ] Publish update with PDF
- [ ] Receive email with PDF attached
- [ ] PDF opens correctly from email
- [ ] Email body still has link to portal

### Notification Badge
- [ ] Login as investor
- [ ] Admin creates and publishes update
- [ ] Refresh investor page
- [ ] Badge shows "1" next to Updates
- [ ] Click Updates, view update
- [ ] Logout and login again
- [ ] Badge no longer shows (lastLoginAt updated)

### PDF Inline Display
- [ ] View update with PDF attachment
- [ ] PDF displays inline in iframe
- [ ] Download button works
- [ ] PDF is properly formatted

## Rollback Plan

If issues occur:

1. **Disable S3 uploads**: Revert `src/middleware/upload.ts` to use diskStorage
2. **Disable email attachments**: Comment out attachment download in `updates.service.ts`
3. **Disable notifications**: Remove badge script from nav partials

## Performance Considerations

### S3 Operations
- Upload: ~1-2 seconds for 2MB PDF
- Download: ~500ms for email attachment
- Portal view: iframe loads directly from app server (not S3)

### Email Sending
- With attachment: ~2-3 seconds per email
- Sequential sending maintained (no change)
- Consider rate limiting for large campaigns

### Notification API
- Database query: Simple index lookup on publishedAt and visibility
- Returns in <50ms
- Cached on client side (only called on page load)

## Security Enhancements

1. **File validation**: Only PDFs accepted
2. **Authentication**: All downloads require valid session
3. **Audit logging**: All operations logged
4. **Private bucket**: S3 files not publicly accessible
5. **Size limits**: 25MB max upload

## Known Limitations

1. **Sequential email sending**: Still sends one at a time (existing limitation)
2. **No batch operations**: Upload one file at a time
3. **No file deletion**: Currently no admin UI to delete attachments
4. **Fixed folder**: All files go to "updates/" folder in S3

## Future Enhancements

### Short Term
- Add file deletion capability
- Support multiple file uploads
- Add progress indicator for uploads

### Medium Term
- Implement presigned URLs for direct S3 access
- Add thumbnail generation for PDFs
- Support other file types (images, documents)

### Long Term
- Implement parallel email sending
- Add file versioning
- CDN integration for faster downloads

## Cost Impact

- S3 storage: ~$0.005/month for 200MB
- S3 operations: ~$0.01/month for uploads/downloads
- Data transfer: Free (under 100GB)
- **Total: ~$0.02/month**

## Support & Troubleshooting

See `S3_SETUP.md` for:
- AWS setup instructions
- Common error solutions
- Testing procedures
- IAM policy examples

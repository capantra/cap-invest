import multer from "multer";

// Use memoryStorage to keep files in memory before uploading to S3
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

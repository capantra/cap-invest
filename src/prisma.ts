import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

// Load RDS CA certificate bundle for SSL validation
const caCert = fs.readFileSync(
  path.join(__dirname, "../rds-combined-ca-bundle.pem"),
  "utf-8"
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: caCert,
  },
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

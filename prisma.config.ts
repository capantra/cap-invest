import "dotenv/config";
import { defineConfig } from "prisma/config";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is missing");
}

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",

    // ✅ THIS is what Prisma v7 requires
    seed: "ts-node-dev --transpile-only prisma/seed.ts",
  },

  datasource: {
    url,
  },
});

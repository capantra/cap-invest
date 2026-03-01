import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Force TLS encryption; skip certificate verification (dev-friendly)
  ssl: { rejectUnauthorized: false },
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function confidentialityAgreementHtml(opts: { companyName: string }) {
  const { companyName } = opts;

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6;">
    <p><strong>CONFIDENTIALITY & PORTAL ACCESS AGREEMENT</strong></p>
    <p><strong>Disclosing Party:</strong> ${companyName} (“Company”, “we”, “us”).<br/>
       <strong>Receiving Party:</strong> The user accessing this portal (“you”, “Recipient”).</p>

    <p><strong>1. Purpose</strong><br/>
    The Company will provide access to this investor portal and related materials for the purpose of evaluating,
    monitoring, discussing, or supporting an actual or potential investment or shareholder relationship (“Purpose”).</p>

    <p><strong>2. Confidential Information</strong><br/>
    “Confidential Information” includes all non-public information made available via this portal or otherwise,
    including without limitation: financials, reporting, board packs, forecasts, cap table/shareholder information,
    strategy, product and technical materials, security information, legal/regulatory materials, documents, decks,
    and any updates or communications (including “Investor Only” materials). It also includes notes, analyses,
    compilations, and derivatives you create.</p>

    <p><strong>3. Exclusions</strong><br/>
    Confidential Information excludes information you can prove: (a) is public other than through your breach,
    (b) was lawfully known to you without restriction before disclosure, (c) is lawfully received from a third party
    without breach, or (d) is independently developed without use of Confidential Information.</p>

    <p><strong>4. Your obligations</strong><br/>
    You must: (a) use Confidential Information only for the Purpose; (b) keep it confidential and protect it using
    at least reasonable care; (c) not disclose it except as permitted below; (d) not copy, download, screenshot,
    scrape, forward portal links, or circumvent access controls except as strictly necessary for the Purpose and as
    permitted by the portal; (e) promptly notify the Company of any suspected unauthorized access or disclosure.</p>

    <p><strong>5. Permitted disclosures</strong><br/>
    You may disclose Confidential Information only to your representatives who have a strict need-to-know for the
    Purpose and are bound by confidentiality obligations no less protective than this Agreement. You are responsible
    for their compliance.</p>

    <p><strong>6. Investor-only restrictions</strong><br/>
    Certain materials are designated “Investor Only” and may be restricted based on your portal role. You must not
    attempt to access restricted materials or bypass controls.</p>

    <p><strong>7. Privacy and shareholder information</strong><br/>
    Portal materials may include personal information (including shareholder information). You agree to handle such
    information lawfully, securely, and only for the Purpose, and not to misuse or disclose it improperly.</p>

    <p><strong>8. Ownership / no licence</strong><br/>
    All Confidential Information remains the property of the Company or its licensors. No licence is granted except
    the limited right to use Confidential Information for the Purpose.</p>

    <p><strong>9. Return / destruction</strong><br/>
    Upon request or when the Purpose ends, you must delete or return Confidential Information (including copies and
    derivatives) except where retention is required by law or bona fide compliance policies. Any retained information
    remains subject to this Agreement.</p>

    <p><strong>10. Compelled disclosure</strong><br/>
    If you are legally compelled to disclose Confidential Information, you will (to the extent lawful) give prompt
    notice to allow the Company to seek protective relief, and disclose only the minimum required.</p>

    <p><strong>11. Term</strong><br/>
    This Agreement applies from acceptance and continues until the information no longer qualifies as confidential.
    Trade secrets remain protected as long as they retain trade secret status.</p>

    <p><strong>12. Remedies</strong><br/>
    Unauthorized disclosure may cause irreparable harm. The Company may seek injunctive or equitable relief in
    addition to other remedies.</p>

    <p><strong>13. No offer / no advice</strong><br/>
    Materials are provided for informational purposes only and do not constitute an offer of securities or financial,
    legal, or tax advice. You should obtain independent advice.</p>

    <p><strong>14. Electronic acceptance</strong><br/>
    By clicking “I Agree” you intend to sign electronically and agree this acceptance is legally binding.</p>

    <p><strong>15. Governing law</strong><br/>
    Unless otherwise required by mandatory law, the governing law is the Company’s jurisdiction of incorporation,
    with non-exclusive jurisdiction of its courts.</p>

    <p><strong>Acceptance record</strong><br/>
    Your acceptance (including timestamp, account identity, IP address, and user agent) will be recorded for audit
    and compliance purposes.</p>
  </div>
  `.trim();
}

async function main() {
  const companyName = process.env.COMPANY_LEGAL_NAME || "Capantra Pty Ltd";
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@capantra.com").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "ChangeMeNow!12345";

  console.log("Seeding:", { companyName, adminEmail, ssl: "PG_SSL_NO_VERIFY" });

  const types = ["Monthly Update", "Urgent Notice", "Board Pack"];
  for (const name of types) {
    await prisma.updateType.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const bodyHtml = confidentialityAgreementHtml({ companyName });
  const agreement = await prisma.agreement.upsert({
    where: { key_version: { key: "CONFIDENTIALITY", version: "1.0" } },
    update: {
      title: "Confidentiality & Portal Access Agreement",
      bodyHtml,
      sha256: sha256(bodyHtml),
      effectiveAt: new Date(),
    },
    create: {
      key: "CONFIDENTIALITY",
      version: "1.0",
      title: "Confidentiality & Portal Access Agreement",
      bodyHtml,
      sha256: sha256(bodyHtml),
      effectiveAt: new Date(),
    },
  });

  const pwHash = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: "ADMIN",
      passwordHash: pwHash,
      isActive: true,
      canViewTreasury: true,
    },
    create: {
      email: adminEmail,
      role: "ADMIN",
      passwordHash: pwHash,
      isActive: true,
      canViewTreasury: true,
    },
  });

  console.log("Seed complete ✅");
  console.log("Agreement:", { id: agreement.id, version: agreement.version });
  console.log("Admin:", { email: admin.email, role: admin.role });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

// src/server.ts
import "dotenv/config";
import path from "path";
import express from "express";
import engine from "ejs-mate";
import cookieParser from "cookie-parser";
import { routes } from "./routes";

const app = express();
app.set("view cache", false);

/**
 * EJS + ejs-mate layouts
 */
app.engine("ejs", engine);
app.set("view engine", "ejs");

// Views root (stable path)
const viewsDir = path.join(process.cwd(), "src", "views");
app.set("views", viewsDir);

// Make views root available to templates (for absolute filesystem includes)
app.use((_req, res, next) => {
  res.locals.viewsRoot = viewsDir;
  next();
});

// Optional: helps some include strategies, harmless to keep
app.locals.basedir = viewsDir;

console.log("VIEWS DIR =", viewsDir);

/**
 * Trust proxy (needed behind ALB/Cloudflare/etc)
 */
if (process.env.TRUST_PROXY) {
  // If you're behind a single proxy (ALB / Nginx), "1" is fine.
  app.set("trust proxy", 1);
}

/**
 * Static assets
 */
app.use("/assets", express.static(path.join(process.cwd(), "src", "public-assets")));

/**
 * Middleware
 */
app.use(cookieParser());

app.use("/webhooks/ses", express.json({ type: "*/*" }));

/**
 * Normal request body parsing for everything else
 */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/**
 * Root route
 * NOTE: You currently use "/app/dashboard". If you later remove the "/app" prefix,
 * change this to "/dashboard".
 */
app.get("/", (req, res) => {
  const hasSession = Boolean((req as any).cookies?.session);
  res.redirect(hasSession ? "/dashboard" : "/login");
});

/**
 * Routes
 */
app.use(routes);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

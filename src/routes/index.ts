import { Router } from "express";
import { publicRoutes } from "./public.routes";
import { appRoutes } from "./app.routes";
import { adminRoutes } from "./admin.routes";
import { sesWebhookRoutes } from "./ses.webhook.routes";

export const routes = Router();

/**
 * Webhooks FIRST (no auth)
 */
routes.use("/webhooks/ses", sesWebhookRoutes);

/**
 * Public (landing, login, invite, etc.)
 */
routes.use(publicRoutes);

/**
 * Authenticated app (NO /app prefix)
 */
routes.use(appRoutes);

/**
 * Admin (NO /app prefix)
 */
routes.use("/admin", adminRoutes);

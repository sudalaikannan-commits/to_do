import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { errorHandler } from "./auth.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import taskRoutes from "./routes/tasks.js";
import bugRoutes from "./routes/bugs.js";
import commentRoutes from "./routes/comments.js";
import notificationRoutes from "./routes/notifications.js";
import dashboardRoutes from "./routes/dashboard.js";

dotenv.config();

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  const origins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim());
  app.use(cors({ origin: origins, credentials: false }));
  app.use(morgan("combined"));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/auth/bootstrap", rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }));

  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, service: "ationic-functions", time: new Date().toISOString() })
  );

  app.use("/api/auth", authRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/tasks", taskRoutes);
  app.use("/api/bugs", bugRoutes);
  app.use("/api/comments", commentRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api", dashboardRoutes); // /api/dashboard, /api/search, /api/activity

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}

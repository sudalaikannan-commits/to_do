import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { config, assertJwtSecret } from "./config.js";
import { errorHandler } from "./middleware/auth.js";
import { attachSockets } from "./socket.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import taskRoutes from "./routes/tasks.js";
import bugRoutes from "./routes/bugs.js";
import commentRoutes from "./routes/comments.js";
import notificationRoutes from "./routes/notifications.js";
import dashboardRoutes from "./routes/dashboard.js";

assertJwtSecret();

const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false, // API only; frontend sets its own CSP via hosting
    crossOriginEmbedderPolicy: false,
  })
);
app.use(
  cors({
    origin: config.frontendUrl.split(",").map((s) => s.trim()),
    credentials: true,
  })
);
app.use(morgan("combined"));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
});
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/bootstrap", rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "ationic-backend", time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/bugs", bugRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api", dashboardRoutes); // /api/dashboard, /api/search, /api/activity

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: config.frontendUrl.split(",").map((s) => s.trim()), credentials: true },
  path: "/socket.io",
});
attachSockets(io);

httpServer.listen(config.port, () => {
  console.log(`Ationic backend listening on :${config.port} (env=${config.nodeEnv})`);
});

import type { Server as SocketServer, Socket } from "socket.io";
import { verifySession } from "./utils/auth.js";
import { config } from "./config.js";
import { setIO } from "./realtime.js";

export function attachSockets(io: SocketServer) {
  setIO(io);

  io.use((socket: Socket, next) => {
    try {
      // Prefer auth token, fall back to signed cookie header
      const header = socket.handshake.headers.cookie ?? "";
      const cookies = header ? parseCookies(header) : {};
      const token = (socket.handshake.auth?.token as string | undefined) ?? cookies[config.cookieName];
      if (!token) return next(new Error("unauthorized"));
      const payload = verifySession(token);
      (socket.data as { user?: unknown }).user = payload;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = (socket.data as { user?: { sub: string } }).user;
    // Every authenticated member joins the shared workspace room
    socket.join("workspace:ationic");
    if (user?.sub) socket.join(`user:${user.sub}`);

    socket.on("project:join", (projectId: string) => {
      if (typeof projectId === "string" && projectId.length < 100) socket.join(`project:${projectId}`);
    });
    socket.on("project:leave", (projectId: string) => {
      if (typeof projectId === "string") socket.leave(`project:${projectId}`);
    });
  });
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k) out[k.trim()] = decodeURIComponent(rest.join("="));
  }
  return out;
}

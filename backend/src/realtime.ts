import type { Server as SocketServer } from "socket.io";

let io: SocketServer | null = null;

export function setIO(server: SocketServer) {
  io = server;
}

export function emitToWorkspace(workspaceId: string, event: string, payload: unknown) {
  io?.to(`workspace:${workspaceId}`).emit(event, payload);
}

export function emitToProject(projectId: string, event: string, payload: unknown) {
  io?.to(`project:${projectId}`).emit(event, payload);
}

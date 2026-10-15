import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "./auth";

const Ctx = createContext<Socket | null>(null);

export function SocketProvider({ children, onEvent }: { children: ReactNode; onEvent: (event: string, payload: unknown) => void }) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }
    const base = import.meta.env.VITE_API_URL ?? "";
    const socket = io(base || undefined, { withCredentials: true, path: "/socket.io" });
    const events = [
      "task:created", "task:updated", "task:deleted",
      "bug:created", "bug:updated", "bug:deleted",
      "comment:added", "project:created", "project:updated", "project:deleted",
      "notification:new",
    ];
    const fns = events.map((ev) => {
      const fn = (payload: unknown) => handlerRef.current(ev, payload);
      socket.on(ev, fn);
      return [ev, fn] as const;
    });
    socketRef.current = socket;
    return () => {
      fns.forEach(([ev, fn]) => socket.off(ev, fn));
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  return <Ctx.Provider value={socketRef.current}>{children}</Ctx.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(Ctx);
}

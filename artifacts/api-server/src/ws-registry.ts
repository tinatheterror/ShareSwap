import type { WebSocket } from "ws";

/** userId → the user's open chat WebSocket. Shared by the REST routes (to push frames) and the moderation service (to close one). */
export const connectedClients = new Map<number, WebSocket>();

/** Closes and forgets a user's open socket, if any. 1008 is "policy violation": the client treats it as signed out. */
export function closeUserConnection(userId: number, reason = "Signed out") {
  const ws = connectedClients.get(userId);
  connectedClients.delete(userId);
  if (!ws) return false;
  try {
    ws.close(1008, reason);
  } catch {
    ws.terminate();
  }
  return true;
}

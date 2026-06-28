import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Neon serverless databases auto-suspend after inactivity and send a
// connection-termination message (PostgreSQL error 57P01) when they do.
// We catch errors at BOTH the pool level and the individual client level
// to prevent any unhandled error event from crashing the process.
pool.on('error', (err: any) => {
  const msg = err?.message ?? String(err);
  const isExpected =
    err?.code === '57P01' ||
    msg.includes('terminating connection') ||
    msg.includes('connection terminated') ||
    msg.includes('ECONNRESET') ||
    msg.includes('socket hang up') ||
    msg.includes('WebSocket') ||
    msg.includes('websocket');
  if (isExpected) {
    console.warn('[DB] Neon connection suspended/terminated – will reconnect on next query.');
  } else {
    console.error('[DB] Unexpected pool error:', msg);
  }
});

// Catch errors on individual client connections so they never become
// unhandled EventEmitter errors that would crash the process.
pool.on('connect', (client: any) => {
  client.on('error', (err: any) => {
    const msg = err?.message ?? String(err);
    console.warn('[DB] Client connection error (handled):', msg);
  });
});

// Keepalive: send a lightweight query every 55s to prevent Neon from
// auto-suspending idle connections (which would cause a silent crash).
// Uses a one-shot pattern: if the query fails, it's silently swallowed
// and the pool will reconnect on the next real query.
const KEEPALIVE_INTERVAL_MS = 55_000;
function scheduleKeepalive() {
  setTimeout(async () => {
    try {
      await pool.query('SELECT 1');
    } catch (_) {
      // Ignored – next real query will reconnect automatically
    }
    scheduleKeepalive();
  }, KEEPALIVE_INTERVAL_MS);
}
scheduleKeepalive();

export const db = drizzle({ client: pool, schema });

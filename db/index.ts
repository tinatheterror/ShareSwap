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
// Without an 'error' listener the Pool emits an unhandled error event
// which crashes the Node.js process. The Pool automatically creates a
// fresh connection on the next query, so we only need to log and swallow.
pool.on('error', (err: any) => {
  const isTermination =
    err?.code === '57P01' ||
    err?.message?.includes('terminating connection') ||
    err?.message?.includes('connection terminated');
  if (isTermination) {
    console.warn('[DB] Neon connection suspended/terminated – will reconnect on next query.');
  } else {
    console.error('[DB] Unexpected pool error:', err?.message ?? err);
  }
});

export const db = drizzle({ client: pool, schema });

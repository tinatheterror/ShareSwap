import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const RELAY_DOMAIN = "@privaterelay.appleid.com";

type Recipient = string | { email: string } | undefined | null;
type Recipients = Recipient | Recipient[];

const addressOf = (r: Recipient) => (typeof r === "string" ? r : r?.email ?? "").trim();

/** Keeps the log useful without keeping the address: first letter and the domain. */
export const maskAddress = (address: string) => `${address.slice(0, 1)}***${address.slice(address.indexOf("@"))}`;

/**
 * Whether Apple has told us it no longer forwards mail to this private-relay address (the email-disabled notification,
 * recorded in apple_links.email_forwarding_enabled). Only @privaterelay.appleid.com addresses are ever looked up.
 */
export async function relayForwardingDisabled(address: string): Promise<boolean> {
  const normalized = address.trim().toLowerCase();
  if (!normalized.endsWith(RELAY_DOMAIN)) return false;
  const { rows } = await db.execute(sql`
    SELECT 1 FROM apple_links al JOIN users u ON u.id = al.user_id
    WHERE lower(u.email) = ${normalized} AND al.email_forwarding_enabled = false LIMIT 1`);
  return rows.length > 0;
}

type Message = { to?: Recipients; subject?: string };

/**
 * Sends through `sender` unless the only recipient is a relay address Apple has switched off; then it logs the skip and
 * sends nothing. With several recipients, the disabled ones are dropped and the rest are sent.
 */
export async function sendUnlessRelayDisabled<M extends Message, R>(sender: (message: M) => Promise<R>, message: M): Promise<R | undefined> {
  const list = (Array.isArray(message.to) ? message.to : [message.to]).filter((r) => addressOf(r));
  if (list.length === 0) return sender(message);
  const keep: Recipient[] = [];
  for (const recipient of list) {
    const address = addressOf(recipient);
    if (await relayForwardingDisabled(address)) console.log(`[Mail] Skipped email to ${maskAddress(address)}: Apple forwarding to this private-relay address is disabled`);
    else keep.push(recipient);
  }
  if (keep.length === 0) return undefined;
  return sender(keep.length === list.length ? message : { ...message, to: keep as Recipients });
}

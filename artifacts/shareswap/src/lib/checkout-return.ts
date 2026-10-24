import { apiRequest } from "@/lib/queryClient";

const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{1,200}$/;

/**
 * Back from Stripe Checkout (?sub_success=true&session_id=cs_...): ask the server to read the session from Stripe,
 * so the plan updates now even when the webhook is late or fails (mobile does the same). Never throws: the webhook
 * remains the main path, and the caller refreshes the plan either way.
 */
export async function confirmCheckoutReturn(search: string, post: typeof apiRequest = apiRequest): Promise<void> {
  const params = new URLSearchParams(search);
  const sessionId = params.get("session_id");
  if (params.get("sub_success") !== "true" || !sessionId || !CHECKOUT_SESSION_ID.test(sessionId)) return;
  try {
    await post("POST", "/api/subscription/confirm", { sessionId });
  } catch {
    // The webhook will catch up.
  }
}

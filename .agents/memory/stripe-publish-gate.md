---
name: Stripe publish gate
description: Replit's live-Stripe publishing prerequisite for a payment-enabled ShareSwap release.
---

The workspace's connected Stripe integration can be a sandbox connection while Publish still requires a separate activated live account. Replit's documentation describes installing the Replit Integrated Payments app from the Publish pane instead of pasting API keys, but an existing published app may show only a "Connect a live Stripe account before publishing" banner and no install button. Do not assume the documented button exists in that UI.

**Why:** A backend fix for owner return confirmation was ready in development, but republishing was blocked on connecting live Stripe. Replit's documentation describes removing the integration or rolling back as alternatives when not ready for live Stripe; ShareSwap relies on Stripe for deposits and rental payments, so neither is a safe routine workaround for this product.

**How to apply:** Explain the account-activation/verification step. If the install button is missing, inspect Integrations → Stripe → Manage with the user to find the live-account controls; do not invent a click path or tell them to disconnect an existing account. Never ask for or store live keys. Do not disconnect Stripe or disable deposit handling without explicit informed consent and a plan for existing payment holds.
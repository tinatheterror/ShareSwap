import type { Express } from "express";
import { eq } from "drizzle-orm";
import { biometricConsents, db } from "@workspace/db";
import { csrfProtection } from "./csrf";
import { DELETION_GRACE_DAYS } from "./account-deletion/retention";

/**
 * Explicit consent before Persona starts an identity check. Persona collects images of the member's government ID and a selfie and
 * compares the face with the ID photo (biometric data). This is the one place the wording lives: the web and mobile apps render
 * it from GET /api/biometric-consent, POST /api/persona/create-inquiry refuses without a record at the current version, and the
 * Privacy Policy section it links to is "Identity verification and face matching" (a test keeps the three in step).
 *
 * Change the wording (or what is collected, or who receives it) => bump BIOMETRIC_CONSENT_VERSION, so everyone is asked again.
 */
export const BIOMETRIC_CONSENT_VERSION = "2026-11-09.3";

export const BIOMETRIC_NOTICE =
  "To verify your identity, Persona, our verification provider, will collect images of your government ID and a selfie, and match your face to your ID photo. " +
  "Persona uses this data to verify your identity, to detect fraud, and to improve its own service. " +
  "Persona deletes your ID images and selfie about 30 days after your verification is decided. " +
  `If you delete your account, we ask Persona to delete them when the deletion is completed: after a ${DELETION_GRACE_DAYS}-day grace period, or sooner if you choose to delete it immediately. ` +
  "ShareSwap receives only the result and your name; we do not receive or keep the ID images or the selfie.";

export const BIOMETRIC_CHECKBOX_LABEL =
  "I agree to ShareSwap and Persona collecting and using my ID and face data to verify my identity, detect fraud and improve Persona's service.";

/** The Privacy Policy section the notice links to (the heading in docs/legal/privacy-policy.md, as an anchor on /privacy). */
export const BIOMETRIC_POLICY_HEADING = "Identity verification and face matching";
export const BIOMETRIC_POLICY_PATH = "/privacy#identity-verification-and-face-matching";

export const BIOMETRIC_CONSENT_REQUIRED_CODE = "BIOMETRIC_CONSENT_REQUIRED";
// Free of the words "csrf" and "token": both apps retry a 403 whose body mentions them.
export const BIOMETRIC_CONSENT_REQUIRED_MESSAGE = "Please read the notice and agree to the use of your ID and face data before you start verifying your identity.";

export async function biometricConsentFor(userId: number): Promise<{ consented: boolean; consentedAt: Date | null }> {
  const [row] = await db.select().from(biometricConsents).where(eq(biometricConsents.userId, userId)).limit(1);
  const consented = !!row && row.version === BIOMETRIC_CONSENT_VERSION;
  return { consented, consentedAt: consented ? row.consentedAt : null };
}

export const hasBiometricConsent = async (userId: number) => (await biometricConsentFor(userId)).consented;

const payload = (state: { consented: boolean; consentedAt: Date | null }) => ({
  version: BIOMETRIC_CONSENT_VERSION,
  notice: BIOMETRIC_NOTICE,
  checkboxLabel: BIOMETRIC_CHECKBOX_LABEL,
  policyPath: BIOMETRIC_POLICY_PATH,
  consented: state.consented,
  consentedAt: state.consentedAt,
});

export function registerBiometricConsentRoutes(app: Express) {
  app.get("/api/biometric-consent", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.sendStatus(401);
    return res.json(payload(await biometricConsentFor((req.user as { id: number }).id)));
  });

  // The checkbox. `version` is the version of the text the person saw; a stale one is refused so they see the current wording.
  app.post("/api/biometric-consent", csrfProtection, async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.sendStatus(401);
    if (req.body?.agreed !== true) return res.status(400).json({ message: "Tick the box to agree." });
    if (req.body?.version !== BIOMETRIC_CONSENT_VERSION) {
      return res.status(409).json({ message: "The notice has changed. Please read it again.", version: BIOMETRIC_CONSENT_VERSION });
    }
    const userId = (req.user as { id: number }).id;
    await db.insert(biometricConsents).values({ userId, version: BIOMETRIC_CONSENT_VERSION })
      .onConflictDoUpdate({ target: biometricConsents.userId, set: { version: BIOMETRIC_CONSENT_VERSION, consentedAt: new Date() } });
    return res.json(payload(await biometricConsentFor(userId)));
  });
}

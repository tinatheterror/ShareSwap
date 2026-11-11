// Email utility - sends through Resend (https://resend.com/docs/api-reference/emails/send-email).
// Secrets: RESEND_API_KEY and EMAIL_FROM (support@shareswap.app, a domain verified in Resend).
import { maskAddress, sendUnlessRelayDisabled } from './email-relay';
import { assertRealSendAllowed, chooseEmailMode } from './email-guard';

const RESEND_URL = 'https://api.resend.com/emails';

type MailMessage = { to: string | string[]; from?: string; subject: string; text?: string; html?: string };

function getCredentials() {
  const apiKey = (process.env.RESEND_API_KEY ?? '').trim();
  const email = (process.env.EMAIL_FROM ?? '').trim();
  if (!apiKey || !email) {
    const missing = [!apiKey && 'RESEND_API_KEY', !email && 'EMAIL_FROM'].filter(Boolean).join(' and ');
    throw new Error(`Resend is not configured: ${missing} missing from Secrets. No email can be sent.`);
  }
  return { apiKey, email };
}

// Every message a test process "sent" (the fake sender records instead of calling Resend). Tests read and clear it.
export const sentMail: MailMessage[] = [];
// Lets a test make the next sends fail, to check callers cope.
export const fakeMailFailure: { error: Error | null } = { error: null };

async function sendViaResend(apiKey: string, message: MailMessage) {
  assertRealSendAllowed();
  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`Resend rejected the email (HTTP ${response.status}): ${detail}`);
  }
}

export function getMailClient() {
  const mode = chooseEmailMode();
  if (mode !== 'live') {
    const fromEmail = (process.env.EMAIL_FROM ?? '').trim() || 'support@shareswap.app';
    const client = {
      send: async (message: MailMessage) => {
        if (mode === 'fake') {
          if (fakeMailFailure.error) throw fakeMailFailure.error;
          sentMail.push({ from: fromEmail, ...message });
          return;
        }
        const to = (Array.isArray(message.to) ? message.to : [message.to]).map((a) => maskAddress(String(a))).join(', ');
        console.log(`[Mail:log] EMAIL_MODE=log, not sent. To: ${to} | Subject: ${message.subject}\n${message.text ?? ''}`);
      },
    };
    return { client, fromEmail };
  }
  const { apiKey, email } = getCredentials();
  // Every email goes through this wrapper, which skips (and logs) private-relay addresses Apple has switched off.
  const client = {
    send: (message: MailMessage) => sendUnlessRelayDisabled((m: MailMessage) => sendViaResend(apiKey, m), message),
  };
  return { client, fromEmail: email };
}

// Send email verification link
export async function sendVerificationEmail(toEmail: string, verificationToken: string, displayName?: string) {
  try {
    const { client, fromEmail } = await getMailClient();
    
    // In development, always use the dev domain so the token (stored in the dev DB)
    // can be found. In production, use the custom domain.
    const baseUrl = process.env.NODE_ENV === 'production' && process.env.CUSTOM_DOMAIN
      ? `https://${process.env.CUSTOM_DOMAIN}`
      : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.CUSTOM_DOMAIN
      ? `https://${process.env.CUSTOM_DOMAIN}`
      : 'http://localhost:5000';
    
    const verificationLink = `${baseUrl}/api/auth/verify-email?token=${verificationToken}`;
    
    const msg = {
      to: toEmail,
      from: fromEmail,
      subject: 'Verify your ShareSwap account',
      text: `Hi ${displayName || 'there'},\n\nWelcome to ShareSwap! Please verify your email address by clicking the link below:\n\n${verificationLink}\n\nThis link expires in 24 hours.\n\nIf you didn't create a ShareSwap account, you can safely ignore this email.\n\nBest,\nThe ShareSwap Team`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #0D9488; margin: 0;">ShareSwap</h1>
            <p style="color: #64748B; margin-top: 5px;">Share more, own less</p>
          </div>
          
          <h2 style="color: #1E293B;">Hi ${displayName || 'there'},</h2>
          
          <p style="color: #475569; line-height: 1.6;">
            Welcome to ShareSwap! Please verify your email address by clicking the button below:
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationLink}" 
               style="background-color: #0D9488; color: white; padding: 14px 28px; 
                      text-decoration: none; border-radius: 8px; font-weight: bold;
                      display: inline-block;">
              Verify Email Address
            </a>
          </div>
          
          <p style="color: #64748B; font-size: 14px;">
            This link expires in 24 hours.
          </p>
          
          <p style="color: #64748B; font-size: 14px;">
            If you didn't create a ShareSwap account, you can safely ignore this email.
          </p>
          
          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;" />
          
          <p style="color: #94A3B8; font-size: 12px; text-align: center;">
            &copy; ${new Date().getFullYear()} ShareSwap. Connect with your neighbours.
          </p>
        </div>
      `
    };

    await client.send(msg);
    console.log(`[Mail] Verification email sent to ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[Mail] Error sending verification email:', error);
    return false;
  }
}

// Send email-change verification link to the NEW address
export async function sendEmailChangeVerificationEmail(toEmail: string, verificationToken: string, displayName?: string) {
  try {
    const { client, fromEmail } = await getMailClient();

    const baseUrl = process.env.NODE_ENV === 'production' && process.env.CUSTOM_DOMAIN
      ? `https://${process.env.CUSTOM_DOMAIN}`
      : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.CUSTOM_DOMAIN
      ? `https://${process.env.CUSTOM_DOMAIN}`
      : 'http://localhost:5000';

    const verificationLink = `${baseUrl}/api/auth/verify-email?token=${verificationToken}`;

    const msg = {
      to: toEmail,
      from: fromEmail,
      subject: 'Confirm your new ShareSwap email address',
      text: `Hi ${displayName || 'there'},\n\nYou recently requested to change your ShareSwap email address to this one. Click the link below to confirm:\n\n${verificationLink}\n\nThis link expires in 24 hours.\n\nIf you didn't request this change, please ignore this email — your current email will remain unchanged.\n\nBest,\nThe ShareSwap Team`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #0D9488; margin: 0;">ShareSwap</h1>
            <p style="color: #64748B; margin-top: 5px;">Share more, own less</p>
          </div>

          <h2 style="color: #1E293B;">Hi ${displayName || 'there'},</h2>

          <p style="color: #475569; line-height: 1.6;">
            You recently requested to change your ShareSwap email address to this one.
            Click the button below to confirm the change:
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationLink}"
               style="background-color: #0D9488; color: white; padding: 14px 28px;
                      text-decoration: none; border-radius: 8px; font-weight: bold;
                      display: inline-block;">
              Confirm New Email Address
            </a>
          </div>

          <p style="color: #64748B; font-size: 14px;">
            This link expires in <strong>24 hours</strong>.
          </p>

          <p style="color: #64748B; font-size: 14px;">
            If you didn't request this change, please ignore this email — your current email address will remain unchanged.
          </p>

          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;" />

          <p style="color: #94A3B8; font-size: 12px; text-align: center;">
            &copy; ${new Date().getFullYear()} ShareSwap. Connect with your neighbours.
          </p>
        </div>
      `
    };

    await client.send(msg);
    console.log(`[Mail] Email-change verification email sent to ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[Mail] Error sending email-change verification email:', error);
    return false;
  }
}

// Send security alert to the OLD email when user requests an email change
export async function sendEmailChangeAlertEmail(toEmail: string, newEmail: string, displayName?: string) {
  try {
    const { client, fromEmail } = await getMailClient();

    const msg = {
      to: toEmail,
      from: fromEmail,
      subject: 'ShareSwap: email address change requested',
      text: `Hi ${displayName || 'there'},\n\nWe received a request to change the email address on your ShareSwap account to: ${newEmail}\n\nThe change will only take effect once the new address is confirmed via the link we sent to it.\n\nIf you did not make this request, your account may be compromised. Please change your password immediately or contact our support team.\n\nBest,\nThe ShareSwap Team`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #0D9488; margin: 0;">ShareSwap</h1>
            <p style="color: #64748B; margin-top: 5px;">Share more, own less</p>
          </div>

          <h2 style="color: #1E293B;">Hi ${displayName || 'there'},</h2>

          <p style="color: #475569; line-height: 1.6;">
            We received a request to change the email address on your ShareSwap account to:
          </p>

          <p style="font-weight: bold; color: #1E293B; font-size: 16px; margin: 16px 0;">${newEmail}</p>

          <p style="color: #475569; line-height: 1.6;">
            The change will only take effect once confirmed from the new address.
            Your current email remains active until then.
          </p>

          <div style="background-color: #FEF2F2; border-left: 4px solid #EF4444; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <p style="color: #991B1B; margin: 0; font-weight: bold;">Didn't request this?</p>
            <p style="color: #B91C1C; margin: 8px 0 0;">
              If you did not make this request, your account may be at risk.
              Please change your password immediately.
            </p>
          </div>

          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;" />

          <p style="color: #94A3B8; font-size: 12px; text-align: center;">
            &copy; ${new Date().getFullYear()} ShareSwap. Connect with your neighbours.
          </p>
        </div>
      `
    };

    await client.send(msg);
    console.log(`[Mail] Email-change alert sent to old address ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[Mail] Error sending email-change alert email:', error);
    return false;
  }
}

// Send password reset link
export async function sendPasswordResetEmail(toEmail: string, resetToken: string, displayName?: string) {
  try {
    const { client, fromEmail } = await getMailClient();

    const baseUrl = process.env.NODE_ENV === 'production' && process.env.CUSTOM_DOMAIN
      ? `https://${process.env.CUSTOM_DOMAIN}`
      : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.CUSTOM_DOMAIN
      ? `https://${process.env.CUSTOM_DOMAIN}`
      : 'http://localhost:5000';

    // Link goes to the deep-link redirect shim which bounces native app users straight
    // into the Set New Password screen; web/desktop browsers fall back gracefully.
    const resetLink = `${baseUrl}/api/auth/reset-password-redirect?token=${encodeURIComponent(resetToken)}`;

    const msg = {
      to: toEmail,
      from: fromEmail,
      subject: 'Reset your ShareSwap password',
      text: `Hi ${displayName || 'there'},\n\nWe received a request to reset your ShareSwap password.\n\nYour password reset token is:\n\n${resetToken}\n\nOr click the link below to open the app:\n${resetLink}\n\nThis token expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.\n\nBest,\nThe ShareSwap Team`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #0D9488; margin: 0;">ShareSwap</h1>
            <p style="color: #64748B; margin-top: 5px;">Share more, own less</p>
          </div>

          <h2 style="color: #1E293B;">Hi ${displayName || 'there'},</h2>

          <p style="color: #475569; line-height: 1.6;">
            We received a request to reset your ShareSwap password. Click the button below to set a new password:
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}"
               style="background-color: #0D9488; color: white; padding: 14px 28px;
                      text-decoration: none; border-radius: 8px; font-weight: bold;
                      display: inline-block;">
              Reset Password
            </a>
          </div>

          <p style="color: #64748B; font-size: 14px;">
            This link expires in <strong>1 hour</strong>.
          </p>

          <p style="color: #64748B; font-size: 14px;">
            If you didn't request a password reset, you can safely ignore this email — your password will not change.
          </p>

          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;" />

          <p style="color: #94A3B8; font-size: 12px; text-align: center;">
            &copy; ${new Date().getFullYear()} ShareSwap. Connect with your neighbours.
          </p>
        </div>
      `
    };

    await client.send(msg);
    console.log(`[Mail] Password reset email sent to ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[Mail] Error sending password reset email:', error);
    return false;
  }
}

const appBaseUrl = () =>
  process.env.NODE_ENV === 'production' && process.env.CUSTOM_DOMAIN
    ? `https://${process.env.CUSTOM_DOMAIN}`
    : process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.CUSTOM_DOMAIN
    ? `https://${process.env.CUSTOM_DOMAIN}`
    : 'http://localhost:5000';

const deletionDate = (date: Date) => date.toLocaleDateString('en-CA', { dateStyle: 'long', timeZone: 'UTC' });

const emailShell = (greeting: string, paragraphs: string[]) => `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #0D9488; margin: 0;">ShareSwap</h1>
            <p style="color: #64748B; margin-top: 5px;">Share more, own less</p>
          </div>
          <h2 style="color: #1E293B;">${greeting}</h2>
          ${paragraphs.map((p) => `<p style="color: #475569; line-height: 1.6;">${p}</p>`).join('\n          ')}
          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;" />
          <p style="color: #94A3B8; font-size: 12px; text-align: center;">
            &copy; ${new Date().getFullYear()} ShareSwap. Connect with your neighbours.
          </p>
        </div>`;

// Tells the person their account will be deleted on `deleteOn`, and how to cancel. Sent to their own address only.
export async function sendAccountDeletionRequestedEmail(toEmail: string, deleteOn: Date, displayName?: string) {
  try {
    const { client, fromEmail } = await getMailClient();
    const greeting = `Hi ${displayName || 'there'},`;
    const date = deletionDate(deleteOn);
    const cancelUrl = `${appBaseUrl()}/delete-account`;
    const lines = [
      `We received a request to delete your ShareSwap account. It will be deleted on <strong>${date}</strong> (UTC).`,
      `Until then you can change your mind: open the ShareSwap app, go to Settings and tap <strong>Cancel deletion</strong>, or sign in at <a href="${cancelUrl}">${cancelUrl}</a> and cancel there.`,
      `If you did not ask for this, sign in and cancel the deletion, then change your password.`,
    ];
    await client.send({
      to: toEmail,
      from: fromEmail,
      subject: `ShareSwap: your account will be deleted on ${date}`,
      text: `${greeting}\n\nWe received a request to delete your ShareSwap account. It will be deleted on ${date} (UTC).\n\nUntil then you can change your mind: open the ShareSwap app, go to Settings and tap Cancel deletion, or sign in at ${cancelUrl} and cancel there.\n\nIf you did not ask for this, sign in and cancel the deletion, then change your password.\n\nBest,\nThe ShareSwap Team`,
      html: emailShell(greeting, lines),
    });
    console.log('[Mail] Account deletion request email sent');
    return true;
  } catch (error) {
    console.error('[Mail] Error sending account deletion request email:', error);
    return false;
  }
}

// Confirms the deletion is done. The address is the one the account was opened with, read before it was erased.
export async function sendAccountDeletedEmail(toEmail: string, displayName?: string) {
  try {
    const { client, fromEmail } = await getMailClient();
    const greeting = `Hi ${displayName || 'there'},`;
    const lines = [
      `Your ShareSwap account has been deleted. Your profile, listings, messages and saved details are gone.`,
      `Records of payments and of bookings that involved other members are kept for the period the law requires, without your name or contact details.`,
      `You are welcome to join again at any time.`,
    ];
    await client.send({
      to: toEmail,
      from: fromEmail,
      subject: 'Your ShareSwap account has been deleted',
      text: `${greeting}\n\nYour ShareSwap account has been deleted. Your profile, listings, messages and saved details are gone.\n\nRecords of payments and of bookings that involved other members are kept for the period the law requires, without your name or contact details.\n\nYou are welcome to join again at any time.\n\nBest,\nThe ShareSwap Team`,
      html: emailShell(greeting, lines),
    });
    console.log('[Mail] Account deleted email sent');
    return true;
  } catch (error) {
    console.error('[Mail] Error sending account deleted email:', error);
    return false;
  }
}

// Tells a member their earlier identity verification was simulated (a Persona sandbox key was live) and has been reset, and asks them to verify again.
// Sent by the one-off sandbox reset (persona-sandbox-reset.ts), once per member, to their own address only.
export async function sendVerificationResetEmail(toEmail: string, displayName?: string) {
  try {
    const { client, fromEmail } = await getMailClient();
    const greeting = `Hi ${displayName || 'there'},`;
    const verifyUrl = `${appBaseUrl()}/verification`;
    const lines = [
      `Your earlier identity verification on ShareSwap was recorded in a test mode, so your ID was not actually checked. That was our mistake, and we are sorry.`,
      `We have removed the verified status, and the trust points and ShareCoins, that it gave you. Nothing else on your account has changed.`,
      `To earn them back, verify your identity again: open the ShareSwap app, or go to <a href="${verifyUrl}">${verifyUrl}</a>. Before the check starts you will be asked to agree to how your ID and face data are handled.`,
    ];
    await client.send({
      to: toEmail,
      from: fromEmail,
      subject: 'ShareSwap: please verify your identity again',
      text: `${greeting}\n\nYour earlier identity verification on ShareSwap was recorded in a test mode, so your ID was not actually checked. That was our mistake, and we are sorry.\n\nWe have removed the verified status, and the trust points and ShareCoins, that it gave you. Nothing else on your account has changed.\n\nTo earn them back, verify your identity again: open the ShareSwap app, or go to ${verifyUrl}. Before the check starts you will be asked to agree to how your ID and face data are handled.\n\nBest,\nThe ShareSwap Team`,
      html: emailShell(greeting, lines),
    });
    console.log('[Mail] Verification reset email sent');
    return true;
  } catch (error) {
    console.error('[Mail] Error sending verification reset email:', error);
    return false;
  }
}

// Tells the moderation inbox that a report is waiting in the queue. Carries the reason and a short excerpt, never the
// reporter's identity.
export async function sendModerationAlertEmail(
  toEmail: string,
  report: { id: number; targetType: string; reason: string; details?: string | null },
  openReports?: number,
) {
  try {
    const { client, fromEmail } = await getMailClient();
    const baseUrl = process.env.NODE_ENV === 'production' && process.env.CUSTOM_DOMAIN
      ? `https://${process.env.CUSTOM_DOMAIN}`
      : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.CUSTOM_DOMAIN
      ? `https://${process.env.CUSTOM_DOMAIN}`
      : 'http://localhost:5000';
    const excerpt = report.details ? report.details.slice(0, 200) : null;
    const lines = [
      `A ${report.targetType} was reported as ${report.reason}.`,
      ...(excerpt ? [`Reporter's note: ${excerpt}`] : []),
      ...(openReports && openReports > 1 ? [`${openReports} reports are open in the queue in all. Alerts are limited, so only the first report in a while gets its own email.`] : []),
      `Review it in the queue: ${baseUrl}/admin/reports`,
      `Reports should be acted on within 24 hours.`,
    ];
    await client.send({
      to: toEmail,
      from: fromEmail,
      subject: `ShareSwap report #${report.id}: ${report.targetType} (${report.reason})`,
      text: lines.join('\n\n'),
      html: emailShell('Moderation report', lines),
    });
    console.log('[Mail] Moderation alert sent');
    return true;
  } catch (error) {
    console.error('[Mail] Error sending moderation alert:', error);
    return false;
  }
}

// Tells the moderation/admin inbox that an account's deletion was recorded but is blocked, and by what. Carries the user
// id and the blockers, never a name or address.
export async function sendDeletionBlockedAlertEmail(
  toEmail: string,
  alert: { userId: number; cause: string; blockers: { code: string; message: string; count?: number; amount?: string }[] },
) {
  try {
    const { client, fromEmail } = await getMailClient();
    const lines = [
      'The deletion of user #' + alert.userId + ' was recorded (' + alert.cause + ') but cannot finish yet.',
      'Blocking it:',
      ...alert.blockers.map((b) => '- ' + b.code + (b.count ? ' x' + b.count : '') + (b.amount ? ' ($' + b.amount + ')' : '') + ': ' + b.message),
      'The person may not be able to sign in to deal with this. The daily deletion job retries and completes the deletion once these clear; someone may need to resolve them.',
    ];
    await client.send({
      to: toEmail,
      from: fromEmail,
      subject: 'ShareSwap: deletion of user #' + alert.userId + ' is blocked',
      text: lines.join('\n\n'),
      html: emailShell('Account deletion blocked', lines),
    });
    console.log('[Mail] Deletion-blocked alert sent');
    return true;
  } catch (error) {
    console.error('[Mail] Error sending deletion-blocked alert:', error);
    return false;
  }
}

// SendGrid email utility - using Replit SendGrid integration
import sgMail from '@sendgrid/mail';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );
  
  const data = await response.json();
  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings?.api_key || !connectionSettings.settings?.from_email)) {
    throw new Error('SendGrid not connected - missing api_key or from_email');
  }
  
  return { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
}

// WARNING: Never cache this client - access tokens expire
export async function getUncachableSendGridClient() {
  const { apiKey, email } = await getCredentials();
  sgMail.setApiKey(apiKey);
  return {
    client: sgMail,
    fromEmail: email
  };
}

// Send email verification link
export async function sendVerificationEmail(toEmail: string, verificationToken: string, displayName?: string) {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    
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
    console.log(`[SendGrid] Verification email sent to ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[SendGrid] Error sending verification email:', error);
    return false;
  }
}

// Send email-change verification link to the NEW address
export async function sendEmailChangeVerificationEmail(toEmail: string, verificationToken: string, displayName?: string) {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();

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
    console.log(`[SendGrid] Email-change verification email sent to ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[SendGrid] Error sending email-change verification email:', error);
    return false;
  }
}

// Send security alert to the OLD email when user requests an email change
export async function sendEmailChangeAlertEmail(toEmail: string, newEmail: string, displayName?: string) {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();

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
    console.log(`[SendGrid] Email-change alert sent to old address ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[SendGrid] Error sending email-change alert email:', error);
    return false;
  }
}

// Send password reset link
export async function sendPasswordResetEmail(toEmail: string, resetToken: string, displayName?: string) {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();

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
    console.log(`[SendGrid] Password reset email sent to ${toEmail}`);
    return true;
  } catch (error) {
    console.error('[SendGrid] Error sending password reset email:', error);
    return false;
  }
}

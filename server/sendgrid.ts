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
    
    // Get the base URL for the verification link
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.REPL_SLUG 
      ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
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

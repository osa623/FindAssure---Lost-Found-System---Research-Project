const HEADING_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const BODY_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export interface AccountSuspendedEmailTemplateData {
  userName: string;
  suspensionReason: string;
  xaiReason?: string | null;
  suspendedUntil?: Date | null;
  supportEmail?: string | null;
  logoCid?: string | null;
}

interface EmailTemplateResult {
  subject: string;
  text: string;
  html: string;
}

export const renderAccountSuspendedEmail = (
  data: AccountSuspendedEmailTemplateData
): EmailTemplateResult => {
  const userName = data.userName.trim() || 'User';
  const suspensionReason = data.suspensionReason.trim() || 'Your account was suspended by an administrator.';
  const xaiReason = data.xaiReason?.trim() || '';
  const supportEmail = data.supportEmail?.trim() || '';
  const logoCid = data.logoCid?.trim() || '';
  const suspendedUntilText = data.suspendedUntil
    ? formatDateTime(data.suspendedUntil)
    : 'Until further notice';

  const subject = 'Your FindAssure account has been suspended';

  const textLines = [
    `Hello ${userName},`,
    '',
    'Your FindAssure account has been suspended.',
    '',
    `Suspension period: ${suspendedUntilText}`,
    `Admin reason: ${suspensionReason}`,
    xaiReason ? `Behavior analysis reason: ${xaiReason}` : '',
    '',
    supportEmail
      ? `If you need more details, please contact us at ${supportEmail}.`
      : 'If you need more details, please contact the FindAssure support team.',
    'You can also reply to this email for more information.',
    '',
    'FindAssure',
  ].filter(Boolean);

  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #eef3fb;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #eef3fb;">
      <tr>
        <td align="center" style="padding: 24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px;">
            <tr>
              <td style="padding-bottom: 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; border-spacing: 0; background-color: #b91c1c; border-radius: 28px; overflow: hidden;">
                  <tr>
                    <td style="padding: 28px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 14px;">
                        <tr>
                          ${
                            logoCid
                              ? `
                          <td style="padding: 0 12px 0 0; vertical-align: middle;">
                            <img
                              src="cid:${escapeHtml(logoCid)}"
                              alt="FindAssure logo"
                              width="44"
                              height="44"
                              style="display: block; width: 44px; height: 44px; border: 0;"
                            />
                          </td>
                          `
                              : ''
                          }
                          <td style="vertical-align: middle;">
                            <div style="font-family: ${BODY_STACK}; font-size: 11px; line-height: 14px; letter-spacing: 1.2px; text-transform: uppercase; color: rgba(255,255,255,0.82); font-weight: 700;">
                              FindAssure
                            </div>
                          </td>
                        </tr>
                      </table>
                      <div style="font-family: ${BODY_STACK}; font-size: 12px; line-height: 16px; color: #ffffff; margin-bottom: 14px;">
                        <span style="display: inline-block; padding: 6px 10px; border-radius: 999px; background-color: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.2); font-weight: 700;">
                          Account suspended
                        </span>
                      </div>
                      <div style="font-family: ${HEADING_STACK}; font-size: 30px; line-height: 36px; color: #ffffff; font-weight: 800; letter-spacing: -0.6px; margin-bottom: 12px;">
                        Your account is currently suspended.
                      </div>
                      <div style="font-family: ${BODY_STACK}; font-size: 16px; line-height: 24px; color: rgba(255,255,255,0.88); max-width: 470px;">
                        Hello ${escapeHtml(userName)}, your FindAssure account has been suspended by an administrator.
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding: 0 0 16px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; border-spacing: 0; background-color: #ffffff; border: 1px solid #dce7fb; border-radius: 22px;">
                  <tr>
                    <td style="padding: 22px 24px;">
                      <div style="font-family: ${BODY_STACK}; font-size: 11px; line-height: 14px; letter-spacing: 1.1px; text-transform: uppercase; color: #5d6b82; font-weight: 700; margin-bottom: 12px;">
                        Suspension details
                      </div>
                      <div style="font-family: ${BODY_STACK}; font-size: 15px; line-height: 24px; color: #0f172a;">
                        <strong>Suspension period:</strong> ${escapeHtml(suspendedUntilText)}<br />
                        <strong>Admin reason:</strong> ${escapeHtml(suspensionReason)}
                        ${
                          xaiReason
                            ? `<br /><strong>Behavior analysis reason:</strong> ${escapeHtml(xaiReason)}`
                            : ''
                        }
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding: 0 0 8px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; border-spacing: 0; background-color: #f8fbff; border: 1px solid #dce7fb; border-radius: 18px;">
                  <tr>
                    <td style="padding: 18px 20px; font-family: ${BODY_STACK}; font-size: 14px; line-height: 22px; color: #5d6b82;">
                      ${
                        supportEmail
                          ? `If you need more details, please contact us at <a href="mailto:${escapeHtml(supportEmail)}" style="color: #0b3f96; font-weight: 700; text-decoration: none;">${escapeHtml(supportEmail)}</a>.`
                          : 'If you need more details, please contact the FindAssure support team.'
                      }
                      <br />
                      You can also reply to this email for more information.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  return {
    subject,
    text: textLines.join('\n'),
    html,
  };
};

const formatDateTime = (value: Date): string => {
  try {
    return value.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value.toISOString();
  }
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const HEADING_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const BODY_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export interface FounderVerificationPassedEmailTemplateData {
  founderName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string | null;
  itemCategory: string;
  itemDescription: string;
  itemImageUrl?: string | null;
  logoCid?: string | null;
}

interface EmailTemplateResult {
  subject: string;
  preheader: string;
  text: string;
  html: string;
}

export const renderFounderVerificationPassedEmail = (
  data: FounderVerificationPassedEmailTemplateData
): EmailTemplateResult => {
  const founderName = data.founderName.trim() || 'Founder';
  const ownerName = data.ownerName.trim() || 'Verified owner';
  const ownerEmail = data.ownerEmail.trim();
  const ownerPhone = data.ownerPhone?.trim() || '';
  const itemCategory = data.itemCategory.trim() || 'reported item';
  const itemDescription = data.itemDescription.trim() || 'No description provided';
  const imageUrl = toEmailSafeCloudinaryUrl(data.itemImageUrl);
  const logoCid = data.logoCid?.trim() || '';

  const subject = `Verified owner found for your ${itemCategory} report`;
  const preheader = 'Owner details are ready so you can coordinate the handoff.';
  const ownerEmailHref = createMailtoUrl(ownerEmail, itemCategory);
  const ownerPhoneHref = ownerPhone ? `tel:${sanitizePhoneForTel(ownerPhone)}` : '';

  const textLines = [
    `Hello ${founderName},`,
    '',
    'A verified owner has been confirmed for the item you reported in FindAssure.',
    '',
    'ITEM SUMMARY',
    `Category: ${itemCategory}`,
    `Description: ${itemDescription}`,
    '',
    'OWNER DETAILS',
    `Name: ${ownerName}`,
    `Email: ${ownerEmail}`,
    `Phone: ${ownerPhone || 'Not provided'}`,
    '',
    'NEXT STEP',
    'You can now contact the owner directly and coordinate a safe handoff.',
    ownerEmail ? `Email owner: ${ownerEmailHref}` : '',
    ownerPhoneHref ? `Call owner: ${ownerPhoneHref}` : '',
    '',
    'Keep the handoff focused on the verified item details and share only what is needed to complete retrieval.',
    '',
    'FindAssure',
  ].filter(Boolean);

  const imageBlock = imageUrl
    ? `
      <tr>
        <td style="padding: 0 24px 20px 24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; border-spacing: 0; background-color: #ffffff; border: 1px solid #dce7fb; border-radius: 22px;">
            <tr>
              <td style="padding: 18px 18px 8px 18px;">
                <div style="font-family: ${BODY_STACK}; font-size: 11px; line-height: 14px; letter-spacing: 1.1px; text-transform: uppercase; color: #5d6b82; font-weight: 700;">Item preview</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 18px 18px 18px;">
                <img
                  src="${escapeHtml(imageUrl)}"
                  alt="Preview of the reported item"
                  width="516"
                  style="display: block; width: 100%; max-width: 516px; height: auto; border: 0; border-radius: 18px; background-color: #edf4ff;"
                />
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `
    : '';

  const phoneRow = ownerPhone
    ? `
      <tr>
        <td style="padding: 0 0 12px 0; font-family: ${BODY_STACK}; font-size: 15px; line-height: 22px; color: #5d6b82;">
          <span style="display: inline-block; width: 86px; color: #0f172a; font-weight: 700;">Phone</span>
          <span>${escapeHtml(ownerPhone)}</span>
        </td>
      </tr>
    `
    : '';

  const callButton = ownerPhoneHref
    ? `
      <td style="padding: 0 12px 0 0;">
        <a
          href="${escapeHtml(ownerPhoneHref)}"
          style="display: inline-block; padding: 13px 18px; border-radius: 999px; background-color: #eff6ff; border: 1px solid #bfdbfe; font-family: ${BODY_STACK}; font-size: 14px; line-height: 18px; color: #0b3f96; font-weight: 700; text-decoration: none;"
        >
          Call owner
        </a>
      </td>
    `
    : '';

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
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #eef3fb;">
      <tr>
        <td align="center" style="padding: 24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px;">
            <tr>
              <td style="padding-bottom: 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; border-spacing: 0; background-color: #3b82f6; border-radius: 28px; overflow: hidden;">
                  <tr>
                    <td style="padding: 28px 28px 26px 28px;">
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
                          Verified owner ready
                        </span>
                      </div>
                      <div style="font-family: ${HEADING_STACK}; font-size: 30px; line-height: 36px; color: #ffffff; font-weight: 800; letter-spacing: -0.6px; margin-bottom: 12px;">
                        Verified owner found for your item.
                      </div>
                      <div style="font-family: ${BODY_STACK}; font-size: 16px; line-height: 24px; color: rgba(255,255,255,0.88); max-width: 470px;">
                        Owner details are ready so you can coordinate a safe handoff for the reported item.
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
                        Item summary
                      </div>
                      <div style="font-family: ${HEADING_STACK}; font-size: 24px; line-height: 30px; color: #0f172a; font-weight: 800; letter-spacing: -0.4px; margin-bottom: 12px;">
                        ${escapeHtml(itemCategory)}
                      </div>
                      <div style="font-family: ${BODY_STACK}; font-size: 15px; line-height: 23px; color: #5d6b82;">
                        ${escapeHtml(itemDescription)}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${imageBlock}

            <tr>
              <td style="padding: 0 0 16px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; border-spacing: 0; background-color: #ffffff; border: 1px solid #dce7fb; border-radius: 22px;">
                  <tr>
                    <td style="padding: 22px 24px 12px 24px;">
                      <div style="font-family: ${BODY_STACK}; font-size: 11px; line-height: 14px; letter-spacing: 1.1px; text-transform: uppercase; color: #5d6b82; font-weight: 700; margin-bottom: 12px;">
                        Owner details
                      </div>
                      <div style="font-family: ${HEADING_STACK}; font-size: 24px; line-height: 30px; color: #0f172a; font-weight: 800; letter-spacing: -0.4px; margin-bottom: 16px;">
                        ${escapeHtml(ownerName)}
                      </div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding: 0 0 12px 0; font-family: ${BODY_STACK}; font-size: 15px; line-height: 22px; color: #5d6b82;">
                            <span style="display: inline-block; width: 86px; color: #0f172a; font-weight: 700;">Email</span>
                            <span>${escapeHtml(ownerEmail)}</span>
                          </td>
                        </tr>
                        ${phoneRow}
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 24px 24px 24px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding: 0 12px 0 0;">
                            <a
                              href="${escapeHtml(ownerEmailHref)}"
                              style="display: inline-block; padding: 13px 18px; border-radius: 999px; background-color: #0f172a; font-family: ${BODY_STACK}; font-size: 14px; line-height: 18px; color: #ffffff; font-weight: 700; text-decoration: none;"
                            >
                              Email owner
                            </a>
                          </td>
                          ${callButton}
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding: 0 0 8px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; border-spacing: 0; background-color: #f8fbff; border: 1px solid #dce7fb; border-radius: 18px;">
                  <tr>
                    <td style="padding: 18px 20px;">
                      <div style="font-family: ${BODY_STACK}; font-size: 14px; line-height: 22px; color: #5d6b82;">
                        Hello ${escapeHtml(founderName)}, keep the handoff focused on the verified item details and share only what is needed to complete retrieval.
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 8px 0 8px; font-family: ${BODY_STACK}; font-size: 12px; line-height: 18px; color: #7b8798; text-align: center;">
                FindAssure
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
    preheader,
    text: textLines.join('\n'),
    html,
  };
};

const toEmailSafeCloudinaryUrl = (value?: string | null): string | null => {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  if (!/res\.cloudinary\.com/i.test(raw) || !/\/image\/upload\//i.test(raw)) {
    return raw;
  }

  if (/\/image\/upload\/(?:[^/]+,)*f_[a-z0-9]+/i.test(raw)) {
    return raw;
  }

  return raw.replace('/image/upload/', '/image/upload/f_jpg,q_auto/');
};

const createMailtoUrl = (ownerEmail: string, itemCategory: string): string => {
  const subject = `FindAssure handoff for your ${itemCategory}`;
  const body = [
    'Hello,',
    '',
    `I received your verified ownership notice for the ${itemCategory} reported in FindAssure.`,
    'I am reaching out to coordinate the handoff.',
    '',
    'Thank you,',
  ].join('\n');

  return `mailto:${encodeURIComponent(ownerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

const sanitizePhoneForTel = (value: string): string => value.replace(/[^\d+]/g, '');

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

import nodemailer, { Transporter } from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { renderFounderVerificationPassedEmail } from './emailTemplates/founderVerificationPassedEmail';
import { renderAccountSuspendedEmail } from './emailTemplates/accountSuspendedEmail';

let transporter: Transporter | null = null;
const FOUNDER_EMAIL_LOGO_CID = 'findassure-logo';

const getMailConfig = () => {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const from = (process.env.MAIL_FROM || process.env.SMTP_FROM || user).trim();
  const secure = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true' || port === 465;

  return {
    host,
    port,
    user,
    pass,
    from,
    secure,
  };
};

export const isEmailConfigured = () => {
  const cfg = getMailConfig();
  return Boolean(cfg.host && cfg.port && cfg.user && cfg.pass && cfg.from);
};

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  const cfg = getMailConfig();
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  return transporter;
};

interface FounderVerificationPassedEmailData {
  founderName: string;
  founderEmail: string;
  ownerName?: string | null;
  ownerEmail: string;
  ownerPhone?: string | null;
  itemCategory: string;
  itemDescription: string;
  itemImageUrl?: string | null;
}

interface AccountSuspendedEmailData {
  userName: string;
  userEmail: string;
  suspensionReason: string;
  xaiReason?: string | null;
  suspendedUntil?: Date | null;
}

interface ManualVerificationReviewEmailData {
  adminEmail: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  ownerId: string;
  itemId: string;
  itemCategory: string;
  itemDescription: string;
  founderName?: string | null;
  founderEmail?: string | null;
  founderPhone?: string | null;
  foundLocations: string[];
  ownerReason: string;
  ownerLostDescription?: string | null;
}

export const sendFounderVerificationPassedEmail = async (
  data: FounderVerificationPassedEmailData
): Promise<boolean> => {
  if (!isEmailConfigured()) {
    console.warn('Founder notification email skipped: SMTP is not configured.');
    return false;
  }

  const cfg = getMailConfig();
  const ownerName = data.ownerName?.trim() || 'A verified owner';
  const founderName = data.founderName?.trim() || 'Founder';
  const logoPath = resolveFounderEmailLogoPath();
  const rendered = renderFounderVerificationPassedEmail({
    founderName,
    ownerName,
    ownerEmail: data.ownerEmail,
    ownerPhone: data.ownerPhone,
    itemCategory: data.itemCategory,
    itemDescription: data.itemDescription,
    itemImageUrl: data.itemImageUrl,
    logoCid: logoPath ? FOUNDER_EMAIL_LOGO_CID : null,
  });

  await getTransporter().sendMail({
    from: cfg.from,
    to: data.founderEmail,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    attachments: logoPath
      ? [
          {
            filename: 'findassure-logo.png',
            path: logoPath,
            cid: FOUNDER_EMAIL_LOGO_CID,
            contentType: 'image/png',
          },
        ]
      : undefined,
  });

  return true;
};

export const sendAccountSuspendedEmail = async (
  data: AccountSuspendedEmailData
): Promise<boolean> => {
  if (!isEmailConfigured()) {
    console.warn('Account suspension email skipped: SMTP is not configured.');
    return false;
  }

  const cfg = getMailConfig();
  const logoPath = resolveFounderEmailLogoPath();
  const supportEmail = (
    process.env.SUPPORT_EMAIL ||
    process.env.CONTACT_EMAIL ||
    cfg.from
  ).trim();
  const rendered = renderAccountSuspendedEmail({
    userName: data.userName?.trim() || 'User',
    suspensionReason: data.suspensionReason,
    xaiReason: data.xaiReason,
    suspendedUntil: data.suspendedUntil || null,
    supportEmail,
    logoCid: logoPath ? FOUNDER_EMAIL_LOGO_CID : null,
  });

  await getTransporter().sendMail({
    from: cfg.from,
    to: data.userEmail,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    attachments: logoPath
      ? [
          {
            filename: 'findassure-logo.png',
            path: logoPath,
            cid: FOUNDER_EMAIL_LOGO_CID,
            contentType: 'image/png',
          },
        ]
      : undefined,
  });

  return true;
};

export const sendManualVerificationReviewEmail = async (
  data: ManualVerificationReviewEmailData
): Promise<boolean> => {
  if (!isEmailConfigured()) {
    console.warn('Manual verification review email skipped: SMTP is not configured.');
    return false;
  }

  const cfg = getMailConfig();
  const ownerName = data.ownerName?.trim() || 'Unknown owner';
  const ownerEmail = data.ownerEmail?.trim() || 'Not provided';
  const ownerPhone = data.ownerPhone?.trim() || 'Not provided';
  const founderName = data.founderName?.trim() || 'Unknown founder';
  const founderEmail = data.founderEmail?.trim() || 'Not provided';
  const founderPhone = data.founderPhone?.trim() || 'Not provided';
  const foundLocations = data.foundLocations.length > 0
    ? data.foundLocations.join('\n')
    : 'Not provided';

  const subject = `Manual ownership review request - ${data.itemCategory} (${data.itemId})`;
  const text = [
    'A user requested manual ownership review.',
    '',
    'Owner details:',
    `Name: ${ownerName}`,
    `Email: ${ownerEmail}`,
    `Phone: ${ownerPhone}`,
    `Owner ID: ${data.ownerId}`,
    '',
    'Item details:',
    `Item ID: ${data.itemId}`,
    `Category: ${data.itemCategory}`,
    `Description: ${data.itemDescription}`,
    '',
    'Founder details:',
    `Name: ${founderName}`,
    `Email: ${founderEmail}`,
    `Phone: ${founderPhone}`,
    '',
    'Found locations:',
    foundLocations,
    '',
    'Owner lost-item description:',
    data.ownerLostDescription?.trim() || 'Not provided',
    '',
    'Owner reason for manual review:',
    data.ownerReason.trim(),
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2 style="margin-bottom: 8px;">Manual ownership review request</h2>
      <p style="margin-top: 0;">A user requested admin help because they could not complete the normal video-answer verification.</p>
      <h3>Owner details</h3>
      <p>
        <strong>Name:</strong> ${ownerName}<br />
        <strong>Email:</strong> ${ownerEmail}<br />
        <strong>Phone:</strong> ${ownerPhone}<br />
        <strong>Owner ID:</strong> ${data.ownerId}
      </p>
      <h3>Item details</h3>
      <p>
        <strong>Item ID:</strong> ${data.itemId}<br />
        <strong>Category:</strong> ${data.itemCategory}<br />
        <strong>Description:</strong> ${data.itemDescription}
      </p>
      <h3>Founder details</h3>
      <p>
        <strong>Name:</strong> ${founderName}<br />
        <strong>Email:</strong> ${founderEmail}<br />
        <strong>Phone:</strong> ${founderPhone}
      </p>
      <h3>Found locations</h3>
      <p>${foundLocations.replace(/\n/g, '<br />')}</p>
      <h3>Owner lost-item description</h3>
      <p>${(data.ownerLostDescription?.trim() || 'Not provided').replace(/\n/g, '<br />')}</p>
      <h3>Owner reason for manual review</h3>
      <p>${data.ownerReason.trim().replace(/\n/g, '<br />')}</p>
    </div>
  `;

  await getTransporter().sendMail({
    from: cfg.from,
    to: data.adminEmail,
    subject,
    text,
    html,
  });

  return true;
};

const resolveFounderEmailLogoPath = (): string | null => {
  const candidate = path.resolve(__dirname, '../../../FindAssure/assets/images/logo.png');
  return fs.existsSync(candidate) ? candidate : null;
};

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

const resolveFounderEmailLogoPath = (): string | null => {
  const candidate = path.resolve(__dirname, '../../../FindAssure/assets/images/logo.png');
  return fs.existsSync(candidate) ? candidate : null;
};

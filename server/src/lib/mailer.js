// Email transport.  When SMTP_URL + MAIL_FROM are set and the "nodemailer"
// package is installed, messages are delivered for real.  Otherwise every send
// is logged to stdout so the daily-digest and e-receipt flows remain observable
// end-to-end without requiring an SMTP server.
import { logger } from './logger.js';

let _transport = null;
let _checked = false;

async function getTransport() {
  if (_checked) return _transport;
  _checked = true;
  if (!mailerConfigured()) return null;
  try {
    // Dynamic import — nodemailer is an optional peer dependency.
    // eslint-disable-next-line no-undef
    const nm = await import('nodemailer');
    _transport = nm.default.createTransport(process.env.SMTP_URL);
    logger.info('[mailer] SMTP transport ready');
  } catch (err) {
    logger.warn(`[mailer] nodemailer not installed or SMTP_URL invalid: ${err.message}`);
  }
  return _transport;
}

export function mailerConfigured() {
  return Boolean(process.env.SMTP_URL && process.env.MAIL_FROM);
}

export async function sendMail({ to, subject, text, html }) {
  const transport = await getTransport();
  if (!transport) {
    logger.info(`[mailer:dry-run] to=${to} subject="${subject}"\n${text}`);
    return { sent: false };
  }
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text,
      html: html ?? text,
    });
    logger.info(`[mailer] sent to=${to} subject="${subject}"`);
    return { sent: true };
  } catch (err) {
    logger.error(`[mailer] failed to=${to}: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

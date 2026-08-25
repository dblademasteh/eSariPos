// Email stub. A real deployment plugs nodemailer (or an HTTP mail API such as
// Resend/Postmark) in here. Without SMTP_URL configured we log the payload so
// the scheduled digests remain observable end-to-end.
export function mailerConfigured() {
  return Boolean(process.env.SMTP_URL && process.env.MAIL_FROM);
}

export async function sendMail({ to, subject, text }) {
  if (!mailerConfigured()) {
    console.log(`[mailer:dry-run] to=${to} subject="${subject}"\n${text}`);
    return { sent: false };
  }
  console.log(`[mailer:no-transport] would send to=${to} subject="${subject}"`);
  return { sent: false };
}

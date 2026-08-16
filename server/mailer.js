import nodemailer from 'nodemailer';

// Auth's email features (optional-email registration's password reset, see
// auth.js) are optional on top of optional infrastructure - same posture as
// db.js: a missing/misconfigured SMTP setup must never crash the server or
// break any route, it should just mean those specific emails silently don't
// go out (logged server-side) while everything else keeps working.
let transporter = null;

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}

function getTransporter() {
  if (!isConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465,
      // Defaults to true (implicit TLS on 465, this deployment's port) unless
      // explicitly set to "false" - mirrors the SMTP_SECURE=ssl value this
      // app's .env actually ships, which is truthy under any string check
      // other than a literal "false".
      secure: process.env.SMTP_SECURE !== 'false',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // This deployment's mail host (smtp.sidowski.de, a shared-hosting
      // "KAS"/All-Inkl-style setup) serves a legitimately CA-issued cert,
      // but for the hosting platform's own domain (*.kasserver.com) rather
      // than the customer's vanity SMTP_HOST - confirmed by hand (a plain
      // connection fails Node's hostname-vs-SAN check with exactly that
      // mismatch, chain and expiry otherwise fine). Overriding just
      // checkServerIdentity skips the hostname-naming check while chain/
      // expiry validation (rejectUnauthorized's default of true) still
      // applies - narrower than disabling certificate validation outright,
      // and the only way this actually-legitimate host ever completes a
      // handshake at all with the hostname the site owner gave us.
      tls: { checkServerIdentity: () => undefined },
    });
  }
  return transporter;
}

// Never throws - a broken/unreachable SMTP server must not take down
// whatever request triggered the send (registration, forgot-password, ...).
// Callers that need to tell the difference check the returned boolean; most
// don't, since e.g. forgot-password must answer identically either way to
// avoid leaking whether an address is registered.
export async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.error('sendMail: SMTP not configured, skipping send to', to);
    return false;
  }
  try {
    await t.sendMail({
      from: `"${process.env.SMTP_NAME || 'Deathstep'}" <${process.env.SMTP_FROM}>`,
      to,
      subject,
      html,
      text,
    });
    return true;
  } catch (err) {
    console.error('sendMail failed:', err.message);
    return false;
  }
}

export { isConfigured as isMailConfigured };

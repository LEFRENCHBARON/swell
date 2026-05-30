// What this module owns: transactional email sending via Resend.
// Does NOT own email templates, campaign logic, or subscriber management.
const { Resend } = require('resend');

// Lazy init — Resend throws synchronously if key is undefined, blocking app.listen
let _resend;
function getResend() { return _resend || (_resend = new Resend(process.env.RESEND_API_KEY)); }

async function sendTransactionalEmail({ to, subject, htmlBody, textBody, tag, replyTo }) {
  const { data, error } = await getResend().emails.send({
    from: process.env.EMAIL_FROM || 'Swell <noreply@swell.fr>',
    to,
    subject,
    html: htmlBody,
    text: textBody || '',
    reply_to: replyTo || 'contact@swell.fr',
    tags: tag ? [{ name: 'category', value: tag }] : undefined,
  });

  if (error) {
    throw new Error(`Email send failed: ${JSON.stringify(error)}`);
  }

  return data;
}

module.exports = { sendTransactionalEmail };

// email.service.js - Envio de correos (Brevo API + SMTP como respaldo)

const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

async function sendBrevoAPI(recipientEmail, temporalPassword, attempt = 1, maxAttempts = 3) {
  try {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      throw new Error('BREVO_API_KEY no configurada');
    }

    const emailData = {
      sender: {
        name: 'Sistema AcademicoDB',
        email: process.env.BREVO_SENDER || 'no-reply@example.com'
      },
      to: [{ email: recipientEmail, name: 'Usuario' }],
      subject: 'Tu contrasena temporal - AcademicoDB',
      htmlContent: createEmailTemplate(temporalPassword)
    };

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(emailData),
      timeout: 8000
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`API Error ${response.status}: ${error.message || response.statusText || 'unknown'}`);
    }

    const result = await response.json().catch(() => ({}));
    return { success: true, messageId: result.messageId, method: 'brevo-api', attempt };
  } catch (error) {
    if ((error.code === 'ECONNRESET' || (error.message || '').includes('ECONNRESET')) && attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
      return sendBrevoAPI(recipientEmail, temporalPassword, attempt + 1, maxAttempts);
    }
    return { success: false, error: error.message, attempts: attempt };
  }
}

async function sendBrevoSMTP(recipientEmail, temporalPassword) {
  try {
    const user = process.env.BREVO_USER;
    const pass = process.env.BREVO_PASS;
    if (!user || !pass) throw new Error('BREVO_USER/BREVO_PASS no configurados');

    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.sendinblue.com',
      port: 587,
      secure: false,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });

    const info = await transporter.sendMail({
      from: process.env.BREVO_FROM || 'AcademicoDB <no-reply@example.com>',
      to: recipientEmail,
      subject: 'Tu contrasena temporal - AcademicoDB',
      html: createEmailTemplate(temporalPassword)
    });
    return { success: true, messageId: info.messageId, method: 'brevo-smtp' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function createEmailTemplate(temporalPassword) {
  return `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">
      <div style="background:#4CAF50;color:#fff;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;">Contrasena Temporal</h1>
        <p style="margin:5px 0 0 0;opacity:.9;">Sistema AcademicoDB</p>
      </div>
      <div style="padding:30px;background:#f9f9f9;border-radius:0 0 8px 8px;">
        <p style="font-size:16px;color:#333;">Hola,</p>
        <p style="font-size:16px;color:#333;">Has solicitado una nueva contrasena temporal para tu cuenta en AcademicoDB.</p>
        <div style="background:#fff;padding:25px;border-radius:8px;text-align:center;margin:25px 0;border-left:4px solid #4CAF50;">
          <p style="margin:0 0 10px 0;color:#555;font-size:14px;"><strong>Tu contrasena temporal es:</strong></p>
          <div style="font-family:'Courier New',monospace;font-size:28px;font-weight:bold;color:#4CAF50;background:#f8f9fa;padding:15px;border-radius:5px;letter-spacing:2px;">${temporalPassword}</div>
        </div>
        <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:15px;margin:20px 0;border-radius:4px;">
          <p style="margin:0;color:#856404;font-size:14px;"><strong>Informacion importante:</strong></p>
          <ul style="margin:10px 0 0 0;color:#856404;font-size:14px;">
            <li>Esta contrasena expira en <strong>24 horas</strong></li>
            <li>Al iniciar sesion, seras redirigido automaticamente para crear una nueva contrasena</li>
            <li>No compartas esta informacion con nadie</li>
          </ul>
        </div>
        <div style="text-align:center;margin:30px 0;">
          <a href="http://localhost:3000" style="display:inline-block;background:#4CAF50;color:#fff;padding:14px 30px;text-decoration:none;border-radius:25px;font-weight:bold;font-size:16px;box-shadow:0 2px 4px rgba(0,0,0,0.2);">Iniciar Sesion Ahora</a>
        </div>
        <hr style="border:none;border-top:1px solid #ddd;margin:25px 0;" />
        <p style="color:#666;font-size:12px;text-align:center;margin:0;">Este correo se genero automaticamente desde el Sistema AcademicoDB.<br/>Si no solicitaste esta recuperacion, puedes ignorar este mensaje.</p>
      </div>
    </div>`;
}

async function sendBrevoEmail(recipientEmail, temporalPassword) {
  // Intenta API primero; si falla, intenta SMTP
  const apiResult = await sendBrevoAPI(recipientEmail, temporalPassword);
  if (apiResult.success) return apiResult;
  const smtpResult = await sendBrevoSMTP(recipientEmail, temporalPassword);
  if (smtpResult.success) return smtpResult;
  return { success: false, error: `API fallo: ${apiResult.error}. SMTP fallo: ${smtpResult.error}` };
}

module.exports = { sendBrevoEmail };


// middlewares/recaptcha.js
async function verifyRecaptcha(req, res, next) {
  try {
    const token = req.body && req.body.captchaToken;
    if (!token) {
      return res.status(400).json({ success: false, message: 'CAPTCHA es requerido' });
    }

    const params = new URLSearchParams();
    params.append('secret', process.env.RECAPTCHA_SECRET_KEY);
    params.append('response', token);

    // Para desarrollo local, no validar IP
    if (req.ip && req.ip !== '::1' && req.ip !== '127.0.0.1') {
      params.append('remoteip', req.ip);
    }

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    const result = await response.json();

    if (!result.success) {
      return res.status(403).json({
        success: false,
        message: 'CAPTCHA invalido. Por favor, intentalo de nuevo.',
        errors: result['error-codes']
      });
    }

    // Verificar si estamos usando claves de prueba
    const isTestKey = process.env.RECAPTCHA_SECRET_KEY === '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';

    // En produccion, validar hostname basico (salvo claves de prueba)
    if (process.env.NODE_ENV === 'production' && !isTestKey) {
      const allowedHosts = ['localhost', '127.0.0.1', 'tu-dominio.com'];
      if (result.hostname && !allowedHosts.includes(result.hostname)) {
        return res.status(403).json({ success: false, message: 'Origen no permitido', hostname: result.hostname });
      }
    }

    return next();
  } catch (error) {
    console.error('Error verificando CAPTCHA:', error);
    return res.status(500).json({ success: false, message: 'Error interno validando CAPTCHA' });
  }
}

module.exports = { verifyRecaptcha };

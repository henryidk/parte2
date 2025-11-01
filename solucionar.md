# Solución propuesta: pantalla de dashboard "desconocida" (Reportes / rol genérico)

## Resumen del problema

- Al abrir `dashboard.html` directamente (sin pasar por el login) el frontend carga una vista genérica (sección Reportes) y muestra un rol genérico (p. ej. "Usuario"/`secretaria`). Esto puede parecer una página ajena al proyecto, aunque proviene del propio `public/dashboard.html`.

## Causa raíz (frontend)

- Resolución de rol con valores por defecto cuando no existe sesión en `localStorage`:
  - Código: `public/js/dashboard-app.js:418` (`resolveRole()`), si no encuentra `userRole` devuelve `secretaria` por defecto.
- Selección de sección inicial del dashboard basada en preferencia estática cuando no hay `?section=`:
  - Código: `public/js/dashboard-app.js:1106` (lógica de `buildNavigation()`), suele priorizar "reportes" si está disponible.
- Resultado: si se abre `dashboard.html` “en frío” (sin haber iniciado sesión que setea `localStorage.userData`/`userRole`), el UI hidrata datos ficticios y cae en Reportes.

## Cómo reproducir

1) Abrir `public/dashboard.html` directamente en el navegador (sin haber iniciado sesión desde `index.html`).
2) O borrar `localStorage` y recargar `dashboard.html`.
3) Se verá el panel de Reportes con textos genéricos y rol por defecto.

## Solución mínima (recomendada, sin backend)

Implementar un guard de sesión en el dashboard para evitar que cargue sin credenciales:

- En `public/js/dashboard-app.js` (muy al inicio):
  - Verificar `localStorage.userData` y `localStorage.userRole`.
  - Si faltan, redirigir a `index.html`.

Ejemplo (6 líneas):

```
(function ensureDashboardSession() {
  try {
    const hasSession = localStorage.getItem('userData') && localStorage.getItem('userRole');
    if (!hasSession) window.location.href = 'index.html';
  } catch (_) { window.location.href = 'index.html'; }
})();
```

Mejora opcional (UX):
- En `buildNavigation`, cuando no hay `?section=`, preferir `'productos'` como sección inicial (si está disponible) en vez de `'reportes'` para alinear con el flujo real del sistema.

## Alternativa robusta (backend)

Restringir acceso a `dashboard.html` en servidor para que sólo se sirva con sesión válida:

- Requiere una capa de sesión (cookie/JWT). Ejemplos:
  - Servir `dashboard.html` desde un endpoint que verifica sesión y redirige a `/index.html` si no existe.
  - Añadir un middleware de autenticación a rutas API sensibles para evitar uso sin login.

Ventajas: evita estados inconsistentes incluso con accesos directos/URL compartidas.

## Checklist de verificación

- [ ] Abrir `index.html`, iniciar sesión → redirige a `dashboard.html?role=...` y muestra la sección esperada.
- [ ] Abrir `dashboard.html` directo sin sesión → redirige a `index.html` (no más vista genérica).
- [ ] El header muestra el nombre/rol reales (provenientes del login) y no valores por defecto.
- [ ] La URL con `?section=` sigue funcionando (ej.: `?section=productos`).

## Impacto y riesgos

- Solución mínima: sólo afecta el flujo de acceso directo al dashboard. No toca backend ni estructura de datos.
- Solución robusta: implica introducir sesión/estado en servidor; requiere coordinar y testear redirecciones.

---

Si quieres, puedo aplicar únicamente el guard de sesión y la preferencia de sección (cambios muy acotados en `public/js/dashboard-app.js`) y dejar todo lo demás intacto. También puedo preparar una rama separada con la protección desde backend para que la revises antes de integrarla.

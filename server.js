const nodemailer = require('nodemailer');
const crypto = require('crypto'); 
const rateLimit = require('express-rate-limit');
const { verifyRecaptcha } = require('./src/middlewares/recaptcha');

const { sendBrevoEmail } = require('./src/services/email.service');



const express = require('express');
const { getPool, sql, closePool } = require('./src/db/pool');
const path = require('path');
require('dotenv').config();





const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Logger sencillo para diagnosticar rutas (temporal)
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/ventas')) {
    console.log(`[ventas] ${req.method} ${req.url}`);
  }
  next();
});


// Uso de pool compartido vÃ­a getPool()
let pool; // declarado solo para compatibilidad con manejadores antiguos
//LOGIN
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Montar router de productos (modularizado)
try {
  const productosRouter = require('./src/routes/productos.routes');
  app.use('/api/productos', productosRouter);
} catch (e) {
  console.error('No se pudo montar productosRouter:', e && e.message ? e.message : e);
}

// === INVENTARIO ===
// Sugerencias de productos para autocompletar por código o nombre
app.get('/api/productos/suggest', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ success: true, items: [] });
    const pool = await getPool();
    const r = pool.request();
    r.input('q', sql.VarChar(160), `%${q}%`);
    const rows = (await r.query(`
      SELECT TOP 10 IdProducto, Codigo, Nombre, Cantidad
      FROM inv.productos
      WHERE Codigo LIKE @q OR Nombre LIKE @q
      ORDER BY CASE WHEN Codigo LIKE @q THEN 0 ELSE 1 END, Nombre
    `)).recordset;
    return res.json({ success: true, items: rows.map(x => ({ id: x.IdProducto, code: x.Codigo, name: x.Nombre, stock: Number(x.Cantidad) })) });
  } catch (err) {
    console.error('Error en /api/productos/suggest:', err);
    return res.status(500).json({ success: false, message: 'Error obteniendo sugerencias' });
  }
});

// Registrar entrada de inventario (suma stock y registra movimiento)
app.post('/api/inventario/entrada', async (req, res) => {
  try {
    const { producto, cantidad, fechaHora, referencia, usuario } = req.body || {};

    const qty = Number(cantidad);
    if (!producto || !qty || qty <= 0) {
      return res.status(400).json({ success: false, message: 'Producto y cantidad (>0) son requeridos' });
    }

    // Resolver código del producto
    let raw = String(producto || '').trim();
    let code = raw.includes('|') ? raw.split('|')[0].trim() : raw;

    const pool = await getPool();
    // Si el código no es exacto, intentar resolverlo por coincidencia
    if (!code || code.length < 2) {
      const find = await pool.request()
        .input('term', sql.VarChar(150), raw)
        .input('like', sql.VarChar(160), `%${raw}%`)
        .query(`
          SELECT TOP 1 Codigo FROM inv.productos
          WHERE Codigo = @term OR Nombre = @term OR Codigo LIKE @like OR Nombre LIKE @like
          ORDER BY CASE WHEN Codigo=@term THEN 0 WHEN Nombre=@term THEN 1 WHEN Codigo LIKE @like THEN 2 ELSE 3 END
        `);
      if (find.recordset.length) code = find.recordset[0].Codigo;
    } else {
      // Verificar existencia del código; si no existe, intentar por nombre
      const chk = await pool.request().input('code', sql.VarChar(50), code)
        .query('SELECT 1 FROM inv.productos WHERE Codigo=@code');
      if (chk.recordset.length === 0) {
        const find2 = await pool.request()
          .input('term', sql.VarChar(150), raw)
          .input('like', sql.VarChar(160), `%${raw}%`)
          .query(`SELECT TOP 1 Codigo FROM inv.productos WHERE Nombre=@term OR Nombre LIKE @like ORDER BY Nombre`);
        if (find2.recordset.length) code = find2.recordset[0].Codigo;
      }
    }

    if (!code) return res.status(404).json({ success: false, message: 'Producto no encontrado' });

    const when = fechaHora ? new Date(fechaHora) : new Date();
    if (isNaN(when.getTime())) return res.status(400).json({ success: false, message: 'Fecha/hora inválida' });

    const r = pool.request();
    r.input('Codigo', sql.VarChar(50), code);
    r.input('Cantidad', sql.Int, qty);
    r.input('FechaHora', sql.DateTime2, when);
    r.input('Usuario', sql.VarChar(50), (usuario || 'sistema'));
    r.input('Referencia', sql.NVarChar(250), referencia || null);
    r.output('Mensaje', sql.NVarChar(200));
    const result = await r.execute('inv.sp_RegistrarEntradaInventario');

    if (result.returnValue !== 0) {
      return res.status(400).json({ success: false, message: result.output.Mensaje || 'No se pudo registrar la entrada' });
    }

    // Obtener producto actualizado
    const prod = (await pool.request().input('Codigo', sql.VarChar(50), code)
      .query('SELECT TOP 1 IdProducto, Codigo, Nombre, Cantidad FROM inv.productos WHERE Codigo=@Codigo')).recordset[0];

    return res.json({ success: true, message: result.output.Mensaje || 'Entrada registrada', product: {
      id: prod.IdProducto, codigo: prod.Codigo, nombre: prod.Nombre, cantidad: Number(prod.Cantidad)
    }});
  } catch (err) {
    console.error('Error en /api/inventario/entrada:', err);
    return res.status(500).json({ success: false, message: 'Error registrando entrada' });
  }
});

// Listado de movimientos de inventario (bitácora)
app.get('/api/inventario/movimientos', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '10', 10)));
    const offset = (page - 1) * limit;

    const pool = await getPool();
    const total = (await pool.request().query('SELECT COUNT(*) AS total FROM inv.movimientos_inventario')).recordset[0].total;

    const r = pool.request();
    r.input('offset', sql.Int, offset);
    r.input('limit', sql.Int, limit);
    const rows = (await r.query(`
      SELECT m.IdMovimiento, m.FechaHora, m.Usuario, m.Codigo, m.Cantidad, m.Referencia,
             p.Nombre AS NombreProducto
      FROM inv.movimientos_inventario m
      LEFT JOIN inv.productos p ON p.IdProducto = m.IdProducto
      ORDER BY m.FechaHora DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `)).recordset;

    return res.json({
      success: true,
      data: rows.map(x => ({
        id: x.IdMovimiento,
        fechaHora: x.FechaHora,
        usuario: x.Usuario,
        codigo: x.Codigo,
        producto: x.NombreProducto || x.Codigo,
        cantidad: Number(x.Cantidad),
        referencia: x.Referencia || ''
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Error en /api/inventario/movimientos:', err);
    return res.status(500).json({ success: false, message: 'Error obteniendo movimientos de inventario' });
  }
});

// Reporte: Stock crítico (paginado)
app.get('/api/reportes/inventario/critico', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '10', 10)));
    const offset = (page - 1) * limit;
    const categoria = String(req.query.categoria || '').trim();

    const pool = await getPool();
    // Construir filtros dinámicos (opcional por categoría)
    const whereParts = ['Cantidad > 0', 'Cantidad < 25'];
    let filterSqlExists = '';
    if (categoria) {
      if (categoria.toLowerCase() === '__none__' || categoria.toLowerCase() === '__sin__' || categoria.toLowerCase() === 'sin categoría' || categoria.toLowerCase() === 'sin categoria') {
        // Productos sin relación en M:N
        filterSqlExists = ` AND NOT EXISTS (
            SELECT 1 FROM inv.producto_categoria pc WHERE pc.IdProducto = v.IdProducto
        )`;
      } else if (categoria.toLowerCase() !== 'todas') {
        filterSqlExists = ` AND EXISTS (
            SELECT 1
            FROM inv.producto_categoria pc
            JOIN inv.categorias c ON c.IdCategoria = pc.IdCategoria
            WHERE pc.IdProducto = v.IdProducto
              AND LOWER(CONVERT(VARCHAR(100), c.Nombre COLLATE Latin1_General_CI_AI)) = LOWER(CONVERT(VARCHAR(100), @cat COLLATE Latin1_General_CI_AI))
        )`;
      }
    }

    // Total con mismo filtro
    const rCount = pool.request();
    if (filterSqlExists.includes('@cat')) rCount.input('cat', sql.VarChar(120), categoria);
    const total = (await rCount.query(`SELECT COUNT(*) AS total FROM inv.v_productos v WHERE ${whereParts.join(' AND ')}${filterSqlExists}`)).recordset[0].total;

    const r = pool.request();
    r.input('offset', sql.Int, offset);
    r.input('limit', sql.Int, limit);
    if (filterSqlExists.includes('@cat')) r.input('cat', sql.VarChar(120), categoria);
    const rows = (await r.query(`
      SELECT Codigo, Nombre, COALESCE(Categorias, '') AS Categorias, Cantidad
      FROM inv.v_productos v
      WHERE ${whereParts.join(' AND ')}${filterSqlExists}
      ORDER BY Cantidad ASC, Nombre ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `)).recordset;

    return res.json({
      success: true,
      data: rows.map(x => ({ codigo: x.Codigo, nombre: x.Nombre, categoria: x.Categorias || '(sin categoría)', disponible: Number(x.Cantidad) })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Error en /api/reportes/inventario/critico:', err);
    return res.status(500).json({ success: false, message: 'Error obteniendo stock crítico' });
  }
});

// Resumen por estado de inventario (para gráfica)
app.get('/api/reportes/inventario/resumen-estados', async (req, res) => {
  try {
    const categoria = String(req.query.categoria || '').trim();
    const pool = await getPool();

    let filterSqlExists = '';
    if (categoria) {
      if (categoria.toLowerCase() === '__none__' || categoria.toLowerCase() === '__sin__' || categoria.toLowerCase() === 'sin categoría' || categoria.toLowerCase() === 'sin categoria') {
        filterSqlExists = ` AND NOT EXISTS (SELECT 1 FROM inv.producto_categoria pc WHERE pc.IdProducto = v.IdProducto)`;
      } else if (categoria.toLowerCase() !== 'todas') {
        filterSqlExists = ` AND EXISTS (
          SELECT 1
          FROM inv.producto_categoria pc
          JOIN inv.categorias c ON c.IdCategoria = pc.IdCategoria
          WHERE pc.IdProducto = v.IdProducto
            AND LOWER(CONVERT(VARCHAR(100), c.Nombre COLLATE Latin1_General_CI_AI)) = LOWER(CONVERT(VARCHAR(100), @cat COLLATE Latin1_General_CI_AI))
        )`;
      }
    }

    const rq = pool.request();
    if (filterSqlExists.includes('@cat')) rq.input('cat', sql.VarChar(120), categoria);
    const rows = (await rq.query(`
      SELECT v.Estado, COUNT(*) AS Total
      FROM inv.v_productos v
      WHERE 1=1${filterSqlExists}
      GROUP BY v.Estado
    `)).recordset;

    return res.json({ success: true, data: rows.map(r => ({ estado: r.Estado, total: Number(r.Total) })) });
  } catch (err) {
    console.error('Error en /api/reportes/inventario/resumen-estados:', err);
    return res.status(500).json({ success: false, message: 'Error obteniendo resumen de estados' });
  }
});

// Lista completa de productos en stock crítico (para gráfica de críticos)
app.get('/api/reportes/inventario/critico-list', async (req, res) => {
  try {
    const categoria = String(req.query.categoria || '').trim();
    const pool = await getPool();

    const whereParts = ['v.Cantidad > 0', 'v.Cantidad < 25'];
    let filterSqlExists = '';
    if (categoria) {
      if (categoria.toLowerCase() === '__none__' || categoria.toLowerCase() === '__sin__' || categoria.toLowerCase() === 'sin categoría' || categoria.toLowerCase() === 'sin categoria') {
        filterSqlExists = ` AND NOT EXISTS (SELECT 1 FROM inv.producto_categoria pc WHERE pc.IdProducto = v.IdProducto)`;
      } else if (categoria.toLowerCase() !== 'todas') {
        filterSqlExists = ` AND EXISTS (
          SELECT 1 FROM inv.producto_categoria pc
          JOIN inv.categorias c ON c.IdCategoria = pc.IdCategoria
          WHERE pc.IdProducto = v.IdProducto
            AND LOWER(CONVERT(VARCHAR(100), c.Nombre COLLATE Latin1_General_CI_AI)) = LOWER(CONVERT(VARCHAR(100), @cat COLLATE Latin1_General_CI_AI))
        )`;
      }
    }

    const rq = pool.request();
    if (filterSqlExists.includes('@cat')) rq.input('cat', sql.VarChar(120), categoria);
    const rows = (await rq.query(`
      SELECT v.Codigo, v.Nombre, COALESCE(v.Categorias,'') AS Categorias, v.Cantidad
      FROM inv.v_productos v
      WHERE ${whereParts.join(' AND ')}${filterSqlExists}
      ORDER BY v.Cantidad ASC, v.Nombre ASC
    `)).recordset;
    return res.json({ success: true, items: rows.map(r => ({ codigo: r.Codigo, nombre: r.Nombre, categorias: r.Categorias, cantidad: Number(r.Cantidad) })) });
  } catch (err) {
    console.error('Error en /api/reportes/inventario/critico-list:', err);
    return res.status(500).json({ success: false, message: 'Error obteniendo lista de críticos' });
  }
});

app.post('/api/login', verifyRecaptcha, async (req, res) => {
  try {
    const { usuario, password } = req.body;

    console.log('Login attempt for user:', usuario);

    if (!usuario || !password) {
      return res.status(400).json({
        success: false,
        message: 'Usuario y contrasena requeridos'
      });
    }

    const pool = await getPool();
    const request = pool.request();
    request.input('Usuario', sql.VarChar(50), usuario);
    request.input('Password', sql.NVarChar(200), password);

    const result = await request.execute('seg.sp_ValidarUsuario');

    if (result.recordset && result.recordset.length > 0) {
      const userData = result.recordset[0];

      if (userData.Resultado === 'OK') {
        console.log('Login successful for:', userData.Usuario, '- Role:', userData.Rol);
        return res.json({
          success: true,
          message: userData.Mensaje,
          user: {
            id: userData.IdUsuario,
            usuario: userData.Usuario,
            nombres: userData.Nombres,
            apellidos: userData.Apellidos,
            rol: userData.Rol,
            correo: userData.Correo,
            esPasswordTemporal: userData.EsPasswordTemporal
          }
        });
      } else {
        console.log('Login failed for:', usuario, '- Reason:', userData.Mensaje);
        return res.status(401).json({ success: false, message: userData.Mensaje });
      }
    }

    return res.status(401).json({ success: false, message: 'Error en la consulta' });

  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// Ruta para obtener estadÃ­sticas del dashboard
app.get('/api/dashboard-stats', async (req, res) => {
    try {
        console.log('Obteniendo estadisticas del dashboard...');

        const pool = await getPool();
        const [usuariosTotal, usuariosActivos, accesosOKHoy, accesosFailHoy, ultimosAccesos] = await Promise.all([
            pool.request().query('SELECT COUNT(*) AS total FROM seg.tbUsuario'),
            pool.request().query('SELECT COUNT(*) AS activos FROM seg.tbUsuario WHERE Estado = 1'),
            pool.request().query(`
                SELECT COUNT(*) AS accesos
                FROM seg.tbBitacoraAcceso
                WHERE CAST(FechaHora AS DATE) = CAST(GETDATE() AS DATE)
                  AND Resultado = 'OK'`),
            pool.request().query(`
                SELECT COUNT(*) AS fallidos
                FROM seg.tbBitacoraAcceso
                WHERE CAST(FechaHora AS DATE) = CAST(GETDATE() AS DATE)
                  AND Resultado = 'FAIL'`),
            pool.request().query(`
                SELECT TOP 5 Usuario, FechaHora, Resultado
                FROM seg.tbBitacoraAcceso
                ORDER BY FechaHora DESC`)
        ]);

        const stats = {
            admin: {
                usuariosTotal: usuariosTotal.recordset[0].total,
                usuariosActivos: usuariosActivos.recordset[0].activos,
                accesosHoy: accesosOKHoy.recordset[0].accesos,
                accesosFallidosHoy: accesosFailHoy.recordset[0].fallidos,
                ultimosAccesos: ultimosAccesos.recordset
            },
            secretaria: {
                usuariosActivos: usuariosActivos.recordset[0].activos,
                accesosHoy: accesosOKHoy.recordset[0].accesos
            }
        };

        console.log('Estadisticas obtenidas:', stats);
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Error obteniendo estadisticas:', error);
        res.status(500).json({ success: false, message: 'Error obteniendo estadÃ­sticas del dashboard' });
    }
});






// Ruta para crear usuarios con Contrasena temporal
app.post('/api/usuarios', async (req, res) => {
    try {
        const { usuarioEjecutor, nombres, apellido, email, rol, password } = req.body;

        console.log('Creando nuevo usuario:');
        console.log('Datos recibidos:', { usuarioEjecutor, nombres, apellido, email, rol, hasPassword: !!password });
        console.log('Body completo:', req.body);

        // Validar datos de entrada
        if (!usuarioEjecutor || !nombres || !apellido || !email || !rol || !password) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        // Validar formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'El formato del correo electronico no es valido'
            });
        }

        // Validar rol valido
        if (!['admin', 'secretaria'].includes(rol)) {
            return res.status(400).json({
                success: false,
                message: 'Rol invalido. Debe ser admin o secretaria'
            });
        }

        // Conectar a la base de datos
        const pool = await getPool();

        // Generar nombre de usuario automaticamente
        const usuario = (nombres.substring(0, 3) + apellido.substring(0, 3)).toLowerCase().replace(/\s/g, '');

        // Usar el SP disponible en DB_pt2.sql (sp_RegistrarUsuario)
        const request = pool.request();
        request.input('Usuario', sql.VarChar(50), usuario);
        request.input('Nombres', sql.VarChar(100), nombres);
        request.input('Apellidos', sql.VarChar(100), apellido);
        request.input('Correo', sql.VarChar(120), email);
        request.input('Rol', sql.VarChar(20), rol);
        request.input('Password', sql.NVarChar(200), password);
        request.input('Confirmar', sql.NVarChar(200), password);
        request.output('Mensaje', sql.NVarChar(200));

        const result = await request.execute('seg.sp_RegistrarUsuario');

        console.log('Resultado alta usuario:', { returnValue: result.returnValue, mensaje: result.output.Mensaje });

        if (result.returnValue === 0) {
            // Marcar Contrasena como temporal (24h) para forzar cambio en primer login
            const fechaExpira = new Date();
            fechaExpira.setHours(fechaExpira.getHours() + 24);

            await pool.request()
                .input('Usuario', sql.VarChar(50), usuario)
                .input('FechaExpira', sql.DateTime2, fechaExpira)
                .query(`
                    UPDATE seg.tbUsuario
                    SET EsPasswordTemporal = 1,
                        FechaExpiraPassword = @FechaExpira
                    WHERE Usuario = @Usuario
                `);

            // Ã‰xito
            res.json({
                success: true,
                message: result.output.Mensaje,
                usuario: {
                    usuario: usuario,
                    nombres: nombres,
                    apellidos: apellido,
                    correo: email,
                    rol: rol,
                    esPasswordTemporal: true
                }
            });
        } else {
            // Error desde el procedimiento
            res.status(400).json({
                success: false,
                message: result.output.Mensaje || 'Error al crear el usuario'
            });
        }

    } catch (error) {
        console.error('Error creando usuario:', error);
        console.error('Stack trace:', error.stack);
        console.error('Detalles completos del error:', {
            message: error.message,
            name: error.name,
            code: error.code,
            number: error.number,
            severity: error.severity,
            state: error.state,
            procedure: error.procedure,
            lineNumber: error.lineNumber
        });
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor: ' + error.message
        });
    }
});

// Ruta para cambiar Contrasena (soporta nombres de SP antiguos y nuevos)
app.post('/api/usuarios/cambiar-password', async (req, res) => {
    try {
        const { usuario, passwordActual, passwordNueva, confirmarPassword } = req.body;

        console.log('ðŸ”‘ Cambiando contrasena para:', usuario);

        // Validar datos de entrada
        if (!usuario || !passwordActual || !passwordNueva || !confirmarPassword) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        // Conectar a la base de datos
        const pool = await getPool();

        // Construir request base (parÃ¡metros coinciden con ambos SPs)
        const makeRequest = () => {
            const r = pool.request();
            r.input('Usuario', sql.VarChar(50), usuario);
            r.input('PasswordActual', sql.NVarChar(200), passwordActual);
            r.input('PasswordNueva', sql.NVarChar(200), passwordNueva);
            r.input('ConfirmarNueva', sql.NVarChar(200), confirmarPassword);
            r.output('Mensaje', sql.NVarChar(200));
            return r;
        };

        let result;
        try {
            // Preferir el SP del script actual (DB_pt2.sql)
            result = await makeRequest().execute('seg.sp_ActualizarContrasena');
        } catch (err) {
            // Si el SP no existe (p.ej. DB antigua), intentar el nombre previo
            const notFound = (err && (err.number === 2812 || /could not find stored procedure|no se pudo encontrar el procedimiento almacenado/i.test(String(err.message))));
            if (!notFound) throw err;
            result = await makeRequest().execute('seg.sp_CambiarPasswordTemporal');
        }

        console.log('ðŸ“‹ Resultado cambio contrasena:', {
            returnValue: result.returnValue,
            mensaje: result.output.Mensaje
        });

        if (result.returnValue === 0) {
            return res.json({ success: true, message: result.output.Mensaje });
        }

        return res.status(400).json({
            success: false,
            message: result.output.Mensaje || 'Error al cambiar la Contrasena'
        });

    } catch (error) {
        console.error('âŒ Error Cambiando contrasena:', error);
        return res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// === PRODUCTOS ===
// Rutas manejadas exclusivamente en './src/routes/productos.routes.js'

// Ruta para obtener usuarios reales de la base de datos
app.get('/api/usuarios', async (req, res) => {
    try {
        console.log('ðŸ“‹ Solicitando lista de usuarios de la BD...');

        // Conectar a la base de datos
        const pool = await getPool();

        // Consulta para obtener usuarios (ACTIVOS e INACTIVOS, no eliminados fÃ­sicamente)
        const result = await pool.request().query(`
            SELECT
                u.IdUsuario,
                u.Usuario,
                u.Nombres + ' ' + u.Apellidos AS NombreCompleto,
                u.Correo,
                u.Rol,
                u.Estado,
                u.FechaCreacion,
                (
                    SELECT TOP 1 ba.FechaHora
                    FROM seg.tbBitacoraAcceso ba
                    WHERE ba.IdUsuario = u.IdUsuario
                      AND ba.Resultado = 'OK'
                    ORDER BY ba.FechaHora DESC
                ) AS UltimoAcceso
            FROM seg.tbUsuario u
            ORDER BY u.FechaCreacion DESC
        `);

        console.log(`âœ… Encontrados ${result.recordset.length} usuarios en la BD`);

        // Formatear datos para el frontend
        const usuarios = result.recordset.map(user => ({
            id: user.IdUsuario,
            usuario: user.Usuario,
            nombreCompleto: user.NombreCompleto,
            email: user.Correo,
            rol: user.Rol,
            estado: user.Estado ? 'Activo' : 'Inactivo',
            ultimoAcceso: user.UltimoAcceso ?
                new Date(user.UltimoAcceso).toLocaleString('es-ES', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }) : 'Nunca',
            fechaCreacion: new Date(user.FechaCreacion).toLocaleString('es-ES', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            })
        }));

        res.json({
            success: true,
            usuarios: usuarios,
            total: usuarios.length
        });

    } catch (error) {
        console.error('âŒ Error obteniendo usuarios:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor',
            usuarios: [],
            total: 0
        });
    }
});

// === VENTAS ===
// Registrar una venta con detalle y rebajar inventario
app.post('/api/ventas', async (req, res) => {
  const payload = req.body || {};
  const usuario = String(payload.usuario || 'sistema');
  const cliente = payload.cliente ? String(payload.cliente).slice(0, 150) : null;
  const formaPago = String(payload.formaPago || 'Efectivo').slice(0, 20);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) return res.status(400).json({ success: false, message: 'No hay items en la venta' });

  try {
    const pool = await getPool();
    let tx;
    tx = new sql.Transaction(pool);
    await tx.begin();
    const r = new sql.Request(tx);

    // Normalizar y calcular totales
    let bruto = 0, neto = 0;
    const norm = [];
    for (const it of items) {
      const code = String(it.code || it.codigo || '').trim();
      if (!code) { await tx.rollback(); return res.status(400).json({ success: false, message: 'Item sin código' }); }
      const qty = Math.max(1, parseInt(it.qty || it.cantidad || '1', 10));
      const price = Number(it.price || it.precio || 0);
      const discount = Number(it.discount || it.descuento || 0) || 0;
      const lineBruto = price * qty;
      const lineNeto = price * (1 - (discount / 100)) * qty;
      bruto += lineBruto; neto += lineNeto;
      norm.push({ code, qty, price, discount, lineNeto });
    }
    const ahorro = Math.max(0, bruto - neto);

    // Insert cabecera
    const now = new Date();
    const rqHead = new sql.Request(tx);
    rqHead.input('FH', sql.DateTime2, now);
    rqHead.input('Usuario', sql.VarChar(50), usuario);
    rqHead.input('Cliente', sql.NVarChar(150), cliente);
    rqHead.input('FormaPago', sql.VarChar(20), formaPago);
    rqHead.input('Subtotal', sql.Decimal(18,2), bruto);
    rqHead.input('DescuentoTotal', sql.Decimal(18,2), ahorro);
    rqHead.input('Total', sql.Decimal(18,2), neto);
    const insHead = await rqHead.query(`
      INSERT INTO ven.ventas(FechaHora, Usuario, Cliente, FormaPago, Subtotal, DescuentoTotal, Total)
      OUTPUT INSERTED.IdVenta
      VALUES(@FH, @Usuario, @Cliente, @FormaPago, @Subtotal, @DescuentoTotal, @Total)
    `);
    const idVenta = insHead.recordset[0].IdVenta;

    // Insert detalle + rebaja inventario
    for (const it of norm) {
      // Resolver producto por código
      const rf = new sql.Request(tx);
      rf.input('Codigo', sql.VarChar(50), it.code);
      const prod = (await rf.query('SELECT TOP 1 IdProducto, Nombre, Cantidad FROM inv.productos WHERE Codigo=@Codigo')).recordset[0];
      if (!prod) { await tx.rollback(); return res.status(400).json({ success:false, message:`Código no encontrado: ${it.code}` }); }

      // Insert detalle
      const rd = new sql.Request(tx);
      rd.input('IdVenta', sql.BigInt, idVenta);
      rd.input('IdProducto', sql.Int, prod.IdProducto);
      rd.input('Codigo', sql.VarChar(50), it.code);
      rd.input('Producto', sql.NVarChar(150), prod.Nombre);
      rd.input('Cantidad', sql.Int, it.qty);
      rd.input('Precio', sql.Decimal(18,2), it.price);
      rd.input('Descuento', sql.Decimal(5,2), it.discount);
      rd.input('Subtotal', sql.Decimal(18,2), it.lineNeto);
      await rd.query(`
        INSERT INTO ven.venta_detalle(IdVenta, IdProducto, Codigo, Producto, Cantidad, Precio, Descuento, Subtotal)
        VALUES(@IdVenta, @IdProducto, @Codigo, @Producto, @Cantidad, @Precio, @Descuento, @Subtotal)
      `);

      // Rebajar inventario (sin negativos)
      const ru = new sql.Request(tx);
      ru.input('IdProducto', sql.Int, prod.IdProducto);
      ru.input('Qty', sql.Int, it.qty);
      await ru.query('UPDATE inv.productos SET Cantidad = CASE WHEN Cantidad >= @Qty THEN Cantidad - @Qty ELSE 0 END WHERE IdProducto=@IdProducto');
    }

    // Bitácora de ventas
    const rb = new sql.Request(tx);
    rb.input('IdVenta', sql.BigInt, idVenta);
    rb.input('Usuario', sql.VarChar(50), usuario);
    rb.input('FH', sql.DateTime2, now);
    rb.input('Ahorro', sql.Decimal(18,2), ahorro);
    rb.input('Total', sql.Decimal(18,2), neto);
    await rb.query('INSERT INTO seg.tbBitacoraVentas(IdVenta, Usuario, FechaHora, DescuentoTotal, Total) VALUES(@IdVenta, @Usuario, @FH, @Ahorro, @Total)');

    await tx.commit();
    return res.json({ success: true, idVenta, totals: { subtotal: bruto, descuento: ahorro, total: neto } });
  } catch (err) {
    console.error('Error registrando venta:', err);
    try { if (typeof tx !== 'undefined') await tx.rollback(); } catch(_){}
    const msg = (err && err.number === 208) || /invalid object name|objeto no válido|no existe la tabla/i.test(String(err && err.message))
      ? 'Esquema de ventas no instalado. Ejecuta database/DB_pt2.sql y reinicia el servidor.'
      : (err && err.message) || 'Error registrando venta';
    return res.status(500).json({ success:false, message: msg });
  }
});

// Listado (bitácora) de ventas recientes
app.get('/api/ventas/bitacora', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const pool = await getPool();
    const total = (await pool.request().query('SELECT COUNT(*) AS total FROM ven.ventas')).recordset[0].total;
    const r = pool.request();
    r.input('offset', sql.Int, offset);
    r.input('limit', sql.Int, limit);
    const rows = (await r.query(`
      SELECT v.IdVenta, v.FechaHora, v.Usuario, v.DescuentoTotal
      FROM ven.ventas v
      ORDER BY v.FechaHora DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `)).recordset;
    return res.json({ success: true, data: rows.map(x => ({ id: x.IdVenta, fechaHora: x.FechaHora, usuario: x.Usuario, descuentoTotal: Number(x.DescuentoTotal) })), pagination: { page, limit, total, totalPages: Math.ceil(total/limit) } });
  } catch (err) {
    console.error('Error en /api/ventas/bitacora:', err);
    return res.status(500).json({ success: false, message: 'Error obteniendo bitácora de ventas' });
  }
});

// Detalle de venta
app.get('/api/ventas/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success:false, message:'Id de venta inválido' });
    const pool = await getPool();
    const head = (await pool.request().input('Id', sql.BigInt, id).query(`
      SELECT IdVenta, FechaHora, Usuario, Cliente, FormaPago, Subtotal, DescuentoTotal, Total
      FROM ven.ventas WHERE IdVenta = @Id
    `)).recordset[0];
    if (!head) return res.status(404).json({ success:false, message:'Venta no encontrada' });
    const items = (await pool.request().input('Id', sql.BigInt, id).query(`
      SELECT Codigo, Producto, Cantidad, Precio, Descuento, Subtotal
      FROM ven.venta_detalle WHERE IdVenta = @Id ORDER BY IdDetalle ASC
    `)).recordset;
    return res.json({ success:true, venta: {
      id: head.IdVenta,
      fechaHora: head.FechaHora,
      usuario: head.Usuario,
      cliente: head.Cliente || '',
      formaPago: head.FormaPago,
      subtotal: Number(head.Subtotal),
      descuentoTotal: Number(head.DescuentoTotal),
      total: Number(head.Total),
      items: items.map(r => ({ codigo: r.Codigo, producto: r.Producto, cantidad: Number(r.Cantidad), precio: Number(r.Precio), descuento: Number(r.Descuento), subtotal: Number(r.Subtotal) }))
    }});
  } catch (err) {
    console.error('Error en GET /api/ventas/:id:', err);
    return res.status(500).json({ success:false, message:'Error obteniendo detalle de venta' });
  }
});

// Ruta para obtener un usuario especÃ­fico por ID
app.get('/api/usuarios/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        console.log(`ðŸ“‹ Obteniendo usuario ID: ${userId}`);

        // Conectar a la base de datos
        const pool = await getPool();

        // Consulta para obtener usuario especÃ­fico con su Ãºltimo acceso
        const result = await pool.request()
            .input('UserId', sql.Int, userId)
            .query(`
                SELECT
                    u.IdUsuario,
                    u.Usuario,
                    u.Nombres,
                    u.Apellidos,
                    u.Nombres + ' ' + u.Apellidos AS NombreCompleto,
                    u.Correo,
                    u.Rol,
                    u.Estado,
                    u.FechaCreacion,
                    u.UltimoCambioPass,
                    (
                        SELECT TOP 1 ba.FechaHora
                        FROM seg.tbBitacoraAcceso ba
                        WHERE ba.IdUsuario = u.IdUsuario
                          AND ba.Resultado = 'OK'
                        ORDER BY ba.FechaHora DESC
                    ) AS UltimoAcceso
                FROM seg.tbUsuario u
                WHERE u.IdUsuario = @UserId
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        const user = result.recordset[0];

        // Formatear datos para el frontend
        const userData = {
            id: user.IdUsuario,
            usuario: user.Usuario,
            nombres: user.Nombres,
            apellidos: user.Apellidos,
            nombreCompleto: user.NombreCompleto,
            email: user.Correo,
            rol: user.Rol,
            estado: user.Estado ? 'Activo' : 'Inactivo',
            ultimoAcceso: user.UltimoAcceso ?
                new Date(user.UltimoAcceso).toLocaleString('es-ES', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }) : 'Nunca',
            fechaCreacion: new Date(user.FechaCreacion).toLocaleString('es-ES', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }),
            ultimoCambioPass: user.UltimoCambioPass ?
                new Date(user.UltimoCambioPass).toLocaleString('es-ES', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : 'Nunca'
        };

        console.log(`âœ… Usuario ${userId} encontrado: ${userData.nombreCompleto}`);

        res.json({
            success: true,
            usuario: userData
        });

    } catch (error) {
        console.error('âŒ Error obteniendo usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Ruta para eliminar usuario (DELETE) - eliminaciÃ³n definitiva (solo admin)
app.delete('/api/usuarios/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { usuarioEjecutor } = req.body;

        console.log('ðŸ—‘ï¸ Eliminando usuario:', { userId, usuarioEjecutor });

        // Validar datos de entrada
        if (!usuarioEjecutor) {
            return res.status(400).json({
                success: false,
                message: 'Usuario ejecutor es requerido'
            });
        }

        // Conectar a la base de datos
        const pool = await getPool();

        // 1) Verificar que el ejecutor sea admin activo
        const execCheck = await pool.request()
            .input('Usuario', sql.VarChar(50), usuarioEjecutor)
            .query("SELECT Rol, Estado FROM seg.tbUsuario WHERE Usuario=@Usuario");
        const exec = execCheck.recordset[0];
        if (!exec || exec.Rol !== 'admin' || !(exec.Estado === true || exec.Estado === 1)) {
            return res.status(403).json({ success: false, message: 'Solo un administrador activo puede eliminar usuarios' });
        }

        // 2) Obtener datos del usuario a eliminar para bitÃ¡cora
        const userQ = await pool.request()
            .input('IdUsuario', sql.Int, userId)
            .query('SELECT Usuario, Nombres, Apellidos FROM seg.tbUsuario WHERE IdUsuario=@IdUsuario');
        if (userQ.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        const toDelete = userQ.recordset[0];

        // 3) EliminaciÃ³n definitiva
        await pool.request()
            .input('IdUsuario', sql.Int, userId)
            .query('DELETE FROM seg.tbUsuario WHERE IdUsuario=@IdUsuario');

        // 4) BitÃ¡cora
        await pool.request()
            .input('Usuario', sql.VarChar(50), usuarioEjecutor)
            .input('IdUsuario', sql.Int, userId)
            .input('Operacion', sql.VarChar(30), 'DELETE_USER')
            .input('Entidad', sql.VarChar(30), 'tbUsuario')
            .input('Clave', sql.VarChar(100), `IdUsuario=${userId}`)
            .input('Detalle', sql.NVarChar(4000), `EliminaciÃ³n definitiva de usuario ${toDelete.Usuario} (${toDelete.Nombres} ${toDelete.Apellidos})`)
            .query(`
                INSERT INTO seg.tbBitacoraTransacciones(Usuario, IdUsuario, Operacion, Entidad, ClaveEntidad, Detalle)
                VALUES(@Usuario, (SELECT IdUsuario FROM seg.tbUsuario WHERE Usuario=@Usuario), @Operacion, @Entidad, @Clave, @Detalle)
            `);

        res.json({ success: true, message: 'Usuario eliminado definitivamente' });

    } catch (error) {
        console.error('âŒ Error eliminando usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Ruta para actualizar usuario (PUT) - usa UPDATE directo en DB_pt2.sql
app.put('/api/usuarios/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const {
            usuarioEjecutor,
            nombres,
            apellido,
            email,
            rol,
            estado
        } = req.body;

        console.log('ðŸ“ Actualizando usuario:', { userId, usuarioEjecutor, nombres, apellido, email, rol, estado });

        // Validar datos de entrada
        if (!usuarioEjecutor || !nombres || !apellido || !email || !rol || estado === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        // Conectar a la base de datos
        const pool = await getPool();

        // Obtener el nombre de usuario actual para pasarlo al SP
        const userQuery = await pool.request()
            .input('UserId', sql.Int, userId)
            .query('SELECT Usuario FROM seg.tbUsuario WHERE IdUsuario = @UserId');

        if (userQuery.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        const currentUsuario = userQuery.recordset[0].Usuario;

        // Validar duplicados de correo para otro usuario
        const emailDup = await pool.request()
            .input('Correo', sql.VarChar(120), email)
            .input('IdUsuario', sql.Int, userId)
            .query('SELECT COUNT(*) AS cnt FROM seg.tbUsuario WHERE Correo=@Correo AND IdUsuario<>@IdUsuario');
        if (emailDup.recordset[0].cnt > 0) {
            return res.status(400).json({ success: false, message: 'Correo ya utilizado por otro usuario' });
        }

        // Actualizar
        await pool.request()
            .input('IdUsuario', sql.Int, userId)
            .input('Nombres', sql.VarChar(100), nombres)
            .input('Apellidos', sql.VarChar(100), apellido)
            .input('Correo', sql.VarChar(120), email)
            .input('Rol', sql.VarChar(20), rol)
            .input('Estado', sql.Bit, estado === 'activo' ? 1 : 0)
            .query(`
                UPDATE seg.tbUsuario
                SET Nombres=@Nombres, Apellidos=@Apellidos, Correo=@Correo, Rol=@Rol, Estado=@Estado
                WHERE IdUsuario=@IdUsuario
            `);

        // BitÃ¡cora
        await pool.request()
            .input('Usuario', sql.VarChar(50), usuarioEjecutor)
            .input('IdUsuario', sql.Int, userId)
            .input('Operacion', sql.VarChar(30), 'UPDATE_USER')
            .input('Entidad', sql.VarChar(30), 'tbUsuario')
            .input('Clave', sql.VarChar(100), `IdUsuario=${userId}`)
            .input('Detalle', sql.NVarChar(4000), `ActualizaciÃ³n de usuario (${currentUsuario})`)
            .query(`
                INSERT INTO seg.tbBitacoraTransacciones(Usuario, IdUsuario, Operacion, Entidad, ClaveEntidad, Detalle)
                VALUES(@Usuario, (SELECT IdUsuario FROM seg.tbUsuario WHERE Usuario=@Usuario), @Operacion, @Entidad, @Clave, @Detalle)
            `);

        res.json({ success: true, message: 'Usuario actualizado' });

    } catch (error) {
        console.error('âŒ Error actualizando usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Ruta para resetear Contrasena de usuario
app.post('/api/usuarios/:id/reset-password', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { usuarioEjecutor, newPassword } = req.body;

        console.log('ðŸ”‘ Reseteando Contrasena para usuario:', userId);

        // Validar datos de entrada
        if (!usuarioEjecutor || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Usuario ejecutor y nueva Contrasena son requeridos'
            });
        }

        // Conectar a la base de datos
        const pool = await getPool();

        // Obtener datos del usuario a resetear
        const userQuery = await pool.request()
            .input('UserId', sql.Int, userId)
            .query('SELECT Usuario, Correo, Nombres, Apellidos FROM seg.tbUsuario WHERE IdUsuario = @UserId AND Estado = 1');

        if (userQuery.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado o inactivo'
            });
        }

        const targetUser = userQuery.recordset[0];

        // Generar salt aleatorio (16 bytes)
        const salt = require('crypto').randomBytes(16);

        // Calcular fecha de expiraciÃ³n (24 horas desde ahora)
        const fechaExpira = new Date();
        fechaExpira.setHours(fechaExpira.getHours() + 24);

        // Actualizar Contrasena usando la funciÃ³n de SQL Server para consistencia
       
        const updateResult = await pool.request()
            .input('UserId', sql.Int, userId)
            .input('Password', sql.NVarChar(200), newPassword)
            .input('Salt', sql.VarBinary(16), salt)
            .input('FechaExpira', sql.DateTime2, fechaExpira)
            .query(`
                UPDATE seg.tbUsuario
                SET
                    HashPassword = seg.fn_HashWithSalt(@Password, @Salt),
                    Salt = @Salt,
                    UltimoCambioPass = SYSDATETIME(),
                    EsPasswordTemporal = 1,
                    FechaExpiraPassword = @FechaExpira
                WHERE IdUsuario = @UserId
            `);

        // Registrar en bitÃ¡cora
        const fechaExpiraFormatted = fechaExpira.toLocaleString('es-GT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        await pool.request()
            .input('Usuario', sql.VarChar(50), usuarioEjecutor)
            .input('IdUsuario', sql.Int, userId)
            .input('Operacion', sql.VarChar(30), 'RESET_PASSWORD_TEMPORAL')
            .input('Entidad', sql.VarChar(30), 'tbUsuario')
            .input('Clave', sql.VarChar(100), `IdUsuario=${userId}`)
            .input('Detalle', sql.NVarChar(4000), `Contrasena temporal generada (expira: ${fechaExpiraFormatted}) para: ${targetUser.Nombres} ${targetUser.Apellidos} (${targetUser.Correo})`)
            .query(`
                INSERT INTO seg.tbBitacoraTransacciones(Usuario, IdUsuario, Operacion, Entidad, ClaveEntidad, Detalle)
                VALUES(@Usuario, (SELECT IdUsuario FROM seg.tbUsuario WHERE Usuario = @Usuario), @Operacion, @Entidad, @Clave, @Detalle)
            `);

        console.log('âœ… Contrasena temporal reseteada exitosamente (expira en 24 horas)');

        res.json({
            success: true,
            message: `Contrasena temporal generada exitosamente para ${targetUser.Usuario}`
        });

    } catch (error) {
        console.error('âŒ Error reseteando Contrasena:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Ruta para deshabilitar usuario (eliminaciÃ³n lÃ³gica sin SP)
app.post('/api/usuarios/:id/disable', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { usuarioEjecutor } = req.body;

        console.log('ðŸš« Deshabilitando usuario:', { userId, usuarioEjecutor });

        // Validar datos de entrada
        if (!usuarioEjecutor) {
            return res.status(400).json({
                success: false,
                message: 'Usuario ejecutor es requerido'
            });
        }

        // Conectar a la base de datos
        const pool = await getPool();

        await pool.request()
            .input('IdUsuario', sql.Int, userId)
            .query('UPDATE seg.tbUsuario SET Estado = 0 WHERE IdUsuario = @IdUsuario');

        await pool.request()
            .input('Usuario', sql.VarChar(50), usuarioEjecutor)
            .input('IdUsuario', sql.Int, userId)
            .input('Operacion', sql.VarChar(30), 'DISABLE_USER')
            .input('Entidad', sql.VarChar(30), 'tbUsuario')
            .input('Clave', sql.VarChar(100), `IdUsuario=${userId}`)
            .input('Detalle', sql.NVarChar(4000), 'Usuario deshabilitado')
            .query(`
                INSERT INTO seg.tbBitacoraTransacciones(Usuario, IdUsuario, Operacion, Entidad, ClaveEntidad, Detalle)
                VALUES(@Usuario, (SELECT IdUsuario FROM seg.tbUsuario WHERE Usuario=@Usuario), @Operacion, @Entidad, @Clave, @Detalle)
            `);

        res.json({ success: true, message: 'Usuario deshabilitado' });

    } catch (error) {
        console.error('âŒ Error deshabilitando usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Ruta para rehabilitar usuario (sin SP)
app.post('/api/usuarios/:id/enable', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { usuarioEjecutor } = req.body;

        console.log('âœ… Rehabilitando usuario:', { userId, usuarioEjecutor });

        // Validar datos de entrada
        if (!usuarioEjecutor) {
            return res.status(400).json({
                success: false,
                message: 'Usuario ejecutor es requerido'
            });
        }

        // Conectar a la base de datos
        const pool = await getPool();

        await pool.request()
            .input('IdUsuario', sql.Int, userId)
            .query('UPDATE seg.tbUsuario SET Estado = 1 WHERE IdUsuario = @IdUsuario');

        await pool.request()
            .input('Usuario', sql.VarChar(50), usuarioEjecutor)
            .input('IdUsuario', sql.Int, userId)
            .input('Operacion', sql.VarChar(30), 'ENABLE_USER')
            .input('Entidad', sql.VarChar(30), 'tbUsuario')
            .input('Clave', sql.VarChar(100), `IdUsuario=${userId}`)
            .input('Detalle', sql.NVarChar(4000), 'Usuario rehabilitado')
            .query(`
                INSERT INTO seg.tbBitacoraTransacciones(Usuario, IdUsuario, Operacion, Entidad, ClaveEntidad, Detalle)
                VALUES(@Usuario, (SELECT IdUsuario FROM seg.tbUsuario WHERE Usuario=@Usuario), @Operacion, @Entidad, @Clave, @Detalle)
            `);

        res.json({ success: true, message: 'Usuario habilitado' });

    } catch (error) {
        console.error('âŒ Error rehabilitando usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});





// === BITÃCORAS ===
app.get('/api/bitacora/accesos', async (req, res) => {
    try {
        const {
            rol = '', usuario = '', estado = '', fechaInicio = '', fechaFin = '',
            page = 1, limit = 10
        } = req.query;
        const pool = await getPool();
        let where = 'WHERE 1=1';
        const r = pool.request();

        if (rol.trim()) {
            where += ' AND u.Rol = @rol';
            r.input('rol', sql.VarChar(20), rol.trim().toLowerCase());
        }
        if (usuario.trim()) {
            where += ' AND (ba.Usuario LIKE @usuario)';
            r.input('usuario', sql.VarChar(100), `%${usuario.trim()}%`);
        }
        if (estado.trim()) { // 'OK' | 'FAIL'
            where += ' AND ba.Resultado = @estado';
            r.input('estado', sql.VarChar(10), estado.trim().toUpperCase());
        }

        // Filtro de fechas mejorado
        if (fechaInicio && !fechaFin) {
            // Solo fecha inicio: mostrar solo ese dÃ­a especÃ­fico
            where += ' AND ba.FechaHora >= @fi AND ba.FechaHora < DATEADD(day,1,@fi)';
            r.input('fi', sql.DateTime2, new Date(fechaInicio));
        } else if (!fechaInicio && fechaFin) {
            // Solo fecha fin: mostrar hasta ese dÃ­a (inclusive)
            where += ' AND ba.FechaHora < DATEADD(day,1,@ff)';
            r.input('ff', sql.DateTime2, new Date(fechaFin));
        } else if (fechaInicio && fechaFin) {
            // Ambas fechas: mostrar rango completo
            where += ' AND ba.FechaHora >= @fi AND ba.FechaHora < DATEADD(day,1,@ff)';
            r.input('fi', sql.DateTime2, new Date(fechaInicio));
            r.input('ff', sql.DateTime2, new Date(fechaFin));
        }

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        // total
        const total = (await r.query(`
            SELECT COUNT(*) total
            FROM seg.tbBitacoraAcceso ba
            INNER JOIN seg.tbUsuario u ON ba.IdUsuario = u.IdUsuario
            ${where}
        `)).recordset[0].total;

        // datos
        const r2 = pool.request();
        // repetir params
        r2.parameters = r.parameters;
        r2.input('offset', sql.Int, offset);
        r2.input('limit', sql.Int, limitNum);

        const rows = (await r2.query(`
      SELECT ba.IdAcceso, ba.FechaHora, ba.Usuario, ba.IdUsuario, ba.Resultado, u.Rol
      FROM seg.tbBitacoraAcceso ba
      INNER JOIN seg.tbUsuario u ON ba.IdUsuario = u.IdUsuario
      ${where}
      ORDER BY ba.FechaHora DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `)).recordset;

        res.json({
            success: true,
            data: rows.map(x => ({
                id: x.IdAcceso,
                fechaHora: x.FechaHora,
                usuario: x.Usuario,
                idUsuario: x.IdUsuario,
                estado: x.Resultado,
                rol: x.Rol || 'N/A'
            })),
            pagination: {
                currentPage: pageNum,
                itemsPerPage: limitNum,
                totalItems: total,
                totalPages: Math.ceil(total / limitNum),
                hasNextPage: pageNum * limitNum < total,
                hasPrevPage: pageNum > 1
            },
            filters: { usuario, estado, fechaInicio, fechaFin }
        });
    } catch (err) {
        console.error('Error bitÃ¡cora accesos:', err);
        res.status(500).json({ success: false, message: 'Error obteniendo bitÃ¡cora de accesos' });
    }
});

app.get('/api/bitacora/transacciones', async (req, res) => {
    try {
        const {
            usuario = '', accion = '', tabla = '', fechaInicio = '', fechaFin = '',
            page = 1, limit = 10
        } = req.query;
        const pool = await getPool();
        let where = 'WHERE 1=1';
        const r = pool.request();

        if (usuario.trim()) {
            where += ' AND (Usuario LIKE @usuario)';
            r.input('usuario', sql.VarChar(100), `%${usuario.trim()}%`);
        }
        if (accion.trim()) {
            where += ' AND (Operacion = @op)';
            r.input('op', sql.VarChar(30), accion.trim().toUpperCase());
        }
        if (tabla.trim()) {
            where += ' AND (Entidad = @ent)';
            r.input('ent', sql.VarChar(30), tabla.trim());
        }
        if (fechaInicio) {
            where += ' AND FechaHora >= @fi';
            r.input('fi', sql.DateTime2, new Date(fechaInicio));
        }
        if (fechaFin) {
            where += ' AND FechaHora < DATEADD(day,1,@ff)';
            r.input('ff', sql.DateTime2, new Date(fechaFin));
        }

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        const total = (await r.query(`SELECT COUNT(*) total FROM seg.tbBitacoraTransacciones ${where}`)).recordset[0].total;

        const r2 = pool.request();
        r2.parameters = r.parameters;
        r2.input('offset', sql.Int, offset);
        r2.input('limit', sql.Int, limitNum);

        const rows = (await r2.query(`
      SELECT IdTransaccion, FechaHora, Usuario, IdUsuario, Operacion, Entidad, ClaveEntidad, Detalle
      FROM seg.tbBitacoraTransacciones
      ${where}
      ORDER BY FechaHora DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `)).recordset;

        res.json({
            success: true,
            data: rows.map(x => ({
                id: x.IdTransaccion,
                fechaHora: x.FechaHora,
                usuario: x.Usuario,
                idUsuario: x.IdUsuario,
                operacion: x.Operacion,
                entidad: x.Entidad,
                clave: x.ClaveEntidad,
                detalle: x.Detalle
            })),
            pagination: {
                currentPage: pageNum,
                itemsPerPage: limitNum,
                totalItems: total,
                totalPages: Math.ceil(total / limitNum),
                hasNextPage: pageNum * limitNum < total,
                hasPrevPage: pageNum > 1
            },
            filters: { usuario, accion, tabla, fechaInicio, fechaFin }
        });
    } catch (err) {
        console.error('Error bitÃ¡cora transacciones:', err);
        res.status(500).json({ success: false, message: 'Error obteniendo bitÃ¡cora de transacciones' });
    }
});














// Endpoint para recuperaciÃ³n de Contrasena (generar Contrasena temporal)
app.post('/api/forgot-password', verifyRecaptcha, async (req, res) => {
    try {
        const { email } = req.body;

        console.log('ðŸ“§ Solicitud de recuperaciÃ³n de Contrasena para:', email);

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'El correo electrÃ³nico es requerido'
            });
        }
        const pool = await getPool();
        const request = pool.request();
        request.input('Correo', sql.VarChar(120), email);
        request.output('PasswordTemporal', sql.NVarChar(200));
        request.output('Mensaje', sql.NVarChar(200));

        const result = await request.execute('seg.sp_GenerarPasswordTemporal');

        const passwordTemporal = result.output.PasswordTemporal;
        const mensaje = result.output.Mensaje;

        if (result.returnValue === 0) {
            // Contrasena temporal generada exitosamente
            console.log('âœ… Contrasena temporal generada para:', email);

            // Obtener datos del usuario para el correo
            const userRequest = pool.request();
            userRequest.input('Correo', sql.VarChar(120), email);

            const userResult = await userRequest.query(`
                SELECT Nombres + ' ' + Apellidos AS NombreCompleto
                FROM seg.tbUsuario
                WHERE Correo = @Correo AND Estado = 1
            `);

            const nombreCompleto = userResult.recordset.length > 0
                ? userResult.recordset[0].NombreCompleto
                : 'Usuario';

            // Enviar correo electrÃ³nico con Brevo
            const emailResult = await sendBrevoEmail(email, passwordTemporal);

            if (emailResult.success) {
                console.log('ðŸ“¬ Correo enviado exitosamente');

                // NUNCA mostrar la Contrasena en la respuesta por seguridad
                return res.json({
                    success: true,
                    message: 'Si el correo estÃ¡ registrado, se ha enviado una Contrasena temporal. Revisa tu bandeja de entrada.'
                });
            } else {
                console.error('âŒ Error enviando correo:', emailResult.error);
                return res.status(500).json({
                    success: false,
                    message: 'Contrasena temporal generada, pero hubo un error enviando el correo'
                });
            }

        } else {
            // Error generando Contrasena temporal (no revelar si el correo existe)
            console.log('âŒ Error generando Contrasena temporal:', mensaje);

            // Respuesta genÃ©rica por seguridad - no revelar si el correo existe
            return res.json({
                success: true,
                message: 'Si el correo estÃ¡ registrado, se ha enviado una Contrasena temporal. Revisa tu bandeja de entrada.'
            });
        }

    } catch (error) {
        console.error('âŒ Error en recuperaciÃ³n de Contrasena:', error);
        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Inicializar el servidor
async function startServer() {
    try {
        // Probar conexiÃ³n a la base de datos
        console.log('Conectando a SQL Server...');
        const p = await getPool();
        pool = p;
        console.log('Conexion a SQL Server establecida');

        // Iniciar servidor
        app.listen(PORT, () => {
            console.log('Servidor corriendo en http://localhost:' + PORT);
            console.log('Base de datos conectada');
            console.log('reCAPTCHA habilitado en login y recuperacion de contrasena');
        });

    } catch (error) {
        console.error('âŒ Error al iniciar el servidor:', error);
        process.exit(1);
    }
}

// Manejo de errores de conexiÃ³n
process.on('SIGINT', async () => {
    console.log('\nCerrando servidor...');
    if (pool) {
        await pool.close();
    }
    process.exit(0);
});


startServer();

// Ruta de salud para verificar servidor y rutas cargadas
app.get('/api/health', (_req, res) => {
  try {
    const routes = [];
    res.json({ ok: true, routesHint: {
      ventas: ['/api/ventas (POST)', '/api/ventas/bitacora (GET)', '/api/ventas/:id (GET)']
    }});
  } catch (_) { res.json({ ok: true }); }
});






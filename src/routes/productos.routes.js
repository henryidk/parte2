const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/productos.controller');
const { getPool, sql } = require('../db/pool');

const router = express.Router();

// Rate limit solo para creación
const createLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

// Validación básica
function validateCreate(req, res, next) {
  const { nombre, precioCosto, precioVenta, descuento, cantidad } = req.body || {};
  if (!nombre || precioCosto == null || precioVenta == null) {
    return res.status(400).json({ success: false, message: 'nombre, precioCosto y precioVenta son requeridos' });
  }
  const costo = Number(precioCosto), venta = Number(precioVenta);
  if (!Number.isFinite(costo) || costo <= 0) return res.status(400).json({ success: false, message: 'precioCosto debe ser mayor a 0' });
  if (!Number.isFinite(venta) || venta <= 0) return res.status(400).json({ success: false, message: 'precioVenta debe ser mayor a 0' });
  const desc = descuento == null ? 0 : Number(descuento);
  if (!Number.isFinite(desc) || desc < 0 || desc > 100) return res.status(400).json({ success: false, message: 'descuento debe estar entre 0 y 100' });
  const cant = cantidad == null ? 0 : Number(cantidad);
  if (!Number.isFinite(cant) || cant < 0) return res.status(400).json({ success: false, message: 'cantidad debe ser >= 0' });
  next();
}

router.post('/', createLimiter, validateCreate, controller.createProducto);
router.get('/', controller.listProductos);
// Rutas específicas deben ir antes de rutas con parámetros
// Sugerencias (debe ir antes de '/:codigo')
router.get('/suggest', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ success: true, items: [] });
    const pool = await getPool();
    const r = pool.request();
    r.input('q', sql.VarChar(160), q);
    r.input('qp', sql.VarChar(160), `${q}%`);
    r.input('qc', sql.VarChar(160), `%${q}%`);
    const rows = (await r.query(`
      SELECT TOP 8 IdProducto, Codigo, Nombre, Cantidad,
        CASE
          WHEN Codigo = @q OR Nombre = @q THEN 0
          WHEN Codigo LIKE @qp THEN 1
          WHEN Nombre LIKE @qp THEN 2
          WHEN Codigo LIKE @qc THEN 3
          ELSE 4
        END AS score
      FROM inv.productos
      WHERE (Codigo = @q OR Nombre = @q OR Codigo LIKE @qp OR Nombre LIKE @qp OR Codigo LIKE @qc OR Nombre LIKE @qc)
      ORDER BY score, Nombre
    `)).recordset;
    return res.json({ success: true, items: rows.map(x => ({ id: x.IdProducto, code: x.Codigo, name: x.Nombre, stock: Number(x.Cantidad) })) });
  } catch (err) {
    console.error('productos/suggest error:', err);
    return res.status(500).json({ success: false, message: 'Error obteniendo sugerencias' });
  }
});

router.get('/catalogo/categorias', controller.getCategorias);
router.get('/catalogo/categorias/detalle', controller.getCategoriasDetalle);
router.post('/catalogo/categorias', controller.createCategoria);
router.put('/catalogo/categorias/:id', controller.updateCategoria);
router.delete('/catalogo/categorias/:id', controller.deleteCategoria);
router.get('/:codigo', controller.getProducto);
router.put('/:codigo', controller.updateProducto);
router.delete('/:codigo', controller.deleteProducto);

module.exports = router;

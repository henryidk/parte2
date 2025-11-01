const service = require('../services/productos.service');

async function createProducto(req, res) {
  try {
    const data = await service.createProducto(req.body || {});
    return res.json({ success: true, message: 'Producto creado', product: data });
  } catch (err) {
    if (err && err.code === 'PRODUCT_CODE_EXISTS') {
      return res.status(409).json({ success: false, message: 'El cÃ³digo de producto ya existe' });
    }
    console.error('createProducto error:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

async function listProductos(req, res) {
  try {
    const { page = 1, limit = 10, search = '', estado = '', categoria = '' } = req.query;
    const result = await service.listProductos({ page, limit, search, estado, categoria });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('listProductos error:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

async function getProducto(req, res) {
  try {
    const { codigo } = req.params;
    if (!codigo) return res.status(400).json({ success: false, message: 'CÃ³digo requerido' });
    const prod = await service.getProductoByCodigo(codigo);
    if (!prod) return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    return res.json({ success: true, product: prod });
  } catch (err) {
    console.error('getProducto error:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

async function updateProducto(req, res) {
  try {
    const { codigo } = req.params;
    if (!codigo) return res.status(400).json({ success: false, message: 'CÃ³digo requerido' });
    const { nombre, precioCosto, precioVenta, cantidad, categorias } = req.body || {};

    // Validaciones bÃ¡sicas
    const updates = {};
    if (typeof nombre === 'string') updates.nombre = nombre;
    if (precioCosto != null) {
      const v = Number(precioCosto); if (!Number.isFinite(v) || v < 0) return res.status(400).json({ success:false, message:'precioCosto invÃ¡lido' });
      updates.precioCosto = v;
    }
    if (precioVenta != null) {
      const v = Number(precioVenta); if (!Number.isFinite(v) || v < 0) return res.status(400).json({ success:false, message:'precioVenta invÃ¡lido' });
      updates.precioVenta = v;
    }
    if (cantidad != null) {
      const v = Number(cantidad); if (!Number.isInteger(v) || v < 0) return res.status(400).json({ success:false, message:'cantidad invÃ¡lida' });
      updates.cantidad = v;
    }
    let cats = [];
    if (Array.isArray(categorias)) cats = categorias.filter(x => typeof x === 'string' && x.trim()).map(s => s.trim());

    const result = await service.updateProductoByCodigo({ codigo, ...updates, categorias: cats.length ? cats : undefined });
    return res.json({ success: true, message: 'Producto actualizado', product: result });
  } catch (err) {
    console.error('updateProducto error:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

async function getCategorias(req, res) {
  try {
    const cats = await service.getCategorias();
    return res.json({ success: true, categorias: cats });
  } catch (err) {
    console.error('getCategorias error:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

async function deleteProducto(req, res) {
  try {
    const { codigo } = req.params;
    if (!codigo) return res.status(400).json({ success: false, message: 'CÃ³digo requerido' });
    await service.deleteProductoByCodigo(codigo);
    return res.json({ success: true, message: 'Producto eliminado' });
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }
    console.error('deleteProducto error:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

module.exports = { createProducto, listProductos, getProducto, updateProducto, getCategorias, deleteProducto, createCategoria };

async function createCategoria(req, res) {
  try {
    const { nombre, identificador, descripcion } = req.body || {};
    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return res.status(400).json({ success: false, message: 'El nombre es requerido' });
    }
    const result = await service.createCategoria({ nombre: nombre.trim(), identificador: (identificador || '').trim(), descripcion: (descripcion || '').trim() });
    return res.status(201).json({ success: true, categoria: result });
  } catch (err) {
    if (err && err.code === 'CATEGORY_EXISTS') {
      return res.status(409).json({ success: false, message: 'La categoria ya existe' });
    }
    console.error('createCategoria error:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

const { getPool: getDbPool, sql } = require('../db/pool');

// Pool de BD centralizado en ../db/pool (getDbPool)

function generateCode(nombre) {
  const base = (nombre || 'PRD').toString().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 8) || 'PRD';
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}-${suffix}`;
}

async function createProducto({ codigo, nombre, categorias = null, precioCosto, precioVenta, cantidad = 0, usuarioEjecutor = 'sistema' }) {
  const finalCode = (codigo && typeof codigo === 'string' && codigo.trim()) ? codigo.trim() : generateCode(nombre);
  const p = await getDbPool();

  const exists = await p.request().input('Codigo', sql.VarChar(50), finalCode)
    .query('SELECT 1 FROM inv.productos WHERE Codigo = @Codigo');
  if (exists.recordset.length > 0) {
    const e = new Error('CÃ³digo ya existe');
    e.code = 'PRODUCT_CODE_EXISTS';
    throw e;
  }

  const req = p.request();
  req.input('Nombre', sql.VarChar(150), nombre);
  req.input('Codigo', sql.VarChar(50), finalCode);
  const cats = Array.isArray(categorias) ? categorias.join(';') : (categorias || null);
  req.input('Categorias', sql.NVarChar(200), cats);
  req.input('PrecioCosto', sql.Decimal(18, 2), Number(precioCosto));
  req.input('PrecioVenta', sql.Decimal(18, 2), Number(precioVenta));
  req.input('Cantidad', sql.Int, Number(cantidad || 0));
  await req.query(`
    INSERT INTO inv.productos (Nombre, Codigo, Categorias, PrecioCosto, PrecioVenta, Cantidad)
    VALUES (@Nombre, @Codigo, @Categorias, @PrecioCosto, @PrecioVenta, @Cantidad)
  `);

  const row = (await p.request().input('Codigo', sql.VarChar(50), finalCode).query(`
    SELECT TOP 1 IdProducto, Nombre, Codigo, Categorias, PrecioCosto, PrecioVenta, Cantidad, Estado
    FROM inv.productos WHERE Codigo = @Codigo
  `)).recordset[0];

  // BitÃ¡cora (opcional)
  try {
    await p.request()
      .input('Usuario', sql.VarChar(50), usuarioEjecutor || 'sistema')
      .input('IdUsuario', sql.Int, -1)
      .input('Operacion', sql.VarChar(40), 'INSERT')
      .input('Entidad', sql.VarChar(40), 'inv.productos')
      .input('ClaveEntidad', sql.VarChar(100), String(row.IdProducto))
      .input('Detalle', sql.NVarChar(4000), `Alta de producto ${row.Codigo} - ${row.Nombre}`)
      .query(`INSERT INTO seg.tbBitacoraTransacciones(Usuario, IdUsuario, Operacion, Entidad, ClaveEntidad, Detalle)
              VALUES (@Usuario, @IdUsuario, @Operacion, @Entidad, @ClaveEntidad, @Detalle)`);
  } catch (_) {}

  return {
    id: row.IdProducto,
    codigo: row.Codigo,
    nombre: row.Nombre,
    categorias: row.Categorias,
    precioCosto: Number(row.PrecioCosto),
    precioVenta: Number(row.PrecioVenta),
    cantidad: Number(row.Cantidad),
    estado: row.Estado
  };
}

async function listProductos({ page = 1, limit = 10, search = '', estado = '', categoria = '' }) {
  const p = await getDbPool();
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const view = 'inv.v_productos';
  const from = `FROM ${view} v`;
  const whereParts = ['1=1'];
  const params = [];
  if (search && String(search).trim()) {
    whereParts.push('(v.Nombre LIKE @s OR v.Codigo LIKE @s)');
    params.push({ name: 's', type: sql.VarChar(160), value: `%${String(search).trim()}%` });
  }
  if (estado && String(estado).trim()) {
    whereParts.push('v.Estado = @e');
    params.push({ name: 'e', type: sql.VarChar(20), value: String(estado).trim() });
  }
  if (categoria && String(categoria).trim()) {
    const cval = String(categoria).trim();
    if (cval === '__NONE__') {
      // Productos sin categorÃ­as asociadas (relaciÃ³n M:N)
      whereParts.push(`NOT EXISTS (
          SELECT 1 FROM inv.producto_categoria pc WHERE pc.IdProducto = v.IdProducto
        )`);
    } else {
      // Filtro robusto: existencia en la relaciÃ³n M:N por nombre exacto
      whereParts.push(`EXISTS (
          SELECT 1
          FROM inv.producto_categoria pc
          JOIN inv.categorias c ON c.IdCategoria = pc.IdCategoria
          WHERE pc.IdProducto = v.IdProducto AND LOWER(CONVERT(VARCHAR(100), c.Nombre COLLATE Latin1_General_CI_AI)) = LOWER(CONVERT(VARCHAR(100), @c COLLATE Latin1_General_CI_AI))
        )`);
      params.push({ name: 'c', type: sql.VarChar(100), value: cval });
    }
  }
  const where = `WHERE ${whereParts.join(' AND ')}`;

  // Count desde la vista (incluye columnas agregadas como Categorias)
  const countReq = p.request();
  params.forEach(pr => countReq.input(pr.name, pr.type, pr.value));
  const total = (await countReq.query(`SELECT COUNT(*) total ${from} ${where}`)).recordset[0].total;

  // Page
  const dataReq = p.request();
  params.forEach(pr => dataReq.input(pr.name, pr.type, pr.value));
  dataReq.input('offset', sql.Int, offset);
  dataReq.input('limit', sql.Int, limitNum);
  const rows = (await dataReq.query(`
    SELECT v.IdProducto, v.Nombre, v.Codigo, v.Categorias, v.PrecioCosto, v.PrecioVenta, v.Cantidad, v.Estado
    ${from}
    ${where}
    ORDER BY CASE WHEN (v.Categorias IS NULL OR LTRIM(RTRIM(v.Categorias)) = '') THEN 1 ELSE 0 END,
             v.IdProducto DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `)).recordset;

  return {
    data: rows,
    pagination: {
      currentPage: pageNum,
      itemsPerPage: limitNum,
      totalItems: total,
      totalPages: Math.ceil(total / limitNum),
      hasNextPage: pageNum * limitNum < total,
      hasPrevPage: pageNum > 1
    }
  };
}

async function getProductoByCodigo(codigo) {
  const p = await getDbPool();
  const view = 'inv.v_productos';
  const r = await p.request()
    .input('Codigo', sql.VarChar(50), String(codigo || '').trim())
    .query(`SELECT TOP 1 IdProducto, Codigo, Nombre, Categorias, PrecioCosto, PrecioVenta, Descuento, Cantidad, Estado
            FROM ${view} WHERE Codigo = @Codigo`);
  if (r.recordset.length === 0) return null;
  const row = r.recordset[0];
  // Normalizar categorÃ­as a array
  const cats = (row.Categorias && typeof row.Categorias === 'string')
    ? row.Categorias.split(/[;|,]/).map(s => s.trim()).filter(Boolean)
    : [];
  return {
    id: row.IdProducto,
    codigo: row.Codigo,
    nombre: row.Nombre,
    categorias: cats,
    precioCosto: Number(row.PrecioCosto),
    precioVenta: Number(row.PrecioVenta),
    descuento: (row.Descuento != null ? Number(row.Descuento) : 0),
    cantidad: Number(row.Cantidad),
    estado: row.Estado
  };
}

async function getCategorias() {
  const p = await getDbPool();
  const rows = (await p.request().query(`
      SELECT Nombre FROM inv.categorias ORDER BY Nombre ASC
  `)).recordset;
  return rows.map(r => r.Nombre);
}

async function createCategoria({ nombre, identificador = '', descripcion = '' }) {
  const p = await getDbPool();
  const name = String(nombre || '').trim();
  const ident = String(identificador || '').trim();
  const descr = String(descripcion || '').trim();

  // Duplicado por nombre (case-insensitive)
  const dup = await p.request()
    .input('Nombre', sql.VarChar(150), name)
    .query('SELECT 1 FROM inv.categorias WHERE LOWER(Nombre) = LOWER(@Nombre)');
  if (dup.recordset.length > 0) { const e = new Error('Categoria existente'); e.code = 'CATEGORY_EXISTS'; throw e; }

  // Detectar columnas opcionales
  const meta = await p.request().query("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('inv.categorias')");
  const colNames = new Set(meta.recordset.map(r => (r.name || '').toString().toLowerCase()));
  const hasDescripcion = colNames.has('descripcion');
  const slugCol = ['identificador','slug','codigo','idexterno'].find(c => colNames.has(c));

  // Construir INSERT dinamico seguro
  const cols = ['Nombre'];
  const values = ['@Nombre'];
  const req = p.request();
  req.input('Nombre', sql.VarChar(150), name);
  if (hasDescripcion && descr) { cols.push('Descripcion'); values.push('@Descripcion'); req.input('Descripcion', sql.NVarChar(300), descr); }
  if (slugCol && ident) { cols.push(slugCol); values.push('@Ident'); req.input('Ident', sql.VarChar(150), ident); }
  await req.query(`INSERT INTO inv.categorias (${cols.join(',')}) VALUES (${values.join(',')})`);

  return { nombre: name, identificador: ident, descripcion: descr };
}

async function getCategoriasDetalle() {
  const p = await getDbPool();
  // Detectar columnas opcionales de inv.categorias
  const meta = await p.request().query("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('inv.categorias')");
  const colNames = new Set(meta.recordset.map(r => (r.name || '').toString().toLowerCase()));
  const hasDescripcion = colNames.has('descripcion');
  const slugCol = ['identificador','slug','codigo','idexterno'].find(c => colNames.has(c));

  const selectCols = ["c.IdCategoria AS IdCategoria", "c.Nombre AS Nombre"];
  const groupCols = ["c.IdCategoria", "c.Nombre"];
  if (hasDescripcion) { selectCols.push("c.Descripcion AS Descripcion"); groupCols.push("c.Descripcion"); }
  if (slugCol) { selectCols.push(`c.${slugCol} AS Identificador`); groupCols.push(`c.${slugCol}`); }

  const sqlText = `SELECT ${selectCols.join(', ')}, COUNT(pc.IdProducto) AS ProductsCount
                   FROM inv.categorias c
                   LEFT JOIN inv.producto_categoria pc ON pc.IdCategoria = c.IdCategoria
                   GROUP BY ${groupCols.join(', ')}
                   ORDER BY c.Nombre ASC`;
  const rows = (await p.request().query(sqlText)).recordset;
  return rows.map(r => ({
    id: r.IdCategoria,
    name: r.Nombre,
    description: r.Descripcion ?? '',
    identificador: r.Identificador ?? '',
    productsCount: Number(r.ProductsCount || 0)
  }));
}

async function updateProductoByCodigo({ codigo, nombre, precioCosto, precioVenta, descuento, cantidad, categorias }) {
  const p = await getDbPool();
  const code = String(codigo || '').trim();
  // Obtener IdProducto
  const prod = await p.request().input('Codigo', sql.VarChar(50), code)
    .query('SELECT TOP 1 IdProducto FROM inv.productos WHERE Codigo = @Codigo');
  if (prod.recordset.length === 0) {
    const e = new Error('Producto no encontrado'); e.code = 'NOT_FOUND'; throw e;
  }
  const idProd = prod.recordset[0].IdProducto;

  // Actualizar campos bÃ¡sicos si vienen
  const setParts = [];
  const reqUpd = p.request();
  reqUpd.input('IdProducto', sql.Int, idProd);
  if (typeof nombre === 'string') { setParts.push('Nombre = @Nombre'); reqUpd.input('Nombre', sql.VarChar(150), nombre); }
  if (precioCosto != null) { setParts.push('PrecioCosto = @PrecioCosto'); reqUpd.input('PrecioCosto', sql.Decimal(18,2), Number(precioCosto)); }
  if (precioVenta != null) { setParts.push('PrecioVenta = @PrecioVenta'); reqUpd.input('PrecioVenta', sql.Decimal(18,2), Number(precioVenta)); }
  if (descuento != null) { setParts.push('Descuento = @Descuento'); reqUpd.input('Descuento', sql.Decimal(5,2), Number(descuento)); }
  if (cantidad != null) { setParts.push('Cantidad = @Cantidad'); reqUpd.input('Cantidad', sql.Int, Number(cantidad)); }

  // Si vienen categorÃ­as, sincronizar relaciÃ³n M:N
  let finalCats = null;
  if (Array.isArray(categorias)) {
    // Mapear nombres a IdCategoria
    const names = categorias.map(s => s.trim()).filter(Boolean);
    if (names.length) {
      const inList = names.map((_, i) => `@N${i}`).join(',');
      const reqCats = p.request();
      names.forEach((n, i) => reqCats.input(`N${i}`, sql.VarChar(100), n));
      const catRows = (await reqCats.query(`SELECT IdCategoria, Nombre FROM inv.categorias WHERE Nombre IN (${inList})`)).recordset;
      const idMap = new Map(catRows.map(r => [r.Nombre.toLowerCase(), r.IdCategoria]));
      const desiredIds = new Set(names.map(n => idMap.get(n.toLowerCase())).filter(v => v));

      // Obtener actuales
      const currentRows = (await p.request().input('IdProducto', sql.Int, idProd)
        .query('SELECT IdCategoria FROM inv.producto_categoria WHERE IdProducto = @IdProducto')).recordset;
      const currentIds = new Set(currentRows.map(r => r.IdCategoria));

      // Inserts
      for (const idCat of desiredIds) {
        if (!currentIds.has(idCat)) {
          await p.request().input('IdProducto', sql.Int, idProd).input('IdCategoria', sql.Int, idCat)
            .query('INSERT INTO inv.producto_categoria(IdProducto, IdCategoria) VALUES(@IdProducto, @IdCategoria)');
        }
      }
      // Deletes
      for (const idCat of currentIds) {
        if (!desiredIds.has(idCat)) {
          await p.request().input('IdProducto', sql.Int, idProd).input('IdCategoria', sql.Int, idCat)
            .query('DELETE FROM inv.producto_categoria WHERE IdProducto=@IdProducto AND IdCategoria=@IdCategoria');
        }
      }
      finalCats = names; // Para reflejar en columna de texto
    } else {
      // Si viene array vacÃ­o, limpiar asociaciones
      await p.request().input('IdProducto', sql.Int, idProd)
        .query('DELETE FROM inv.producto_categoria WHERE IdProducto=@IdProducto');
      finalCats = [];
    }
  }

  // Sincronizar columna de texto Categorias si corresponde
  if (finalCats) {
    setParts.push('Categorias = @Categorias');
    reqUpd.input('Categorias', sql.NVarChar(200), finalCats.join('; '));
  }
  if (setParts.length) {
    await reqUpd.query(`UPDATE inv.productos SET ${setParts.join(', ')} WHERE IdProducto = @IdProducto`);
  }

  // Devolver el producto actualizado desde la vista
  const updated = await getProductoByCodigo(code);
  return updated;
}

async function deleteProductoByCodigo(codigo) {
  const p = await getDbPool();
  const code = String(codigo || '').trim();
  // Obtener IdProducto
  const prod = await p.request().input('Codigo', sql.VarChar(50), code)
    .query('SELECT TOP 1 IdProducto, Nombre FROM inv.productos WHERE Codigo = @Codigo');
  if (prod.recordset.length === 0) {
    const e = new Error('Producto no encontrado'); e.code = 'NOT_FOUND'; throw e;
  }
  const idProd = prod.recordset[0].IdProducto;
  const nombre = prod.recordset[0].Nombre;

  // Eliminar relaciones M:N primero
  await p.request().input('IdProducto', sql.Int, idProd)
    .query('DELETE FROM inv.producto_categoria WHERE IdProducto = @IdProducto');

  // Eliminar producto
  await p.request().input('IdProducto', sql.Int, idProd)
    .query('DELETE FROM inv.productos WHERE IdProducto = @IdProducto');

  // BitÃ¡cora (best-effort)
  try {
    await p.request()
      .input('Usuario', sql.VarChar(50), 'sistema')
      .input('IdUsuario', sql.Int, -1)
      .input('Operacion', sql.VarChar(40), 'DELETE')
      .input('Entidad', sql.VarChar(40), 'inv.productos')
      .input('ClaveEntidad', sql.VarChar(100), String(idProd))
      .input('Detalle', sql.NVarChar(4000), `Baja de producto ${code} - ${nombre}`)
      .query(`INSERT INTO seg.tbBitacoraTransacciones(Usuario, IdUsuario, Operacion, Entidad, ClaveEntidad, Detalle)
              VALUES (@Usuario, @IdUsuario, @Operacion, @Entidad, @ClaveEntidad, @Detalle)`);
  } catch (_) {}

  return { codigo: code, id: idProd };
}

module.exports = { createProducto, listProductos, getProductoByCodigo, updateProductoByCodigo, getCategorias, deleteProductoByCodigo, createCategoria, getCategoriasDetalle };


async function updateCategoria({ id, nombre, descripcion = '' }) {
  const p = await getDbPool();
  const catId = parseInt(id);
  if (!catId) { const e = new Error('Id invalido'); e.code = 'NOT_FOUND'; throw e; }
  const name = String(nombre || '').trim();
  const descr = String(descripcion || '').trim();

  // Verificar que exista
  const exists = await p.request().input('Id', sql.Int, catId)
    .query('SELECT TOP 1 IdCategoria FROM inv.categorias WHERE IdCategoria = @Id');
  if (exists.recordset.length === 0) { const e = new Error('Categoria no existe'); e.code = 'NOT_FOUND'; throw e; }

  // Duplicado por nombre insensible a acentos/case, excluyendo el propio id
  const dup = await p.request()
    .input('Id', sql.Int, catId)
    .input('Nombre', sql.VarChar(150), name)
    .query("SELECT 1 FROM inv.categorias WHERE IdCategoria <> @Id AND LOWER(CONVERT(VARCHAR(100), Nombre COLLATE Latin1_General_CI_AI)) = LOWER(CONVERT(VARCHAR(100), @Nombre COLLATE Latin1_General_CI_AI))");
  if (dup.recordset.length > 0) { const e = new Error('Categoria existente'); e.code = 'CATEGORY_EXISTS'; throw e; }

  // Detectar columnas opcionales
  const meta = await p.request().query("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('inv.categorias')");
  const colNames = new Set(meta.recordset.map(r => (r.name || '').toString().toLowerCase()));
  const hasDescripcion = colNames.has('descripcion');

  const req = p.request();
  req.input('Id', sql.Int, catId);
  req.input('Nombre', sql.VarChar(150), name);
  let setParts = ['Nombre = @Nombre'];
  if (hasDescripcion) { req.input('Descripcion', sql.NVarChar(300), descr); setParts.push('Descripcion = @Descripcion'); }
  await req.query(`UPDATE inv.categorias SET ${setParts.join(', ')} WHERE IdCategoria = @Id`);

  return { id: catId, nombre: name, descripcion: descr };
}

async function deleteCategoria(id) {
  const p = await getDbPool();
  const catId = parseInt(id);
  if (!catId) { const e = new Error('Id invalido'); e.code = 'NOT_FOUND'; throw e; }
  const ex = await p.request().input('Id', sql.Int, catId)
    .query('SELECT 1 FROM inv.categorias WHERE IdCategoria = @Id');
  if (ex.recordset.length === 0) { const e = new Error('Categoria no existe'); e.code = 'NOT_FOUND'; throw e; }
  // Borrar asociaciones M:N
  await p.request().input('Id', sql.Int, catId)
    .query('DELETE FROM inv.producto_categoria WHERE IdCategoria = @Id');
  // Borrar categoria
  await p.request().input('Id', sql.Int, catId)
    .query('DELETE FROM inv.categorias WHERE IdCategoria = @Id');
  return { id: catId };
}

module.exports.updateCategoria = updateCategoria;
module.exports.deleteCategoria = deleteCategoria;

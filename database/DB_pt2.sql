/* =========================================================
   DB_parte2 – Script completo con DESCUENTO (%) fijo en semillas
   (SQL Server)
   - Crea DB y esquemas
   - INVENTARIO (inv): productos, categorías, M:N, vista
   - SEGURIDAD (seg): usuarios, funciones, SPs, bitácoras
   - Roles, permisos y usuarios iniciales
   - Estados de stock actualizados (0 / <25 / 25-49 / >=50)
   ========================================================= */

------------------------------------------------------------
-- 0) Crear/usar base de datos
------------------------------------------------------------
IF DB_ID('DB_parte2') IS NULL
    CREATE DATABASE DB_parte2;
GO
USE DB_parte2;
GO

/* =========================================================
   SECCIÓN A) INVENTARIO
   ========================================================= */

------------------------------------------------------------
-- A.1) Esquema inv
------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'inv')
    EXEC('CREATE SCHEMA inv');
GO

------------------------------------------------------------
-- A.2) Tabla base: inv.productos
--     Incluye DESCUENTO (%) y PrecioVentaNeto (calculado)
------------------------------------------------------------
IF OBJECT_ID('inv.productos') IS NOT NULL
    DROP TABLE inv.productos;
GO

CREATE TABLE inv.productos
(
    IdProducto     INT IDENTITY(1,1) PRIMARY KEY,
    Codigo         VARCHAR(50)  NOT NULL,
    Nombre         VARCHAR(150) NOT NULL,
    -- Texto libre; relación formal va en la tabla puente
    Categorias     NVARCHAR(200) NULL,
    PrecioCosto    DECIMAL(18,2) NOT NULL,
    PrecioVenta    DECIMAL(18,2) NOT NULL,
    Descuento      DECIMAL(5,2)  NOT NULL 
                     CONSTRAINT DF_inv_productos_Descuento DEFAULT (0),
    Cantidad       INT NOT NULL CONSTRAINT DF_inv_productos_Cantidad DEFAULT(0)
);

-- Reglas
ALTER TABLE inv.productos
  ADD CONSTRAINT CK_inv_productos_Cantidad_NoNegativa CHECK (Cantidad >= 0);

ALTER TABLE inv.productos
  ADD CONSTRAINT CK_inv_productos_Descuento_0_100 CHECK (Descuento >= 0 AND Descuento <= 100);

-- Columna calculada de Estado (nuevos umbrales)
ALTER TABLE inv.productos
ADD Estado AS (
    CASE
        WHEN Cantidad = 0 THEN 'Sin existencias'
        WHEN Cantidad > 0 AND Cantidad < 25 THEN 'Stock critico'
        WHEN Cantidad >= 25 AND Cantidad < 50 THEN 'Stock bajo'
        ELSE 'Stock'
    END
) PERSISTED;

-- Precio de venta neto con descuento aplicado (persistido)
ALTER TABLE inv.productos
  ADD PrecioVentaNeto AS (ROUND(PrecioVenta * (1 - (Descuento / 100.0)), 2)) PERSISTED;

-- Índices
CREATE UNIQUE INDEX UX_inv_productos_Codigo ON inv.productos(Codigo);
CREATE INDEX IX_inv_productos_Estado ON inv.productos(Estado);
CREATE INDEX IX_inv_productos_Nombre ON inv.productos(Nombre);
GO

------------------------------------------------------------
-- A.3) Semillas de productos (30) con DESCUENTO fijo
--      (0 %, 10 %, 25 % y 50 % asignados explícitamente)
------------------------------------------------------------
-- Limpieza por si existiera data previa
DELETE FROM inv.productos;
GO

-- 15 CON CATEGORÍAS (texto libre)
INSERT INTO inv.productos (Codigo, Nombre, Categorias, PrecioCosto, PrecioVenta, Descuento, Cantidad) VALUES
('LAB-0021','Reactivo A-90','Laboratorio',                 22.40, 38.99, 10, 120), -- 10%
('TEC-0312','Calculadora científica FX','Tecnologia;Papelera',45.00, 69.90, 25,  85), -- 25%
('SER-0104','Licencia software CAD','Servicios;Tecnologia',180.00,245.00, 50,  30), -- 50%
('PAP-0718','Cuaderno profesional','Papelera',               1.60,  2.99,  0,   0), -- 0%
('LAB-0045','Pipeta automática 10ml','Laboratorio',         28.00, 46.50, 10,  40),
('EQU-0201','Kit de laboratorio básico','Equipamiento;Laboratorio',120.00,169.00,25,140),
('TEC-0205','Licencia ofimática anual','Tecnologia;Servicios',55.00, 89.00, 50,  55),
('SER-0208','Soporte técnico anual','Servicios',           200.00,280.00,  0,   0),
('PAP-0302','Resmas papel A4 premium','Papelera',            3.10,  5.40, 10, 102),
('LAB-0064','Bata laboratorio estándar','Laboratorio',      12.00, 19.90, 25,  70),
('TEC-0410','Sensor digital de pH','Tecnologia;Laboratorio',210.00,285.00,50,  25),
('EQU-0303','Microscopio escolar','Equipamiento',          260.00,349.00,  0,  95),
('LAB-0078','Caja porta-objetos','Laboratorio',              4.20,  7.99, 10,   0),
('PAP-0901','Marcadores permanentes set x12','Papelera',     6.80, 11.90, 25, 155),
('TEC-0511','Licencia software estadístico','Tecnologia',    98.00,139.00,50,  10);

-- 15 SIN CATEGORÍAS (NULL)
INSERT INTO inv.productos (Codigo, Nombre, Categorias, PrecioCosto, PrecioVenta, Descuento, Cantidad) VALUES
('GEN-1001','Kit seguridad ocular',      NULL,  8.50, 13.90,  0, 100),
('GEN-1002','Guantes de nitrilo',        NULL,  3.20,  5.40, 10,  48),
('GEN-1003','Limpiador isopropílico',    NULL,  2.10,  3.90, 25,   0),
('GEN-1004','Cinta masking 1"',          NULL,  0.80,  1.60, 50,  60),
('GEN-1005','Adaptador corriente 12V',   NULL,  6.20,  9.90,  0, 130),
('GEN-1006','Cable USB-C 1m',            NULL,  1.40,  2.90, 10,   0),
('GEN-1007','Balanza de precisión 1kg',  NULL, 85.00,119.00, 25,  44),
('GEN-1008','Switch 5 puertos',          NULL, 12.00, 19.90, 50,  52),
('GEN-1009','Alcohol gel 500ml',         NULL,  1.10,  2.40,  0, 200),
('GEN-1010','Etiquetas térmicas 57mm',   NULL,  0.60,  1.20, 10,   0),
('GEN-1011','Caja organizadora 10L',     NULL,  4.10,  7.90, 25,  88),
('GEN-1012','Pilas AA pack x4',          NULL,  1.50,  3.20, 50,   0),
('GEN-1013','Extensión eléctrica 3m',    NULL,  3.50,  6.90,  0,  35),
('GEN-1014','Tapete antiestático',       NULL, 14.00, 22.00, 10, 110),
('GEN-1015','Rotulador punta fina',      NULL,  0.70,  1.40, 25,  65);
GO

------------------------------------------------------------
-- A.4) Tabla inv.categorias
------------------------------------------------------------
IF OBJECT_ID('inv.categorias') IS NOT NULL
    DROP TABLE inv.producto_categoria; -- soltar FK antes
GO
IF OBJECT_ID('inv.categorias') IS NOT NULL
    DROP TABLE inv.categorias;
GO

CREATE TABLE inv.categorias
(
    IdCategoria   INT IDENTITY(1,1) PRIMARY KEY,
    Nombre        VARCHAR(100) NOT NULL,
    Identificador VARCHAR(50)  NOT NULL,
    Descripcion   NVARCHAR(250) NULL
);
CREATE UNIQUE INDEX UX_inv_categorias_Nombre        ON inv.categorias(Nombre);
CREATE UNIQUE INDEX UX_inv_categorias_Identificador ON inv.categorias(Identificador);
GO

-- Semillas de categorías
INSERT INTO inv.categorias (Nombre, Identificador, Descripcion) VALUES
('Laboratorio','laboratorio-1',N'Reactivos, material clínico y seguridad.'),
('Tecnologia','tecnologia-2',N'Equipos electrónicos y licencias.'),
('Papelera','papelera-3',N'Papelería especializada y de oficina.'),
('Servicios','servicios-4',N'Capacitaciones y soporte técnico.'),
('Equipamiento','equipamiento-5',N'Mobiliario y equipo de laboratorio.');
GO

------------------------------------------------------------
-- A.5) Relación M:N: inv.producto_categoria
------------------------------------------------------------
CREATE TABLE inv.producto_categoria
(
    IdProducto  INT NOT NULL,
    IdCategoria INT NOT NULL,
    CONSTRAINT PK_inv_producto_categoria PRIMARY KEY(IdProducto, IdCategoria),
    CONSTRAINT FK_inv_pc_producto  FOREIGN KEY(IdProducto)
        REFERENCES inv.productos(IdProducto)  ON DELETE CASCADE,
    CONSTRAINT FK_inv_pc_categoria FOREIGN KEY(IdCategoria)
        REFERENCES inv.categorias(IdCategoria) ON DELETE CASCADE
);
CREATE INDEX IX_inv_pc_IdCategoria ON inv.producto_categoria(IdCategoria);
GO

-- Asociaciones iniciales (mismas del archivo original)
INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='LAB-0021' AND c.Nombre='Laboratorio';

INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='TEC-0312' AND c.Nombre IN ('Tecnologia','Papelera');

INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='SER-0104' AND c.Nombre IN ('Servicios','Tecnologia');

INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='PAP-0718' AND c.Nombre='Papelera';

INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='LAB-0045' AND c.Nombre='Laboratorio';

INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='EQU-0201' AND c.Nombre IN ('Equipamiento','Laboratorio');

INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='TEC-0410' AND c.Nombre IN ('Tecnologia','Laboratorio');

INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='EQU-0303' AND c.Nombre='Equipamiento';

INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='LAB-0078' AND c.Nombre='Laboratorio';

INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='PAP-0901' AND c.Nombre='Papelera';

INSERT INTO inv.producto_categoria(IdProducto, IdCategoria)
SELECT p.IdProducto, c.IdCategoria
FROM inv.productos p CROSS JOIN inv.categorias c
WHERE p.Codigo='TEC-0511' AND c.Nombre='Tecnologia';
GO

------------------------------------------------------------
-- A.6) Vista inv.v_productos (incluye Descuento y Neto)
------------------------------------------------------------
IF OBJECT_ID('inv.v_productos','V') IS NOT NULL
    DROP VIEW inv.v_productos;
GO
CREATE VIEW inv.v_productos AS
SELECT
    p.IdProducto,
    p.Codigo,
    p.Nombre,
    p.PrecioCosto,
    p.PrecioVenta,
    p.Descuento,        -- %
    p.PrecioVentaNeto,  -- venta con descuento aplicado
    p.Cantidad,
    p.Estado,
    STRING_AGG(c.Nombre, '; ') WITHIN GROUP (ORDER BY c.Nombre) AS Categorias
FROM inv.productos p
LEFT JOIN inv.producto_categoria pc ON pc.IdProducto = p.IdProducto
LEFT JOIN inv.categorias c         ON c.IdCategoria = pc.IdCategoria
GROUP BY p.IdProducto, p.Codigo, p.Nombre, p.PrecioCosto, p.PrecioVenta,
         p.Descuento, p.PrecioVentaNeto, p.Cantidad, p.Estado;
GO

------------------------------------------------------------
-- A.7) Movimientos de inventario y SP de entradas
------------------------------------------------------------
IF OBJECT_ID('inv.movimientos_inventario') IS NOT NULL
    DROP TABLE inv.movimientos_inventario;
GO
CREATE TABLE inv.movimientos_inventario
(
    IdMovimiento   BIGINT IDENTITY(1,1) PRIMARY KEY,
    IdProducto     INT           NOT NULL,
    Codigo         VARCHAR(50)   NOT NULL,
    Cantidad       INT           NOT NULL CHECK (Cantidad > 0),
    FechaHora      DATETIME2(0)  NOT NULL CONSTRAINT DF_inv_mov_FH DEFAULT(SYSDATETIME()),
    Usuario        VARCHAR(50)   NULL,
    Referencia     NVARCHAR(250) NULL,
    CONSTRAINT FK_inv_mov_producto FOREIGN KEY(IdProducto)
        REFERENCES inv.productos(IdProducto)
        ON DELETE CASCADE
);
CREATE INDEX IX_inv_mov_Prod_Fecha ON inv.movimientos_inventario (IdProducto, FechaHora DESC);
CREATE INDEX IX_inv_mov_Codigo      ON inv.movimientos_inventario (Codigo);
GO

IF OBJECT_ID('inv.sp_RegistrarEntradaInventario') IS NOT NULL
    DROP PROCEDURE inv.sp_RegistrarEntradaInventario;
GO
CREATE PROCEDURE inv.sp_RegistrarEntradaInventario
    @Codigo     VARCHAR(50),
    @Cantidad   INT,
    @FechaHora  DATETIME2(0) = NULL,
    @Usuario    VARCHAR(50)  = NULL,
    @Referencia NVARCHAR(250) = NULL,
    @Mensaje    NVARCHAR(200) OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;

    IF (@Codigo IS NULL OR LTRIM(RTRIM(@Codigo)) = '') BEGIN
        SET @Mensaje = N'Código de producto requerido'; RETURN -10;
    END
    IF (@Cantidad IS NULL OR @Cantidad <= 0) BEGIN
        SET @Mensaje = N'Cantidad debe ser > 0'; RETURN -11;
    END

    DECLARE @IdProducto INT;
    SELECT TOP 1 @IdProducto = IdProducto
    FROM inv.productos WHERE Codigo = @Codigo;

    IF @IdProducto IS NULL BEGIN
        SET @Mensaje = N'Producto no encontrado'; RETURN -12;
    END

    IF @FechaHora IS NULL SET @FechaHora = SYSDATETIME();

    BEGIN TRAN;
        UPDATE inv.productos
        SET Cantidad = Cantidad + @Cantidad
        WHERE IdProducto = @IdProducto;

        INSERT INTO inv.movimientos_inventario
            (IdProducto, Codigo, Cantidad, FechaHora, Usuario, Referencia)
        VALUES
            (@IdProducto, @Codigo, @Cantidad, @FechaHora, @Usuario, @Referencia);
    COMMIT;

    SET @Mensaje = N'Entrada registrada';
    RETURN 0;
END
GO

/* =========================================================
   SECCIÓN B) SEGURIDAD / LOGIN
   (idéntica en funcionalidad a tu script original)
   ========================================================= */

------------------------------------------------------------
-- B.1) Esquema seg
------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'seg')
    EXEC('CREATE SCHEMA seg AUTHORIZATION dbo;');
GO

------------------------------------------------------------
-- B.2) Tablas principales y bitácoras
------------------------------------------------------------
IF OBJECT_ID('seg.tbUsuario') IS NOT NULL DROP TABLE seg.tbUsuario;
IF OBJECT_ID('seg.tbBitacoraAcceso') IS NOT NULL DROP TABLE seg.tbBitacoraAcceso;
IF OBJECT_ID('seg.tbBitacoraTransacciones') IS NOT NULL DROP TABLE seg.tbBitacoraTransacciones;
IF OBJECT_ID('seg.tbRecuperacionContrasena') IS NOT NULL DROP TABLE seg.tbRecuperacionContrasena;
GO

CREATE TABLE seg.tbUsuario
(
    IdUsuario            INT IDENTITY(1,1) PRIMARY KEY,
    Usuario              VARCHAR(50)   NOT NULL,
    Nombres              VARCHAR(100)  NOT NULL,
    Apellidos            VARCHAR(100)  NOT NULL,
    HashPassword         VARBINARY(32) NOT NULL,
    Salt                 VARBINARY(16) NOT NULL,
    Correo               VARCHAR(120)  NOT NULL,
    Rol                  VARCHAR(20)   NOT NULL CHECK (Rol IN ('admin','secretaria')),
    Estado               BIT           NOT NULL CONSTRAINT DF_tbUsuario_Estado DEFAULT(1),
    FechaCreacion        DATETIME2(0)  NOT NULL CONSTRAINT DF_tbUsuario_FC DEFAULT(SYSDATETIME()),
    UltimoCambioPass     DATETIME2(0)  NULL,
    EsPasswordTemporal   BIT           NOT NULL CONSTRAINT DF_tbUsuario_Temp DEFAULT(0),
    FechaExpiraPassword  DATETIME2(0)  NULL
);
GO

CREATE UNIQUE INDEX UX_tbUsuario_Usuario ON seg.tbUsuario(Usuario);
CREATE UNIQUE INDEX UX_tbUsuario_Correo  ON seg.tbUsuario(Correo);
GO

CREATE TABLE seg.tbBitacoraAcceso
(
    IdAcceso     BIGINT IDENTITY(1,1) PRIMARY KEY,
    IdUsuario    INT          NULL,
    Usuario      VARCHAR(50)  NULL,
    FechaHora    DATETIME2(0) NOT NULL CONSTRAINT DF_BitAcceso_FH DEFAULT(SYSDATETIME()),
    Resultado    VARCHAR(10)  NOT NULL CHECK (Resultado IN ('OK','FAIL'))
);
GO

CREATE TABLE seg.tbBitacoraTransacciones
(
    IdTx          BIGINT IDENTITY(1,1) PRIMARY KEY,
    Usuario       VARCHAR(50)  NOT NULL,
    IdUsuario     INT          NULL,
    FechaHora     DATETIME2(0) NOT NULL CONSTRAINT DF_BitTx_FH DEFAULT(SYSDATETIME()),
    Operacion     VARCHAR(40)  NOT NULL,
    Entidad       VARCHAR(60)  NOT NULL,
    ClaveEntidad  VARCHAR(120) NULL,
    Detalle       NVARCHAR(300) NULL
);
GO

CREATE TABLE seg.tbRecuperacionContrasena
(
    IdRec         BIGINT IDENTITY(1,1) PRIMARY KEY,
    IdUsuario     INT              NOT NULL,
    Token         UNIQUEIDENTIFIER NOT NULL,
    FechaCreacion DATETIME2(0)     NOT NULL CONSTRAINT DF_Rec_FC DEFAULT(SYSDATETIME()),
    FechaExpira   DATETIME2(0)     NOT NULL,
    Usado         BIT              NOT NULL CONSTRAINT DF_Rec_Usado DEFAULT(0)
);
GO

CREATE UNIQUE NONCLUSTERED INDEX UX_Recuperacion_Token ON seg.tbRecuperacionContrasena(Token);
CREATE NONCLUSTERED INDEX IX_Recuperacion_Vigente
ON seg.tbRecuperacionContrasena (IdUsuario, FechaCreacion DESC)
INCLUDE (FechaExpira, Token)
WHERE Usado = 0;
GO
CREATE NONCLUSTERED INDEX IX_tbUsuario_Rol_Estado
ON seg.tbUsuario (Rol, Estado)
INCLUDE (Usuario, Nombres, Apellidos, Correo, FechaCreacion);
GO
CREATE NONCLUSTERED INDEX IX_BitAcceso_IdUsuario_Fecha
ON seg.tbBitacoraAcceso (IdUsuario, FechaHora DESC)
INCLUDE (Resultado, Usuario);
GO
CREATE NONCLUSTERED INDEX IX_BitAcceso_FAIL
ON seg.tbBitacoraAcceso (Resultado)
INCLUDE (IdUsuario, FechaHora, Usuario)
WHERE Resultado='FAIL';
GO

------------------------------------------------------------
-- B.3) Funciones
------------------------------------------------------------
IF OBJECT_ID('seg.fn_IsPasswordStrong') IS NOT NULL DROP FUNCTION seg.fn_IsPasswordStrong;
GO
CREATE FUNCTION seg.fn_IsPasswordStrong (@pwd NVARCHAR(200))
RETURNS BIT
AS
BEGIN
    DECLARE @ok BIT = 1;
    IF LEN(@pwd) < 8 SET @ok = 0;
    IF @pwd NOT LIKE '%[A-Z]%' SET @ok = 0;
    IF @pwd NOT LIKE '%[a-z]%' SET @ok = 0;
    IF @pwd NOT LIKE '%[0-9]%' SET @ok = 0;
    IF @pwd NOT LIKE '%[^0-9A-Za-z]%' SET @ok = 0;
    RETURN @ok;
END;
GO

IF OBJECT_ID('seg.fn_HashWithSalt') IS NOT NULL DROP FUNCTION seg.fn_HashWithSalt;
GO
CREATE FUNCTION seg.fn_HashWithSalt (@pwd NVARCHAR(200), @salt VARBINARY(16))
RETURNS VARBINARY(32)
AS
BEGIN
    RETURN HASHBYTES('SHA2_256', @salt + CONVERT(VARBINARY(400), @pwd));
END;
GO

------------------------------------------------------------
-- B.4) Procedimientos almacenados
------------------------------------------------------------
IF OBJECT_ID('seg.sp_RegistrarUsuario') IS NOT NULL DROP PROCEDURE seg.sp_RegistrarUsuario;
GO
CREATE PROCEDURE seg.sp_RegistrarUsuario
    @Usuario     VARCHAR(50),
    @Nombres     VARCHAR(100),
    @Apellidos   VARCHAR(100),
    @Correo      VARCHAR(120),
    @Rol         VARCHAR(20),
    @Password    NVARCHAR(200),
    @Confirmar   NVARCHAR(200),
    @Mensaje     NVARCHAR(200) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Rol NOT IN ('admin','secretaria') BEGIN SET @Mensaje=N'Rol inválido'; RETURN 103; END
    IF EXISTS(SELECT 1 FROM seg.tbUsuario WHERE Usuario=@Usuario) BEGIN SET @Mensaje=N'Usuario ya existe'; RETURN 101; END
    IF EXISTS(SELECT 1 FROM seg.tbUsuario WHERE Correo=@Correo) BEGIN SET @Mensaje=N'Correo duplicado'; RETURN 102; END
    IF seg.fn_IsPasswordStrong(@Password)=0 BEGIN SET @Mensaje=N'Contraseña débil'; RETURN 201; END
    IF @Password<>@Confirmar BEGIN SET @Mensaje=N'Confirmación no coincide'; RETURN 202; END

    DECLARE @salt VARBINARY(16)=CRYPT_GEN_RANDOM(16);
    DECLARE @hash VARBINARY(32)=seg.fn_HashWithSalt(@Password,@salt);

    INSERT INTO seg.tbUsuario(Usuario,Nombres,Apellidos,HashPassword,Salt,Correo,Rol,Estado,UltimoCambioPass)
    VALUES(@Usuario,@Nombres,@Apellidos,@hash,@salt,@Correo,@Rol,1,SYSDATETIME());

    SET @Mensaje=N'Usuario registrado';
    RETURN 0;
END;
GO

IF OBJECT_ID('seg.sp_LoginUsuario') IS NOT NULL DROP PROCEDURE seg.sp_LoginUsuario;
GO
CREATE PROCEDURE seg.sp_LoginUsuario
    @Usuario     VARCHAR(50),
    @Password    NVARCHAR(200),
    @Mensaje     NVARCHAR(200) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @id INT,@salt VARBINARY(16),@hash VARBINARY(32),@calc VARBINARY(32),
            @estado BIT,@esTemp BIT,@expira DATETIME2(0);

    SELECT @id=IdUsuario,@salt=Salt,@hash=HashPassword,@estado=Estado,
           @esTemp=EsPasswordTemporal,@expira=FechaExpiraPassword
    FROM seg.tbUsuario WHERE Usuario=@Usuario;

    IF @id IS NULL
    BEGIN
        INSERT INTO seg.tbBitacoraAcceso(IdUsuario,Usuario,Resultado) VALUES(-1,@Usuario,'FAIL');
        SET @Mensaje=N'Usuario no existe';
        RETURN 301;
    END

    IF @estado=0
    BEGIN
        INSERT INTO seg.tbBitacoraAcceso(IdUsuario,Usuario,Resultado) VALUES(@id,@Usuario,'FAIL');
        SET @Mensaje=N'Usuario inactivo';
        RETURN 307;
    END

    SET @calc=seg.fn_HashWithSalt(@Password,@salt);
    IF @calc<>@hash
    BEGIN
        INSERT INTO seg.tbBitacoraAcceso(IdUsuario,Usuario,Resultado) VALUES(@id,@Usuario,'FAIL');
        SET @Mensaje=N'Contraseña incorrecta';
        RETURN 302;
    END

    IF @esTemp=1 AND @expira IS NOT NULL AND SYSDATETIME()>@expira
    BEGIN
        INSERT INTO seg.tbBitacoraAcceso(IdUsuario,Usuario,Resultado) VALUES(@id,@Usuario,'FAIL');
        SET @Mensaje=N'La contraseña temporal ha expirado';
        RETURN 305;
    END

    INSERT INTO seg.tbBitacoraAcceso(IdUsuario,Usuario,Resultado) VALUES(@id,@Usuario,'OK');
    SET @Mensaje=N'Login correcto';
    RETURN 0;
END;
GO

IF OBJECT_ID('seg.sp_ValidarUsuario') IS NOT NULL DROP PROCEDURE seg.sp_ValidarUsuario;
GO
CREATE PROCEDURE seg.sp_ValidarUsuario
    @Usuario   VARCHAR(50),
    @Password  NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @msg NVARCHAR(200), @rc INT;
    EXEC @rc = seg.sp_LoginUsuario @Usuario=@Usuario, @Password=@Password, @Mensaje=@msg OUTPUT;

    IF @rc <> 0
    BEGIN
        SELECT 'FAIL' AS Resultado, @msg AS Mensaje,
               NULL AS IdUsuario, NULL AS Usuario, NULL AS Nombres, NULL AS Apellidos,
               NULL AS Correo, NULL AS Rol, 0 AS EsPasswordTemporal;
        RETURN 0;
    END

    SELECT
        'OK' AS Resultado,
        'Login exitoso' AS Mensaje,
        u.IdUsuario, u.Usuario, u.Nombres, u.Apellidos, u.Correo, u.Rol,
        u.EsPasswordTemporal
    FROM seg.tbUsuario u
    WHERE u.Usuario=@Usuario;
    RETURN 0;
END;
GO

IF OBJECT_ID('seg.sp_ActualizarContrasena') IS NOT NULL DROP PROCEDURE seg.sp_ActualizarContrasena;
GO
CREATE PROCEDURE seg.sp_ActualizarContrasena
    @Usuario         VARCHAR(50),
    @PasswordActual  NVARCHAR(200),
    @PasswordNueva   NVARCHAR(200),
    @ConfirmarNueva  NVARCHAR(200),
    @Mensaje         NVARCHAR(200) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @id INT,@salt VARBINARY(16),@hash VARBINARY(32),@calc VARBINARY(32);
    SELECT @id=IdUsuario,@salt=Salt,@hash=HashPassword
    FROM seg.tbUsuario WHERE Usuario=@Usuario AND Estado=1;

    IF @id IS NULL BEGIN SET @Mensaje=N'Usuario no existe o inactivo'; RETURN 301; END

    SET @calc=seg.fn_HashWithSalt(@PasswordActual,@salt);
    IF @calc<>@hash BEGIN SET @Mensaje=N'Contraseña actual incorrecta'; RETURN 303; END

    IF seg.fn_IsPasswordStrong(@PasswordNueva)=0 BEGIN SET @Mensaje=N'Contraseña nueva débil'; RETURN 201; END
    IF @PasswordNueva<>@ConfirmarNueva BEGIN SET @Mensaje=N'Confirmación no coincide'; RETURN 202; END

    DECLARE @newSalt VARBINARY(16)=CRYPT_GEN_RANDOM(16);
    DECLARE @newHash VARBINARY(32)=seg.fn_HashWithSalt(@PasswordNueva,@newSalt);

    UPDATE seg.tbUsuario
    SET HashPassword=@newHash,Salt=@newSalt,UltimoCambioPass=SYSDATETIME(),
        EsPasswordTemporal=0,FechaExpiraPassword=NULL
    WHERE IdUsuario=@id;

    INSERT INTO seg.tbBitacoraTransacciones(Usuario,IdUsuario,Operacion,Entidad,ClaveEntidad,Detalle)
    VALUES(@Usuario,@id,'CAMBIO_CONTRASENA','tbUsuario',CONCAT('IdUsuario=',@id),N'Password actualizado');

    SET @Mensaje=N'Contraseña actualizada';
    RETURN 0;
END;
GO

IF OBJECT_ID('seg.sp_GenerarTokenRecuperacion') IS NOT NULL DROP PROCEDURE seg.sp_GenerarTokenRecuperacion;
GO
CREATE PROCEDURE seg.sp_GenerarTokenRecuperacion
    @Correo        VARCHAR(120),
    @Token         UNIQUEIDENTIFIER OUTPUT,
    @Mensaje       NVARCHAR(200) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @id INT;
    SELECT @id=IdUsuario FROM seg.tbUsuario WHERE Correo=@Correo AND Estado=1;
    IF @id IS NULL BEGIN SET @Mensaje=N'Correo no registrado'; RETURN 304; END

    UPDATE seg.tbRecuperacionContrasena SET Usado=1
    WHERE IdUsuario=@id AND Usado=0;

    DECLARE @tk UNIQUEIDENTIFIER = NEWID();
    INSERT INTO seg.tbRecuperacionContrasena(IdUsuario,Token,FechaExpira)
    VALUES(@id,@tk,DATEADD(MINUTE,30,SYSDATETIME()));

    SET @Token=@tk;
    SET @Mensaje=N'Token generado';
    RETURN 0;
END;
GO

IF OBJECT_ID('seg.sp_RecuperarContrasena') IS NOT NULL DROP PROCEDURE seg.sp_RecuperarContrasena;
GO
CREATE PROCEDURE seg.sp_RecuperarContrasena
    @Token         UNIQUEIDENTIFIER,
    @PasswordNueva NVARCHAR(200),
    @Confirmar     NVARCHAR(200),
    @Mensaje       NVARCHAR(200) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @id INT,@expira DATETIME2(0),@usado BIT;

    SELECT TOP 1 @id=IdUsuario,@expira=FechaExpira,@usado=Usado
    FROM seg.tbRecuperacionContrasena
    WHERE Token=@Token
    ORDER BY FechaCreacion DESC;

    IF @id IS NULL           BEGIN SET @Mensaje=N'Token inválido'; RETURN 501; END
    IF @usado=1              BEGIN SET @Mensaje=N'Token usado';    RETURN 502; END
    IF SYSDATETIME()>@expira BEGIN SET @Mensaje=N'Token expirado'; RETURN 503; END

    IF seg.fn_IsPasswordStrong(@PasswordNueva)=0 BEGIN SET @Mensaje=N'Contraseña débil'; RETURN 201; END
    IF @PasswordNueva<>@Confirmar           BEGIN SET @Mensaje=N'Confirmación no coincide'; RETURN 202; END

    DECLARE @salt VARBINARY(16)=CRYPT_GEN_RANDOM(16);
    DECLARE @hash VARBINARY(32)=seg.fn_HashWithSalt(@PasswordNueva,@salt);

    UPDATE seg.tbUsuario
    SET HashPassword=@hash, Salt=@salt, UltimoCambioPass=SYSDATETIME(),
        EsPasswordTemporal=0, FechaExpiraPassword=NULL
    WHERE IdUsuario=@id;

    UPDATE seg.tbRecuperacionContrasena
    SET Usado=1
    WHERE IdUsuario=@id AND Token=@Token;

    INSERT INTO seg.tbBitacoraTransacciones(Usuario,IdUsuario,Operacion,Entidad,ClaveEntidad,Detalle)
    VALUES('system',@id,'RECUPERAR_CONTRASENA','tbUsuario',CONCAT('IdUsuario=',@id),
           N'Recuperación por token');

    SET @Mensaje=N'Contraseña actualizada';
    RETURN 0;
END;
GO

-- Limpieza de passwords temporales expirados
IF OBJECT_ID('seg.sp_LimpiarPasswordsTemporalesExpirados') IS NOT NULL DROP PROCEDURE seg.sp_LimpiarPasswordsTemporalesExpirados;
GO
CREATE PROCEDURE seg.sp_LimpiarPasswordsTemporalesExpirados
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE seg.tbUsuario
    SET EsPasswordTemporal=0, FechaExpiraPassword=NULL
    WHERE EsPasswordTemporal=1 AND FechaExpiraPassword IS NOT NULL
      AND SYSDATETIME()>FechaExpiraPassword;
END;
GO

------------------------------------------------------------
-- B.5) Roles y permisos
------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name='rol_admin_app')
    DROP ROLE rol_admin_app;
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name='rol_secretaria_app')
    DROP ROLE rol_secretaria_app;
GO

CREATE ROLE rol_admin_app AUTHORIZATION dbo;
CREATE ROLE rol_secretaria_app AUTHORIZATION dbo;

GRANT SELECT,INSERT,UPDATE,DELETE ON SCHEMA::seg TO rol_admin_app;
GRANT EXECUTE                    ON SCHEMA::seg TO rol_admin_app;

GRANT EXECUTE ON OBJECT::seg.sp_LoginUsuario             TO rol_secretaria_app;
GRANT EXECUTE ON OBJECT::seg.sp_ValidarUsuario           TO rol_secretaria_app;
GRANT EXECUTE ON OBJECT::seg.sp_ActualizarContrasena     TO rol_secretaria_app;
GRANT EXECUTE ON OBJECT::seg.sp_GenerarTokenRecuperacion TO rol_secretaria_app;
GRANT EXECUTE ON OBJECT::seg.sp_RecuperarContrasena      TO rol_secretaria_app;
GRANT SELECT  ON OBJECT::seg.tbBitacoraAcceso            TO rol_admin_app;
GRANT SELECT  ON OBJECT::seg.tbBitacoraTransacciones     TO rol_admin_app;
GO

------------------------------------------------------------
-- B.6) Usuarios iniciales (ejemplo)
------------------------------------------------------------
DECLARE @msg NVARCHAR(200);

EXEC seg.sp_RegistrarUsuario 
    @Usuario='henryOo', @Nombres='Henry Otoniel', @Apellidos='Yalibat Pacay',
    @Correo='henryalibat4@gmail.com', @Rol='admin',
    @Password=N'Adm!n_2025*', @Confirmar=N'Adm!n_2025*', @Mensaje=@msg OUTPUT; 
SELECT @msg AS MsgAdmin;

EXEC seg.sp_RegistrarUsuario 
    @Usuario='EdinGei', @Nombres='Edin', @Apellidos='Coy Lem',
    @Correo='coyedin521@gmail.com', @Rol='secretaria',
    @Password=N'Secr3t_*2025', @Confirmar=N'Secr3t_*2025', @Mensaje=@msg OUTPUT; 
SELECT @msg AS MsgSecretaria;
GO

PRINT '✅ Inventario, seguridad y vista con DESCUENTO creados correctamente.';
GO

-- Verificación rápida
SELECT Codigo, Nombre, PrecioVenta, Descuento, PrecioVentaNeto, Estado
FROM inv.productos
ORDER BY Codigo;
GO

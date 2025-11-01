const sql = require('mssql/msnodesqlv8');

// Centraliza la configuración y el pool de conexión a SQL Server (ODBC)
const dbServer = process.env.DB_SERVER || 'localhost\\SQLEXPRESS';
const dbName = process.env.DB_DATABASE || 'DB_parte2';
const dbUser = process.env.DB_USER || '';
const dbPass = process.env.DB_PASSWORD || '';
const odbcDriver = process.env.ODBC_DRIVER || 'ODBC Driver 17 for SQL Server';
const encryptYes = String(process.env.DB_ENCRYPT || 'No').toLowerCase() === 'yes';
const trustCertYes = String(process.env.DB_TRUST_CERT || 'Yes').toLowerCase() === 'yes';
const useTrusted = !dbUser || !dbPass;

const connectionString = `Driver={${odbcDriver}};Server=${dbServer};Database=${dbName};`
  + (useTrusted ? 'Trusted_Connection=Yes;' : `Trusted_Connection=No;Uid=${dbUser};Pwd=${dbPass};`)
  + `Encrypt=${encryptYes ? 'Yes' : 'No'};TrustServerCertificate=${trustCertYes ? 'Yes' : 'No'};`;

let pool;
async function getPool() {
  if (pool && pool.connected) return pool;
  pool = await sql.connect({ connectionString });
  return pool;
}

async function closePool() {
  if (pool) {
    try { await pool.close(); } catch (_) {}
    pool = undefined;
  }
}

module.exports = { getPool, closePool, sql };


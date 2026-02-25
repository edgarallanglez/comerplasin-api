const sql = require('mssql');
require('dotenv').config();

const pool = new sql.ConnectionPool({
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    options: {
        encrypt: process.env.DB_ENCRYPT === "true",
        trustServerCertificate: true,
    },
});

async function run() {
    await pool.connect();

    console.log("admClientes COLUMNS:");
    const r = await pool.request().query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'admClientes'
        AND COLUMN_NAME LIKE '%ESTATUS%' OR COLUMN_NAME LIKE '%STATUS%' OR COLUMN_NAME LIKE '%ACTIVO%'
    `);
    console.table(r.recordset);

    pool.close();
}

run().catch(console.error);

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
    try {
        await pool.connect();
        const request = pool.request();

        // Check columns in admClientes
        const query = `
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'admClientes' AND (COLUMN_NAME LIKE '%AGENT%' OR COLUMN_NAME LIKE '%VEND%')
        `;
        const result = await request.query(query);
        console.log("admClientes columns:", result.recordset);

        const query2 = `
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME LIKE '%Agent%' OR TABLE_NAME LIKE '%Representante%' OR TABLE_NAME LIKE '%Vendedor%'
        `;
        const result2 = await request.query(query2);
        console.log("Related tables:", result2.recordset);

        pool.close();
    } catch (err) {
        console.error(err);
        pool.close();
    }
}
run();

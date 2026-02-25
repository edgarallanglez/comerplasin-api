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

    // Check View Definition
    const r = await pool.request().query(`
        EXEC sp_helptext 'dbo.v_fact_ventas'
    `);

    r.recordset.forEach(row => {
        console.log(row.Text.trim());
    });

    pool.close();
}

run().catch(console.error);

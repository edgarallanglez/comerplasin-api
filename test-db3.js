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

    // Check all concepts
    console.log("CONCEPTS WITH PENDING DEBT (Sales/Clientes):");
    const r = await pool.request().query(`
        SELECT 
            d.CIDCONCEPTODOCUMENTO, 
            cpto.CNOMBRECONCEPTO,
            COUNT(*) as invoice_count,
            SUM(d.CPENDIENTE) as total_debt
        FROM admDocumentos d
        JOIN admConceptos cpto ON cpto.CIDCONCEPTODOCUMENTO = d.CIDCONCEPTODOCUMENTO
        WHERE d.CPENDIENTE > 0
        AND d.CCANCELADO = 0
        AND d.CUSACLIENTE = 1
        AND d.CAFECTADO = 1
        -- AND d.CNATURALEZA = 0 -- 0 is Cargo (Debt), 1 is Abono (Credit)? wait... 
        GROUP BY d.CIDCONCEPTODOCUMENTO, cpto.CNOMBRECONCEPTO
        ORDER BY total_debt DESC
    `);
    console.table(r.recordset);

    pool.close();
}

run().catch(console.error);

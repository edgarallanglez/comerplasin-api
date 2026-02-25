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

    console.log("PRODUCTOS CHATA INVOICES:");
    const r = await pool.request().query(`
        SELECT d.CIDDOCUMENTO, d.CFECHA, d.CFECHAVENCIMIENTO, d.CPENDIENTE, c.CRAZONSOCIAL, d.CIDCONCEPTODOCUMENTO, cpto.CNOMBRECONCEPTO
        FROM admDocumentos d
        JOIN admClientes c ON d.CIDCLIENTEPROVEEDOR = c.CIDCLIENTEPROVEEDOR
        LEFT JOIN admConceptos cpto ON cpto.CIDCONCEPTODOCUMENTO = d.CIDCONCEPTODOCUMENTO
        WHERE c.CRAZONSOCIAL LIKE '%PRODUCTOS CHATA%'
        AND d.CPENDIENTE > 0
        AND d.CCANCELADO = 0
        ORDER BY d.CFECHA DESC
    `);
    console.table(r.recordset);

    pool.close();
}

run().catch(console.error);

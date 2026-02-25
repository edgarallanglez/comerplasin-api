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

    // Check Sukarne
    console.log("SUKARNE AGROINDUSTRIAL INVOICES:");
    const r1 = await pool.request().query(`
        SELECT d.CIDDOCUMENTO, d.CFECHA, d.CFECHAVENCIMIENTO, d.CPENDIENTE, c.CRAZONSOCIAL
        FROM admDocumentos d
        JOIN admClientes c ON d.CIDCLIENTEPROVEEDOR = c.CIDCLIENTEPROVEEDOR
        WHERE c.CRAZONSOCIAL LIKE '%SUKARNE AGROINDUSTRIAL%'
        AND d.CPENDIENTE > 0
        AND d.CCANCELADO = 0
    `);
    console.table(r1.recordset);

    console.log("FERRETERA Y TORNILLERIA ZAPATA INVOICES:");
    const r2 = await pool.request().query(`
        SELECT d.CIDDOCUMENTO, d.CFECHA, d.CFECHAVENCIMIENTO, d.CPENDIENTE, c.CRAZONSOCIAL
        FROM admDocumentos d
        JOIN admClientes c ON d.CIDCLIENTEPROVEEDOR = c.CIDCLIENTEPROVEEDOR
        WHERE c.CRAZONSOCIAL LIKE '%FERRETERA Y TORNIL%'
        AND d.CPENDIENTE > 0
        AND d.CCANCELADO = 0
    `);
    console.table(r2.recordset);

    pool.close();
}

run().catch(console.error);

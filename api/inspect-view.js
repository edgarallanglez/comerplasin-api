import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env manually
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const value = values.join('=');
            process.env[key.trim()] = value.trim().replace(/^['"]|['"]$/g, '');
        }
    });
}

const config = {
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    options: {
        encrypt: process.env.DB_ENCRYPT === "true",
        trustServerCertificate: true,
    },
};

async function run() {
    try {
        await sql.connect(config);
        console.log("Connected to DB");

        // 1. Inspect Product 1459 (found in MinMax for BP1 parent)
        console.log("\n--- Product 1459 (Child of BP1?) ---");
        const prod1459 = await sql.query(`
            SELECT CIDPRODUCTO, CCODIGOPRODUCTO, CNOMBREPRODUCTO, CTIPOPRODUCTO 
            FROM admProductos 
            WHERE CIDPRODUCTO = 1459
        `);
        console.table(prod1459.recordset);

        // 2. Check MinMax for BP8 (1133) using Parent ID
        console.log("\n--- admMaximosMinimos for BP8 (ID 1133) as PARENT ---");
        const mmBP8Parent = await sql.query(`
            SELECT * 
            FROM admMaximosMinimos 
            WHERE CIDPRODUCTOPADRE = 1133
        `);
        console.table(mmBP8Parent.recordset);

        // 3. Check if BP8 has any "child" products
        console.log("\n--- Child Products of BP8? ---");
        // Note: There isn't an explicit "ParentID" column in admProductos in my previous schema dump, 
        // but maybe 'admMaximosMinimos' implies a relationship.
        // Let's just see if there are any other tables linking products.

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await sql.close();
    }
}

run();

import Fastify from "fastify";
import sql from "mssql";

const app = Fastify({ logger: true });

const PORT = Number(process.env.PORT || 3001);

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

let poolPromise;

app.addHook("preHandler", async (req, reply) => {
    if (req.url === "/health") return;
    const key = req.headers["x-api-key"];
    if (!key || key !== process.env.API_KEY) {
        return reply.code(401).send({ error: "Unauthorized" });
    }
});

app.get("/health", async () => ({ ok: true }));

// Ejemplo: endpoint fijo (recomendado)
app.get("/ventas", async (req, reply) => {
    const conn = await (poolPromise ??= pool.connect());
    const { startDate, endDate, year, month } = req.query;

    let query = "SELECT TOP 100 * FROM dbo.v_fact_ventas";
    let whereClauses = [];
    const request = conn.request();

    if (startDate && endDate) {
        whereClauses.push("fecha >= @startDate AND fecha <= @endDate");
        request.input("startDate", sql.Date, new Date(startDate));
        request.input("endDate", sql.Date, new Date(endDate));
        // If specific range requested, remove TOP limit to get full data
        query = "SELECT * FROM dbo.v_fact_ventas";
    } else if (year) {
        const y = parseInt(year);
        let start, end;

        if (month) {
            const m = parseInt(month) - 1; // JS months are 0-11
            start = new Date(y, m, 1);
            end = new Date(y, m + 1, 0); // Last day of month
            // Set end to end of day? 
            // If DB is just Date, this is fine. If DateTime, might miss time. 
            // Safer to just use date boundaries assuming strict Date column or handle time if needed.
            // For now assuming standard Date usage.
        } else {
            start = new Date(y, 0, 1);
            end = new Date(y, 11, 31);
        }

        whereClauses.push("fecha >= @yearStart AND fecha <= @yearEnd");
        request.input("yearStart", sql.Date, start);
        request.input("yearEnd", sql.Date, end);

        // Remove limit for explicit period
        query = "SELECT * FROM dbo.v_fact_ventas";
    }

    if (whereClauses.length > 0) {
        query += " WHERE " + whereClauses.join(" AND ");
    }

    query += " ORDER BY fecha DESC;";

    const result = await request.query(query);
    return result.recordset;
});

app.listen({ host: "0.0.0.0", port: PORT });

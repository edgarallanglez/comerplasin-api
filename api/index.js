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
    const { startDate, endDate, year, month, cliente } = req.query;

    let query = "SELECT TOP 100 * FROM dbo.v_fact_ventas";
    let whereClauses = [];
    const request = conn.request();

    if (startDate && endDate) {
        // Use exclusive upper bound (< next_day) to include the full end date
        whereClauses.push("fecha >= @startDate AND fecha < @endDate");

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setDate(end.getDate() + 2); // Add 2 days to cover full end date + timezone differences

        request.input("startDate", sql.Date, start);
        request.input("endDate", sql.Date, end);

        // If specific range requested, remove TOP limit to get full data
        query = "SELECT * FROM dbo.v_fact_ventas";
    } else if (year) {
        const y = parseInt(year);
        let start, end;

        if (month) {
            const m = parseInt(month) - 1; // JS months are 0-11
            start = new Date(y, m, 1);
            // First day of NEXT month
            end = new Date(y, m + 1, 1);

            whereClauses.push("fecha >= @yearStart AND fecha < @yearEnd");
        } else {
            start = new Date(y, 0, 1);
            // First day of NEXT year
            end = new Date(y + 1, 0, 1);

            whereClauses.push("fecha >= @yearStart AND fecha < @yearEnd");
        }

        request.input("yearStart", sql.Date, start);
        request.input("yearEnd", sql.Date, end);

        // Remove limit for explicit period
        query = "SELECT * FROM dbo.v_fact_ventas";
    }

    if (cliente) {
        // Filter by client ID
        whereClauses.push("id_cliente = @cliente");
        request.input("cliente", sql.Int, parseInt(cliente));
    }

    if (whereClauses.length > 0) {
        query += (query.includes("WHERE") ? " AND " : " WHERE ") + whereClauses.join(" AND ");
    }

    query += " ORDER BY fecha DESC, id_movimiento DESC;";

    // Execute main query
    const mainResult = await request.query(query);
    let combinedResults = mainResult.recordset;

    // Fetch Remisiones (Concept 5) if filtering by date
    let fetchRemisiones = false;
    let remisionesQuery = `
        SELECT 
            m.CIDMOVIMIENTO as id_movimiento,
            CAST(d.CIDDOCUMENTO as varchar) as id_documento,
            d.CFECHA as fecha,
            d.CIDCLIENTEPROVEEDOR as id_cliente,
            c.CRAZONSOCIAL as cliente_name,
            p.CNOMBREPRODUCTO as id_producto,
            d.CIDCONCEPTODOCUMENTO as naturaleza_concepto,
            d.CFECHAVENCIMIENTO as fecha_vencimiento,
            d.CPENDIENTE as saldo_pendiente, 
            m.CUNIDADES as cantidad,
            m.CPRECIO as precio_unitario,
            m.CNETO as subtotal,
            m.CIMPUESTO1 as iva,
            m.CTOTAL as total,
            0 as costo_linea,
            0 as costo_unitario,
            'Remisión' as tipo -- Marker
        FROM admMovimientos m
        JOIN admDocumentos d ON m.CIDDOCUMENTO = d.CIDDOCUMENTO
        JOIN admClientes c ON d.CIDCLIENTEPROVEEDOR = c.CIDCLIENTEPROVEEDOR
        LEFT JOIN admProductos p ON m.CIDPRODUCTO = p.CIDPRODUCTO
        WHERE d.CIDCONCEPTODOCUMENTO = 5
          AND d.CCANCELADO = 0
    `;

    if (startDate && endDate) {
        fetchRemisiones = true;
        remisionesQuery += " AND d.CFECHA >= @startDate AND d.CFECHA < @endDate";
    } else if (year) {
        fetchRemisiones = true;
        // Reuse the date logic from above or just relying on the params if they were set?
        // Actually, if year/month passed, we constructed start/end dates?
        // The code above handles 'year'/'month' by modifying 'query' string directly or checking logic.
        // Wait, the original code for year/month uses SQL functions: YEAR(fecha) = @year
        // So I should use the same logic for Remisiones.

        if (month) {
            remisionesQuery += " AND YEAR(d.CFECHA) = @year AND MONTH(d.CFECHA) = @month";
        } else {
            remisionesQuery += " AND YEAR(d.CFECHA) = @year";
        }
    }

    if (fetchRemisiones) {
        // Create a NEW request for the second query to avoid parameter conflicts/clearing issues
        const remisionesRequest = conn.request();

        // Re-add parameters
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setDate(end.getDate() + 2);
            remisionesRequest.input("startDate", sql.Date, start);
            remisionesRequest.input("endDate", sql.Date, end);
        } else if (year) {
            remisionesRequest.input("year", sql.Int, parseInt(year));
            if (month) {
                remisionesRequest.input("month", sql.Int, parseInt(month));
            }
        }

        try {
            const remisionesResult = await remisionesRequest.query(remisionesQuery);
            if (remisionesResult.recordset.length > 0) {
                // console.log(`Found ${remisionesResult.recordset.length} Remisiones to append.`);
                combinedResults = combinedResults.concat(remisionesResult.recordset);
            }
        } catch (err) {
            console.error("Error fetching Remisiones:", err);
        }
    }

    return combinedResults;
});

app.get("/clientes", async (req, reply) => {
    const conn = await (poolPromise ??= pool.connect());
    const { q, type } = req.query;
    const tipo = type ? parseInt(type) : 1; // 1 = Cliente, 2 = Proveedor

    let query = "SELECT CIDCLIENTEPROVEEDOR as id, CRAZONSOCIAL as nombre FROM dbo.admClientes WHERE CTIPOCLIENTE = @tipo";
    const request = conn.request();
    request.input("tipo", sql.Int, tipo);

    if (q) {
        query += " AND CRAZONSOCIAL LIKE @q";
        request.input("q", sql.NVarChar, `%${q}%`);
    }

    query += " ORDER BY CRAZONSOCIAL";

    const result = await request.query(query);
    return result.recordset;
});

app.get("/cobranza", async (req, reply) => {
    const conn = await (poolPromise ??= pool.connect());
    const { startDate, endDate, year, month, cliente } = req.query;

    let selectClause = `
        SELECT 
            d.CIDDOCUMENTO AS id_documento,
            MIN(d.CFECHA) AS fecha,
            MIN(d.CFECHAVENCIMIENTO) AS fecha_vencimiento,
            c.CRAZONSOCIAL AS cliente_name,
            -- CPENDIENTE is the remaining balance for the document.
            -- We only want to include "Cargo" documents (debts) for Cobranza.
            -- "Abono" documents (payments) would have CNATURALEZA = 1.
            MAX(d.CPENDIENTE) AS saldo_pendiente
        FROM dbo.admDocumentos d
        JOIN dbo.admClientes c ON d.CIDCLIENTEPROVEEDOR = c.CIDCLIENTEPROVEEDOR
    `;
    let whereClauses = [
        "d.CPENDIENTE > 0",
        "d.CCANCELADO = 0",
        "d.CUSACLIENTE = 1",
        "d.CAFECTADO = 1",
        "d.CNATURALEZA = 0",
        "c.CESTATUS = 1",
        "d.CIDCONCEPTODOCUMENTO IN (3012, 4, 3007, 3006, 5, 3, 14, 39)"
    ];
    const request = conn.request();

    if (startDate && endDate) {
        whereClauses.push("d.CFECHA >= @startDate AND d.CFECHA <= @endDate");
        request.input("startDate", sql.Date, new Date(startDate));
        request.input("endDate", sql.Date, new Date(endDate));
    } else if (year) {
        const y = parseInt(year);
        let start, end;

        if (month) {
            const m = parseInt(month) - 1;
            start = new Date(y, m, 1);
            end = new Date(y, m + 1, 0);
        } else {
            start = new Date(y, 0, 1);
            end = new Date(y, 11, 31);
        }

        whereClauses.push("d.CFECHA >= @yearStart AND d.CFECHA <= @yearEnd");
        request.input("yearStart", sql.Date, start);
        request.input("yearEnd", sql.Date, end);
    }

    if (cliente) {
        whereClauses.push("d.CIDCLIENTEPROVEEDOR = @cliente");
        request.input("cliente", sql.Int, parseInt(cliente));
    }

    let query = selectClause + " WHERE " + whereClauses.join(" AND ");
    query += " GROUP BY d.CIDDOCUMENTO, c.CRAZONSOCIAL";
    query += " HAVING MAX(d.CPENDIENTE) > 0";
    query += " ORDER BY MIN(d.CFECHAVENCIMIENTO) ASC, MAX(d.CPENDIENTE) DESC;";

    const result = await request.query(query);

    return result.recordset;
});

app.get("/inventario", async (req, reply) => {
    const conn = await (poolPromise ??= pool.connect());
    const { almacen, producto, status, minStock, maxStock } = req.query;

    let selectClause = `
        SELECT 
            e.CIDEXISTENCIA as id_existencia,
            p.CIDPRODUCTO as id_producto,
            p.CCODIGOPRODUCTO as codigo_producto,
            p.CNOMBREPRODUCTO as nombre_producto,
            p.CSTATUSPRODUCTO as status_producto,
            a.CIDALMACEN as id_almacen,
            a.CCODIGOALMACEN as codigo_almacen,
            a.CNOMBREALMACEN as almacen,
            (e.CENTRADASPERIODO12 - e.CSALIDASPERIODO12) as existencia,
            e.CTIMESTAMP as fecha_extraccion,
            ISNULL(mm.CEXISTENCIAMINBASE, 0) as min_stock,
            ISNULL(mm.CEXISTENCIAMAXBASE, 0) as max_stock,
            ISNULL(ch.CULTIMOCOSTOH, 0) as ultimo_costo
        FROM dbo.admExistenciaCosto e
        JOIN dbo.admProductos p ON e.CIDPRODUCTO = p.CIDPRODUCTO
        JOIN dbo.admAlmacenes a ON e.CIDALMACEN = a.CIDALMACEN
        OUTER APPLY (
            SELECT TOP 1 CEXISTENCIAMINBASE, CEXISTENCIAMAXBASE
            FROM dbo.admMaximosMinimos mm
            WHERE mm.CIDALMACEN = a.CIDALMACEN
              AND (mm.CIDPRODUCTO = p.CIDPRODUCTO OR mm.CIDPRODUCTOPADRE = p.CIDPRODUCTO)
        ) mm
        OUTER APPLY (
            SELECT TOP 1 CULTIMOCOSTOH 
            FROM dbo.admCostosHistoricos ch 
            WHERE ch.CIDPRODUCTO = p.CIDPRODUCTO 
            ORDER BY ch.CFECHACOSTOH DESC, ch.CIDCOSTOH DESC
        ) ch
        WHERE e.CIDEJERCICIO = (SELECT MAX(CIDEJERCICIO) FROM dbo.admExistenciaCosto)
    `;
    let whereClauses = [];
    const request = conn.request();

    // Filter by warehouse
    if (almacen) {
        whereClauses.push("e.CIDALMACEN = @almacen");
        request.input("almacen", sql.Int, parseInt(almacen));
    }

    // Filter by product (search in code or name)
    if (producto) {
        whereClauses.push("(p.CCODIGOPRODUCTO LIKE @producto OR p.CNOMBREPRODUCTO LIKE @producto)");
        request.input("producto", sql.NVarChar, `%${producto}%`);
    }

    // Filter by status (default to active products only)
    if (status) {
        whereClauses.push("p.CSTATUSPRODUCTO = @status");
        request.input("status", sql.Int, parseInt(status));
    } else {
        // By default, only show active products
        whereClauses.push("p.CSTATUSPRODUCTO = 1");
    }

    // Filter by stock range
    if (minStock) {
        whereClauses.push("(e.CENTRADASPERIODO12 - e.CSALIDASPERIODO12) > @minStock");
        request.input("minStock", sql.Decimal, parseFloat(minStock));
    }
    if (maxStock) {
        whereClauses.push("(e.CENTRADASPERIODO12 - e.CSALIDASPERIODO12) <= @maxStock");
        request.input("maxStock", sql.Decimal, parseFloat(maxStock));
    }

    let query = selectClause;
    if (whereClauses.length > 0) {
        query += " AND " + whereClauses.join(" AND ");
    }
    query += " ORDER BY almacen, nombre_producto;";

    const result = await request.query(query);
    return result.recordset;
});

app.get("/compras", async (req, reply) => {
    const conn = await (poolPromise ??= pool.connect());
    const { startDate, endDate, year, month, proveedor, producto, tipoConcepto, groupBy, top, limit } = req.query;

    const request = conn.request();
    let whereClauses = [];

    // Base filter: only data from 2023 onwards
    whereClauses.push("CFECHA >= '2023-01-01'");

    // Date filtering
    if (startDate && endDate) {
        whereClauses.push("CFECHA >= @startDate AND CFECHA <= @endDate");
        request.input("startDate", sql.Date, new Date(startDate));
        request.input("endDate", sql.Date, new Date(endDate));
    } else if (year) {
        const y = parseInt(year);
        let start, end;

        if (month) {
            const m = parseInt(month) - 1;
            start = new Date(y, m, 1);
            end = new Date(y, m + 1, 0);
        } else {
            start = new Date(y, 0, 1);
            end = new Date(y, 11, 31);
        }

        whereClauses.push("CFECHA >= @yearStart AND CFECHA <= @yearEnd");
        request.input("yearStart", sql.Date, start);
        request.input("yearEnd", sql.Date, end);
    }

    // Supplier filter
    if (proveedor) {
        whereClauses.push("CIDCLIENTEPROVEEDOR = @proveedor");
        request.input("proveedor", sql.Int, parseInt(proveedor));
    }

    // Product filter
    if (producto) {
        whereClauses.push("CIDPRODUCTO = @producto");
        request.input("producto", sql.Int, parseInt(producto));
    }

    // Concept type filter
    if (tipoConcepto) {
        whereClauses.push("tipo_concepto = @tipoConcepto");
        request.input("tipoConcepto", sql.NVarChar, tipoConcepto);
    }

    const whereClause = whereClauses.length > 0 ? " WHERE " + whereClauses.join(" AND ") : "";

    let query;

    // Aggregation by period
    if (groupBy === "day" || groupBy === "week" || groupBy === "month") {
        const formatMap = {
            day: "yyyy-MM-dd",
            week: "yyyy-'W'ww",
            month: "yyyy-MM"
        };
        const format = formatMap[groupBy];

        query = `
            SELECT 
                FORMAT(CFECHA, '${format}') AS periodo,
                SUM(total) AS total_compras,
                SUM(subtotal) AS subtotal,
                SUM(iva) AS iva,
                COUNT(DISTINCT CIDDOCUMENTO) AS documentos,
                COUNT(*) AS lineas
            FROM dbo.v_fact_compras
            ${whereClause}
            GROUP BY FORMAT(CFECHA, '${format}')
            ORDER BY periodo;
        `;
    }
    // Top suppliers
    else if (top === "suppliers") {
        const topLimit = limit ? parseInt(limit) : 10;
        query = `
            SELECT TOP(${topLimit})
                CIDCLIENTEPROVEEDOR,
                proveedor,
                SUM(total) AS total_compras,
                COUNT(DISTINCT CIDDOCUMENTO) AS documentos,
                ROUND(SUM(total) * 100.0 / NULLIF((SELECT SUM(total) FROM dbo.v_fact_compras ${whereClause}), 0), 2) AS porcentaje
            FROM dbo.v_fact_compras
            ${whereClause}
            GROUP BY CIDCLIENTEPROVEEDOR, proveedor
            ORDER BY total_compras DESC;
        `;
    }
    // Top products
    else if (top === "products") {
        const topLimit = limit ? parseInt(limit) : 10;
        query = `
            SELECT TOP(${topLimit})
                CIDPRODUCTO,
                CCODIGOPRODUCTO,
                CNOMBREPRODUCTO,
                SUM(cantidad) AS cantidad_total,
                SUM(total) AS total_compras,
                COUNT(DISTINCT CIDDOCUMENTO) AS documentos
            FROM dbo.v_fact_compras
            ${whereClause}
            GROUP BY CIDPRODUCTO, CCODIGOPRODUCTO, CNOMBREPRODUCTO
            ORDER BY total_compras DESC;
        `;
    }
    // Raw data
    else {
        const dataLimit = limit ? parseInt(limit) : 100;
        query = `
            SELECT TOP(${dataLimit}) *
            FROM dbo.v_fact_compras
            ${whereClause}
            ORDER BY CFECHA DESC, CIDMOVIMIENTO DESC;
        `;
    }

    const result = await request.query(query);
    return result.recordset;
});

app.get("/cxp", async (req, reply) => {
    const conn = await (poolPromise ??= pool.connect());
    const { proveedor, groupBy, startDate, endDate, year, month } = req.query;

    const request = conn.request();

    // Build date filter clause (only applies to invoices, not credits)
    let dateFilter = "";
    if (startDate && endDate) {
        dateFilter = "d.CFECHA >= @startDate AND d.CFECHA <= @endDate";
        request.input("startDate", sql.Date, startDate);
        request.input("endDate", sql.Date, endDate);
    } else if (year) {
        if (month && month !== 'all') {
            dateFilter = "YEAR(d.CFECHA) = @year AND MONTH(d.CFECHA) = @month";
            request.input("year", sql.Int, parseInt(year));
            request.input("month", sql.Int, parseInt(month));
        } else {
            dateFilter = "YEAR(d.CFECHA) = @year";
            request.input("year", sql.Int, parseInt(year));
        }
    }

    // Supplier filter
    let supplierFilter = "";
    if (proveedor) {
        supplierFilter = "AND d.CIDCLIENTEPROVEEDOR = @proveedor";
        request.input("proveedor", sql.Int, parseInt(proveedor));
    }

    // Base filters for all documents
    const baseWhere = `
        d.CUSAPROVEEDOR = 1
        AND d.CAFECTADO = 1
        AND d.CCANCELADO = 0
        AND d.CPENDIENTE > 0.01
        ${supplierFilter}
    `;

    // TRUE BALANCE VIEW: 
    // - Invoices (CNATURALEZA >= 1) filtered by date
    // - Credits (CNATURALEZA = 0) ALWAYS included (no date filter)
    const trueBalanceWhere = dateFilter
        ? `${baseWhere} AND ((d.CNATURALEZA >= 1 AND ${dateFilter}) OR d.CNATURALEZA = 0)`
        : baseWhere;

    let query;

    // ---------------------------------------------------------
    // MAIN VIEW: Supplier Summary (Net Balances)
    // ---------------------------------------------------------
    if (!groupBy || groupBy === "supplier") {
        query = `
            SELECT 
                d.CIDCLIENTEPROVEEDOR,
                c.CRAZONSOCIAL AS proveedor,
                
                -- Net balance (Invoices from period - ALL pending credits)
                SUM(CASE 
                    WHEN d.CNATURALEZA >= 1 THEN d.CPENDIENTE      -- Compras/Facturas (+)
                    WHEN d.CNATURALEZA = 0 THEN d.CPENDIENTE * -1  -- Pagos/Devoluciones (-)
                END) AS saldo_real,
                
                -- Invoices from selected period only
                SUM(CASE WHEN d.CNATURALEZA >= 1 THEN d.CPENDIENTE ELSE 0 END) AS total_deudas,
                
                -- ALL pending credits (regardless of date)
                SUM(CASE WHEN d.CNATURALEZA = 0 THEN d.CPENDIENTE ELSE 0 END) AS total_pagos_creditos,
                
                -- Overdue amount (only debts past due date)
                SUM(CASE 
                    WHEN d.CNATURALEZA >= 1 AND d.CFECHAVENCIMIENTO < GETDATE() 
                    THEN d.CPENDIENTE ELSE 0 
                END) AS saldo_vencido,
                
                COUNT(*) AS documentos

            FROM dbo.admDocumentos d
            LEFT JOIN dbo.admClientes c ON c.CIDCLIENTEPROVEEDOR = d.CIDCLIENTEPROVEEDOR
            WHERE ${trueBalanceWhere}
            GROUP BY d.CIDCLIENTEPROVEEDOR, c.CRAZONSOCIAL
            HAVING SUM(CASE 
                WHEN d.CNATURALEZA >= 1 THEN d.CPENDIENTE      
                WHEN d.CNATURALEZA = 0 THEN d.CPENDIENTE * -1  
            END) > 0.01
            ORDER BY saldo_real DESC
        `;
    }
    // ---------------------------------------------------------
    // Status Summary (Corriente vs Vencido)
    // ---------------------------------------------------------
    else if (groupBy === "status") {
        query = `
            WITH SupplierBalances AS (
                SELECT 
                    d.CIDCLIENTEPROVEEDOR,
                    SUM(CASE 
                        WHEN d.CNATURALEZA >= 1 THEN d.CPENDIENTE      
                        WHEN d.CNATURALEZA = 0 THEN d.CPENDIENTE * -1  
                    END) AS saldo_real,
                    SUM(CASE 
                        WHEN d.CNATURALEZA >= 1 AND d.CFECHAVENCIMIENTO < GETDATE() 
                        THEN d.CPENDIENTE ELSE 0 
                    END) AS saldo_vencido
                FROM dbo.admDocumentos d
                WHERE ${trueBalanceWhere}
                GROUP BY d.CIDCLIENTEPROVEEDOR
                HAVING SUM(CASE 
                    WHEN d.CNATURALEZA >= 1 THEN d.CPENDIENTE      
                    WHEN d.CNATURALEZA = 0 THEN d.CPENDIENTE * -1  
                END) > 0.01
            )
            SELECT 
                'vencido' as estado,
                SUM(saldo_vencido) as saldo_total,
                COUNT(CASE WHEN saldo_vencido > 0 THEN 1 END) as proveedores
            FROM SupplierBalances
            WHERE saldo_vencido > 0
            UNION ALL
            SELECT 
                'corriente' as estado,
                SUM(saldo_real - saldo_vencido) as saldo_total,
                COUNT(CASE WHEN (saldo_real - saldo_vencido) > 0 THEN 1 END) as proveedores
            FROM SupplierBalances
            WHERE saldo_real > saldo_vencido
        `;
    }
    // ---------------------------------------------------------
    // Bucket Summary (Aging) - Only for invoices from period
    // ---------------------------------------------------------
    else if (groupBy === "bucket") {
        const invoiceOnlyWhere = dateFilter
            ? `${baseWhere} AND d.CNATURALEZA >= 1 AND ${dateFilter}`
            : `${baseWhere} AND d.CNATURALEZA >= 1`;

        query = `
            SELECT 
                CASE 
                    WHEN d.CFECHAVENCIMIENTO IS NULL OR d.CFECHAVENCIMIENTO >= GETDATE() THEN 'NO_VENCIDO'
                    WHEN DATEDIFF(day, d.CFECHAVENCIMIENTO, GETDATE()) BETWEEN 1 AND 30 THEN '01-30'
                    WHEN DATEDIFF(day, d.CFECHAVENCIMIENTO, GETDATE()) BETWEEN 31 AND 60 THEN '31-60'
                    WHEN DATEDIFF(day, d.CFECHAVENCIMIENTO, GETDATE()) BETWEEN 61 AND 90 THEN '61-90'
                    ELSE '90+'
                END AS bucket,
                SUM(d.CPENDIENTE) AS saldo_total,
                COUNT(*) AS documentos
            FROM dbo.admDocumentos d
            WHERE ${invoiceOnlyWhere}
            GROUP BY 
                CASE 
                    WHEN d.CFECHAVENCIMIENTO IS NULL OR d.CFECHAVENCIMIENTO >= GETDATE() THEN 'NO_VENCIDO'
                    WHEN DATEDIFF(day, d.CFECHAVENCIMIENTO, GETDATE()) BETWEEN 1 AND 30 THEN '01-30'
                    WHEN DATEDIFF(day, d.CFECHAVENCIMIENTO, GETDATE()) BETWEEN 31 AND 60 THEN '31-60'
                    WHEN DATEDIFF(day, d.CFECHAVENCIMIENTO, GETDATE()) BETWEEN 61 AND 90 THEN '61-90'
                    ELSE '90+'
                END
        `;
    }
    // ---------------------------------------------------------
    // Detail view
    // ---------------------------------------------------------
    else if (groupBy === "detail") {
        query = `
            SELECT 
                d.CIDDOCUMENTO,
                d.CFECHA,
                d.CFOLIO,
                d.CSERIEDOCUMENTO,
                d.CIDCLIENTEPROVEEDOR,
                c.CRAZONSOCIAL AS proveedor,
                cpto.CNOMBRECONCEPTO AS concepto,
                d.CPENDIENTE,
                CASE 
                    WHEN d.CNATURALEZA >= 1 THEN 'DEUDA'
                    ELSE 'CREDITO'
                END AS tipo,
                CASE 
                    WHEN d.CNATURALEZA >= 1 THEN d.CPENDIENTE      
                    WHEN d.CNATURALEZA = 0 THEN d.CPENDIENTE * -1  
                END AS monto_neto,
                d.CFECHAVENCIMIENTO,
                CASE 
                    WHEN d.CNATURALEZA >= 1 AND d.CFECHAVENCIMIENTO < GETDATE() 
                    THEN DATEDIFF(day, d.CFECHAVENCIMIENTO, GETDATE())
                    ELSE 0 
                END as dias_vencido
            FROM dbo.admDocumentos d
            LEFT JOIN dbo.admClientes c ON c.CIDCLIENTEPROVEEDOR = d.CIDCLIENTEPROVEEDOR
            LEFT JOIN dbo.admConceptos cpto ON cpto.CIDCONCEPTODOCUMENTO = d.CIDCONCEPTODOCUMENTO
            WHERE ${trueBalanceWhere}
            ORDER BY d.CFECHA DESC, d.CFOLIO DESC
        `;
    }
    // ---------------------------------------------------------
    // Monthly Summary (for Cash Flow Chart)
    // Shows compras and pagos per month for the selected year
    // ---------------------------------------------------------
    else if (groupBy === "monthly") {
        // For monthly view, we need ALL documents in the year (both compras and pagos)
        const yearFilter = year ? `YEAR(d.CFECHA) = @year` : `YEAR(d.CFECHA) = YEAR(GETDATE())`;
        if (!year) {
            request.input("year", sql.Int, new Date().getFullYear());
        }

        query = `
            SELECT 
                MONTH(d.CFECHA) AS mes,
                DATENAME(month, d.CFECHA) AS mes_nombre,
                -- Compras (invoices) - positive
                SUM(CASE WHEN d.CNATURALEZA >= 1 THEN d.CPENDIENTE ELSE 0 END) AS compras,
                -- Pagos (payments/credits) - will be shown as negative
                SUM(CASE WHEN d.CNATURALEZA = 0 THEN d.CPENDIENTE ELSE 0 END) AS pagos
            FROM dbo.admDocumentos d
            WHERE 
                d.CUSAPROVEEDOR = 1
                AND d.CAFECTADO = 1
                AND d.CCANCELADO = 0
                AND d.CPENDIENTE > 0.01
                AND ${yearFilter}
                ${proveedor ? 'AND d.CIDCLIENTEPROVEEDOR = @proveedor' : ''}
            GROUP BY MONTH(d.CFECHA), DATENAME(month, d.CFECHA)
            ORDER BY mes
        `;
    }

    const result = await request.query(query);
    return result.recordset;
});

app.get("/pagos-proveedores", async (req, reply) => {
    const conn = await (poolPromise ??= pool.connect());
    const { startDate, endDate, year, month, proveedor, tipoPago, groupBy, limit } = req.query;

    const request = conn.request();
    let whereClauses = [];

    whereClauses.push("CFECHA >= '2023-01-01'");

    // Date filtering
    if (startDate && endDate) {
        whereClauses.push("CFECHA >= @startDate AND CFECHA <= @endDate");
        request.input("startDate", sql.Date, new Date(startDate));
        request.input("endDate", sql.Date, new Date(endDate));
    } else if (year) {
        const y = parseInt(year);
        let start, end;

        if (month) {
            const m = parseInt(month) - 1;
            start = new Date(y, m, 1);
            end = new Date(y, m + 1, 0);
        } else {
            start = new Date(y, 0, 1);
            end = new Date(y, 11, 31);
        }

        whereClauses.push("CFECHA >= @yearStart AND CFECHA <= @yearEnd");
        request.input("yearStart", sql.Date, start);
        request.input("yearEnd", sql.Date, end);
    }

    // Supplier filter
    if (proveedor) {
        whereClauses.push("CIDCLIENTEPROVEEDOR = @proveedor");
        request.input("proveedor", sql.Int, parseInt(proveedor));
    }

    // Payment type filter
    if (tipoPago) {
        whereClauses.push("tipo_pago = @tipoPago");
        request.input("tipoPago", sql.NVarChar, tipoPago);
    }

    const whereClause = whereClauses.length > 0 ? " WHERE " + whereClauses.join(" AND ") : "WHERE tipo_pago <> 'NOTA_CREDITO'";

    let query;

    // Aggregation by period
    if (groupBy === "day" || groupBy === "week" || groupBy === "month") {
        const formatMap = {
            day: "yyyy-MM-dd",
            week: "yyyy-'W'ww",
            month: "yyyy-MM"
        };
        const format = formatMap[groupBy];

        query = `
            SELECT 
                FORMAT(CFECHA, '${format}') AS periodo,
                SUM(CTOTAL) AS total_pagos,
                COUNT(*) AS cantidad_pagos,
                COUNT(DISTINCT CIDCLIENTEPROVEEDOR) AS proveedores_pagados
            FROM dbo.v_pagos_proveedor
            ${whereClause}
            GROUP BY FORMAT(CFECHA, '${format}')
            ORDER BY periodo;
        `;
    }
    // Aggregation by supplier
    else if (groupBy === "supplier") {
        query = `
            SELECT 
                CIDCLIENTEPROVEEDOR,
                proveedor,
                SUM(CTOTAL) AS total_pagos,
                COUNT(*) AS cantidad_pagos
            FROM dbo.v_pagos_proveedor
            ${whereClause}
            GROUP BY CIDCLIENTEPROVEEDOR, proveedor
            ORDER BY total_pagos DESC;
        `;
    }
    // Raw data
    else {
        const dataLimit = limit ? parseInt(limit) : 100;
        query = `
            SELECT TOP(${dataLimit}) *
            FROM dbo.v_pagos_proveedor
            ${whereClause}
            ORDER BY CFECHA DESC, CIDDOCUMENTO DESC;
        `;
    }

    const result = await request.query(query);
    return result.recordset;
});

app.get("/metas", async (req, reply) => {
    const conn = await (poolPromise ??= pool.connect());
    const { year, month } = req.query;

    const currentYear = year ? parseInt(year) : new Date().getFullYear();
    const currentMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const prevYear = currentYear - 1;

    // Calculate consecutive previous month dynamically (wrapping to year - 1 if December)
    let prevCurMonth = currentMonth - 1;
    let prevCurYear = currentYear;
    if (prevCurMonth === 0) {
        prevCurMonth = 12;
        prevCurYear = currentYear - 1;
    }

    const request = conn.request();
    request.input("currentYear", sql.Int, currentYear);
    request.input("prevYear", sql.Int, prevYear);
    request.input("currentMonth", sql.Int, currentMonth);
    // New parameters for consecutive previous month
    request.input("prevCurYear", sql.Int, prevCurYear);
    request.input("prevCurMonth", sql.Int, prevCurMonth);

    // Using subtotal as value metric
    const query = `
        SELECT 
            c.CIDCLIENTEPROVEEDOR as id_cliente,
            c.CRAZONSOCIAL as cliente_name,
            LTRIM(RTRIM(a.CNOMBREAGENTE)) as agente,
            
            -- Venta Año Anterior
            ISNULL(SUM(CASE 
                WHEN YEAR(v.fecha) = @prevYear 
                THEN v.subtotal ELSE 0 
            END), 0) as venta_anio_anterior,
            
            -- Venta Mes Anterior (Mismo mes del año anterior)
            ISNULL(SUM(CASE 
                WHEN YEAR(v.fecha) = @prevYear AND MONTH(v.fecha) = @currentMonth
                THEN v.subtotal ELSE 0 
            END), 0) as venta_mes_anterior,
            
            -- Venta Año Actual
            ISNULL(SUM(CASE 
                WHEN YEAR(v.fecha) = @currentYear 
                THEN v.subtotal ELSE 0 
            END), 0) as venta_anio_actual,
            
            -- Venta Mes Actual
            ISNULL(SUM(CASE 
                WHEN YEAR(v.fecha) = @currentYear AND MONTH(v.fecha) = @currentMonth
                THEN v.subtotal ELSE 0 
            END), 0) as venta_mes_actual,

            -- Venta Mes Consecutivo Anterior (Mes anterior al actual seleccionado)
            ISNULL(SUM(CASE 
                WHEN YEAR(v.fecha) = @prevCurYear AND MONTH(v.fecha) = @prevCurMonth
                THEN v.subtotal ELSE 0 
            END), 0) as venta_mes_anterior_actual

        FROM dbo.admClientes c
        LEFT JOIN dbo.admAgentes a ON c.CIDAGENTEVENTA = a.CIDAGENTE
        LEFT JOIN dbo.v_fact_ventas v ON v.id_cliente = c.CIDCLIENTEPROVEEDOR
        WHERE c.CTIPOCLIENTE = 1 -- Solo clientes
          -- Optimization: filter only relevant years
          AND (v.fecha IS NULL OR YEAR(v.fecha) IN (@currentYear, @prevYear, @prevCurYear))
        GROUP BY c.CIDCLIENTEPROVEEDOR, c.CRAZONSOCIAL, a.CNOMBREAGENTE
        HAVING 
            SUM(CASE WHEN YEAR(v.fecha) = @prevYear THEN v.subtotal ELSE 0 END) > 0 OR
            SUM(CASE WHEN YEAR(v.fecha) = @currentYear THEN v.subtotal ELSE 0 END) > 0 OR
            SUM(CASE WHEN YEAR(v.fecha) = @prevCurYear THEN v.subtotal ELSE 0 END) > 0
        ORDER BY venta_anio_actual DESC;
    `;

    const result = await request.query(query);
    return result.recordset;
});

app.listen({ host: "0.0.0.0", port: PORT });

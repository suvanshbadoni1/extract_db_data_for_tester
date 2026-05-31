require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const oracledb = require('oracledb');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// PRM Database configuration (MSSQL)
const mssqlConfig = {
    user: process.env.MSSQL_USER || 'test_user',
    password: process.env.MSSQL_PASSWORD || 'test123',
    server: process.env.MSSQL_SERVER || '10.230.195.68',
    database: process.env.MSSQL_DATABASE || 'PRMNRT',
    port: parseInt(process.env.MSSQL_PORT) || 14889,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectionTimeout: 30000,
        requestTimeout: 30000
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// UPF Database (Oracle 1) - Updated with actual credentials
const oracle1Config = {
    user: process.env.ORACLE1_USER || 'upfdev4',
    password: process.env.ORACLE1_PASSWORD || 'upfdev4',
    connectString: process.env.ORACLE1_CONNECT_STRING || '10.230.195.68:1521/UPFDB',
    poolAlias: 'upf',
    poolMin: 1,
    poolMax: 10,
    poolIncrement: 1,
    poolTimeout: 60,
    connectTimeout: 30
};

// EPS Database (Oracle 2) - Update when you have credentials
const oracle2Config = {
    user: process.env.ORACLE2_USER || 'eps_user',
    password: process.env.ORACLE2_PASSWORD || '',
    connectString: process.env.ORACLE2_CONNECT_STRING || '10.230.195.68:1521/EPSDB',
    poolAlias: 'eps',
    poolMin: 1,
    poolMax: 10,
    poolIncrement: 1,
    poolTimeout: 60,
    connectTimeout: 30
};

// Connection pools
let mssqlPool = null;
let oracle1Pool = null;
let oracle2Pool = null;
let connectionStatus = {
    prm: false,
    upf: false,
    eps: false,
    prmError: null,
    upfError: null,
    epsError: null
};

// Initialize connections
async function initializeDatabases() {
    console.log('\n🔌 Initializing Database Connections...\n');
    
    // Initialize PRM (MSSQL)
    try {
        console.log(`Connecting to PRM Database:`);
        console.log(`   Server: ${mssqlConfig.server}:${mssqlConfig.port}`);
        console.log(`   Database: ${mssqlConfig.database}`);
        console.log(`   User: ${mssqlConfig.user}`);
        
        mssqlPool = await sql.connect(mssqlConfig);
        connectionStatus.prm = true;
        connectionStatus.prmError = null;
        console.log('✅ PRM (MSSQL) Database - Connected successfully');
        
        // Test the connection
        const testResult = await mssqlPool.request().query('SELECT @@VERSION as version, GETDATE() as currentTime, DB_NAME() as dbName');
        console.log(`   PRM Version: ${testResult.recordset[0].version.substring(0, 60)}...`);
        console.log(`   Current Database: ${testResult.recordset[0].dbName}`);
        
    } catch (err) {
        connectionStatus.prm = false;
        connectionStatus.prmError = err.message;
        console.log('❌ PRM (MSSQL) Database - Connection failed:', err.message);
    }
    
    // Initialize UPF (Oracle 1)
    try {
        console.log(`\nConnecting to UPF Database (Oracle):`);
        console.log(`   Connect String: ${oracle1Config.connectString}`);
        console.log(`   User: ${oracle1Config.user}`);
        
        if (process.env.ORACLE_CLIENT_PATH) {
            oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_PATH });
        }
        
        oracle1Pool = await oracledb.createPool(oracle1Config);
        
        // Test the connection
        let testConn = await oracle1Pool.getConnection();
        const result = await testConn.execute('SELECT USER, SYSDATE FROM DUAL');
        await testConn.close();
        
        connectionStatus.upf = true;
        connectionStatus.upfError = null;
        console.log('✅ UPF (Oracle 1) Database - Connected successfully');
        console.log(`   Connected as: ${result.rows[0][0]}`);
        
        // Check ep_log table exists
        let checkConn = await oracle1Pool.getConnection();
        try {
            const tableCheck = await checkConn.execute(`SELECT COUNT(*) FROM ep_log WHERE ROWNUM = 1`);
            console.log(`   ✅ ep_log table is accessible`);
        } catch (tableErr) {
            console.log(`   ⚠️  ep_log table check: ${tableErr.message}`);
        }
        await checkConn.close();
        
    } catch (err) {
        connectionStatus.upf = false;
        connectionStatus.upfError = err.message;
        console.log('❌ UPF (Oracle 1) Database - Connection failed:', err.message);
        if (err.errorNum) console.log(`   Oracle Error Number: ${err.errorNum}`);
        oracle1Pool = null;
    }
    
    // Initialize EPS (Oracle 2)
    try {
        console.log(`\nConnecting to EPS Database (Oracle):`);
        console.log(`   Connect String: ${oracle2Config.connectString}`);
        console.log(`   User: ${oracle2Config.user}`);
        
        oracle2Pool = await oracledb.createPool(oracle2Config);
        
        let testConn = await oracle2Pool.getConnection();
        await testConn.execute('SELECT 1 FROM DUAL');
        await testConn.close();
        
        connectionStatus.eps = true;
        connectionStatus.epsError = null;
        console.log('✅ EPS PTLF (Oracle 2) Database - Connected successfully');
        
    } catch (err) {
        connectionStatus.eps = false;
        connectionStatus.epsError = err.message;
        console.log('❌ EPS PTLF (Oracle 2) Database - Connection failed:', err.message);
        oracle2Pool = null;
    }
    
    // Summary
    console.log('\n📊 Connection Summary:');
    console.log(`   PRM (MSSQL): ${connectionStatus.prm ? '🟢 Online' : '🔴 Offline'}`);
    console.log(`   UPF (Oracle): ${connectionStatus.upf ? '🟢 Online' : '🔴 Offline'}`);
    console.log(`   EPS (Oracle): ${connectionStatus.eps ? '🟢 Online' : '🔴 Offline'}`);
    console.log();
}

// Function to format JSON data beautifully
function formatJSONData(jsonString) {
    if (!jsonString) return null;
    try {
        // If it's already an object, return it
        if (typeof jsonString === 'object') return jsonString;
        // Otherwise parse it
        return JSON.parse(jsonString);
    } catch (e) {
        return { raw_value: jsonString, parse_error: e.message };
    }
}

// PRM Query endpoint - Using actual table and columns
app.post('/api/prm/query', async (req, res) => {
    const { pan, rrn, stan } = req.body;
    
    if (!mssqlPool || !connectionStatus.prm) {
        return res.json({
            success: false,
            database: 'PRM (MSSQL)',
            error: connectionStatus.prmError || 'Database is not connected',
            data: [],
            count: 0,
            connectionError: true,
            isConnected: false
        });
    }
    
    try {
        // Query using actual column names: sd_pan for PAN, SD_REF_NUM for RRN
        let query = `
            SELECT * 
            FROM [PRMNRT].[dbo].[DETAIL]
            WHERE 1=1
        `;
        
        const request = mssqlPool.request();
        
        if (pan && pan.trim()) {
            query += ` AND sd_pan = @pan`;
            request.input('pan', sql.VarChar, pan);
        }
        
        if (rrn && rrn.trim()) {
            query += ` AND SD_REF_NUM = @rrn`;
            request.input('rrn', sql.VarChar, rrn);
        }
        
        if (stan && stan.trim()) {
            query += ` AND stan = @stan`;
            request.input('stan', sql.VarChar, stan);
        }
        
        console.log(`PRM Query - PAN: ${pan}, RRN: ${rrn}, STAN: ${stan}`);
        
        const result = await request.query(query);
        
        console.log(`PRM Query completed - Found ${result.recordset.length} records`);
        
        // Process the results - format any JSON fields
        const formattedData = result.recordset.map(record => {
            const formatted = {};
            for (const [key, value] of Object.entries(record)) {
                // Check if value looks like JSON
                if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
                    formatted[key] = formatJSONData(value);
                } else {
                    formatted[key] = value;
                }
            }
            return formatted;
        });
        
        res.json({
            success: true,
            database: 'PRM (MSSQL)',
            data: formattedData,
            count: formattedData.length,
            connectionError: false,
            isConnected: true
        });
    } catch (err) {
        console.error('PRM Query Error:', err);
        res.json({
            success: false,
            database: 'PRM (MSSQL)',
            error: err.message,
            data: [],
            count: 0,
            connectionError: false,
            isConnected: true
        });
    }
});

// UPF Query endpoint (Oracle 1) - Using ep_log table
app.post('/api/upf/query', async (req, res) => {
    const { pan, rrn, stan } = req.body;
    let connection;
    
    if (!oracle1Pool || !connectionStatus.upf) {
        return res.json({
            success: false,
            database: 'UPF (Oracle 1)',
            error: connectionStatus.upfError || 'UPF Database is not connected',
            data: [],
            count: 0,
            connectionError: true,
            isConnected: false
        });
    }
    
    try {
        connection = await oracle1Pool.getConnection();
        
        // Build query based on provided parameters
        let query = `
            SELECT 
                stan,
                msg_tp,
                ext,
                trx_dt,
                trx_tm,
                pan as masked_pan,
                JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Cntxt.SaleCntxt.SaleRefNb') as rrn,
                JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Cntxt.SaleCntxt.PAN') as pan_from_json,
                JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Cntxt.SaleCntxt.Amt') as amount,
                JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Cntxt.SaleCntxt.Ccy') as currency,
                JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Rspn.RspnCd') as response_code
            FROM ep_log
            WHERE 1=1
        `;
        
        const params = {};
        
        if (stan && stan.trim()) {
            query += ` AND stan = :stan`;
            params.stan = stan;
        }
        
        if (rrn && rrn.trim()) {
            query += ` AND JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Cntxt.SaleCntxt.SaleRefNb') = :rrn`;
            params.rrn = rrn;
        }
        
        if (pan && pan.trim()) {
            // PAN might be masked or full - search in JSON
            query += ` AND (pan = :pan OR JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Cntxt.SaleCntxt.PAN') LIKE :panPattern)`;
            params.pan = pan;
            params.panPattern = `%${pan}%`;
        }
        
        query += ` ORDER BY trx_dt DESC, trx_tm DESC`;
        
        console.log(`UPF Query - STAN: ${stan}, RRN: ${rrn}, PAN: ${pan}`);
        
        const result = await connection.execute(query, params);
        
        // Format the results with parsed JSON
        const formattedData = [];
        
        for (const row of result.rows) {
            const formattedRow = {
                stan: row[0],
                msg_tp: row[1],
                trx_dt: row[2],
                trx_tm: row[3],
                masked_pan: row[4] ? maskPAN(row[4]) : null,
                rrn: row[5],
                pan_from_json: row[6] ? maskPAN(row[6]) : null,
                amount: row[7],
                currency: row[8],
                response_code: row[9],
                // Full JSON data parsed
                full_json_data: formatJSONData(row[1] === 'AccptrCmpltnAdvc' ? row[2] : null)
            };
            
            // Parse the entire ext JSON if exists
            if (row[2]) {
                const parsedJSON = formatJSONData(row[2]);
                if (parsedJSON && typeof parsedJSON === 'object') {
                    formattedRow.parsed_ext_json = parsedJSON;
                }
            }
            
            formattedData.push(formattedRow);
        }
        
        console.log(`UPF Query completed - Found ${formattedData.length} records`);
        
        res.json({
            success: true,
            database: 'UPF (Oracle 1)',
            data: formattedData,
            count: formattedData.length,
            connectionError: false,
            isConnected: true
        });
        
    } catch (err) {
        console.error('UPF Query Error:', err);
        res.json({
            success: false,
            database: 'UPF (Oracle 1)',
            error: err.message,
            data: [],
            count: 0,
            connectionError: false,
            isConnected: true
        });
    } finally {
        if (connection) await connection.close();
    }
});

// Helper function to mask PAN (show first 6 and last 4)
function maskPAN(pan) {
    if (!pan || pan.length < 10) return pan;
    const panStr = pan.toString();
    if (panStr.length <= 10) return panStr;
    return `${panStr.substring(0, 6)}******${panStr.substring(panStr.length - 4)}`;
}

// EPS Query endpoint (Oracle 2)
app.post('/api/eps/query', async (req, res) => {
    const { pan, rrn, stan } = req.body;
    let connection;
    
    if (!oracle2Pool || !connectionStatus.eps) {
        return res.json({
            success: false,
            database: 'EPS PTLF (Oracle 2)',
            error: connectionStatus.epsError || 'EPS Database is not connected',
            data: [],
            count: 0,
            connectionError: true,
            isConnected: false
        });
    }
    
    try {
        connection = await oracle2Pool.getConnection();
        
        // Basic query for EPS - Update based on actual table structure
        let query = `
            SELECT * FROM EPS_PTLF_RECORDS
            WHERE 1=1
        `;
        
        const params = {};
        
        if (pan && pan.trim()) {
            query += ` AND PAN = :pan`;
            params.pan = pan;
        }
        
        if (rrn && rrn.trim()) {
            query += ` AND RRN = :rrn`;
            params.rrn = rrn;
        }
        
        if (stan && stan.trim()) {
            query += ` AND STAN = :stan`;
            params.stan = stan;
        }
        
        // If no specific query, return limited records
        if (Object.keys(params).length === 0) {
            query = `SELECT * FROM EPS_PTLF_RECORDS WHERE ROWNUM <= 10`;
        }
        
        console.log(`EPS Query - PAN: ${pan}, RRN: ${rrn}, STAN: ${stan}`);
        
        const result = await connection.execute(query, params);
        
        // Format Oracle data
        const formattedData = result.rows.map(row => {
            const obj = {};
            if (result.metaData) {
                result.metaData.forEach((col, index) => {
                    let value = row[index];
                    if (value && typeof value === 'object' && value.toISOString) {
                        value = value.toISOString();
                    }
                    // Mask PAN if found
                    if (col.name.toUpperCase() === 'PAN' && value) {
                        value = maskPAN(value);
                    }
                    obj[col.name.toLowerCase()] = value;
                });
            }
            return obj;
        });
        
        res.json({
            success: true,
            database: 'EPS PTLF (Oracle 2)',
            data: formattedData,
            count: formattedData.length,
            connectionError: false,
            isConnected: true
        });
        
    } catch (err) {
        console.error('EPS Query Error:', err);
        res.json({
            success: false,
            database: 'EPS PTLF (Oracle 2)',
            error: err.message,
            data: [],
            count: 0,
            connectionError: false,
            isConnected: true
        });
    } finally {
        if (connection) await connection.close();
    }
});

// Debug endpoints
app.get('/api/prm/columns', async (req, res) => {
    if (!mssqlPool || !connectionStatus.prm) {
        return res.json({ error: 'PRM Database not connected' });
    }
    
    try {
        const result = await mssqlPool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'DETAIL'
            ORDER BY ORDINAL_POSITION
        `);
        res.json({
            success: true,
            columns: result.recordset
        });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.get('/api/upf/tables', async (req, res) => {
    let connection;
    try {
        if (!oracle1Pool || !connectionStatus.upf) {
            return res.json({ error: 'UPF Database not connected' });
        }
        
        connection = await oracle1Pool.getConnection();
        const result = await connection.execute(`
            SELECT table_name FROM user_tables ORDER BY table_name
        `);
        
        const tables = result.rows.map(row => row[0]);
        res.json({
            success: true,
            tables: tables,
            count: tables.length
        });
    } catch (err) {
        res.json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    let prmAlive = false;
    let upfAlive = false;
    let epsAlive = false;
    
    if (mssqlPool && connectionStatus.prm) {
        try {
            await mssqlPool.request().query('SELECT 1');
            prmAlive = true;
        } catch (err) {
            prmAlive = false;
        }
    }
    
    if (oracle1Pool && connectionStatus.upf) {
        let conn;
        try {
            conn = await oracle1Pool.getConnection();
            await conn.execute('SELECT 1 FROM DUAL');
            upfAlive = true;
        } catch (err) {
            upfAlive = false;
        } finally {
            if (conn) await conn.close();
        }
    }
    
    if (oracle2Pool && connectionStatus.eps) {
        let conn;
        try {
            conn = await oracle2Pool.getConnection();
            await conn.execute('SELECT 1 FROM DUAL');
            epsAlive = true;
        } catch (err) {
            epsAlive = false;
        } finally {
            if (conn) await conn.close();
        }
    }
    
    res.json({
        prm: prmAlive,
        upf: upfAlive,
        eps: epsAlive,
        timestamp: new Date().toISOString()
    });
});

// Serve HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function startServer() {
    await initializeDatabases();
    
    app.listen(port, () => {
        console.log(`\n🚀 Server running on http://localhost:${port}`);
        console.log(`📱 Open your browser to use the application\n`);
        console.log(`🔍 Debug Endpoints:`);
        console.log(`   - PRM Columns: http://localhost:${port}/api/prm/columns`);
        console.log(`   - UPF Tables: http://localhost:${port}/api/upf/tables`);
        console.log(`   - Health Check: http://localhost:${port}/api/health\n`);
    });
}

startServer();
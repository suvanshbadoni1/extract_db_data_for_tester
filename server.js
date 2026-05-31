require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const oracledb = require('oracledb');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Create logs directory if it doesn't exist
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Simple logging function
function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${message}\n`;
    fs.appendFileSync(path.join(logsDir, 'app.log'), logMessage);
    console.log(message);
}

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

// UPF Database (Oracle 1)
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

// EPS Database (Oracle 2)
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
    logToFile('\n🔌 Initializing Database Connections...\n');
    
    // Initialize PRM (MSSQL)
    try {
        logToFile(`Connecting to PRM Database:`);
        logToFile(`   Server: ${mssqlConfig.server}:${mssqlConfig.port}`);
        logToFile(`   Database: ${mssqlConfig.database}`);
        logToFile(`   User: ${mssqlConfig.user}`);
        
        mssqlPool = await sql.connect(mssqlConfig);
        connectionStatus.prm = true;
        connectionStatus.prmError = null;
        logToFile('✅ PRM (MSSQL) Database - Connected successfully');
        
        const testResult = await mssqlPool.request().query('SELECT @@VERSION as version, GETDATE() as currentTime, DB_NAME() as dbName');
        logToFile(`   PRM Version: ${testResult.recordset[0].version.substring(0, 60)}...`);
        logToFile(`   Current Database: ${testResult.recordset[0].dbName}`);
        
    } catch (err) {
        connectionStatus.prm = false;
        connectionStatus.prmError = err.message;
        logToFile('❌ PRM (MSSQL) Database - Connection failed: ' + err.message);
    }
    
    // Initialize UPF (Oracle 1)
    try {
        logToFile(`\nConnecting to UPF Database (Oracle):`);
        logToFile(`   Connect String: ${oracle1Config.connectString}`);
        logToFile(`   User: ${oracle1Config.user}`);
        
        if (process.env.ORACLE_CLIENT_PATH) {
            oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_PATH });
        }
        
        oracle1Pool = await oracledb.createPool(oracle1Config);
        
        let testConn = await oracle1Pool.getConnection();
        const result = await testConn.execute('SELECT USER, SYSDATE FROM DUAL');
        await testConn.close();
        
        connectionStatus.upf = true;
        connectionStatus.upfError = null;
        logToFile('✅ UPF (Oracle 1) Database - Connected successfully');
        logToFile(`   Connected as: ${result.rows[0][0]}`);
        
        let checkConn = await oracle1Pool.getConnection();
        try {
            const tableCheck = await checkConn.execute(`SELECT COUNT(*) FROM ep_log WHERE ROWNUM = 1`);
            logToFile(`   ✅ ep_log table is accessible`);
        } catch (tableErr) {
            logToFile(`   ⚠️  ep_log table check: ${tableErr.message}`);
        }
        await checkConn.close();
        
    } catch (err) {
        connectionStatus.upf = false;
        connectionStatus.upfError = err.message;
        logToFile('❌ UPF (Oracle 1) Database - Connection failed: ' + err.message);
        oracle1Pool = null;
    }
    
    // Initialize EPS (Oracle 2)
    try {
        logToFile(`\nConnecting to EPS Database (Oracle):`);
        logToFile(`   Connect String: ${oracle2Config.connectString}`);
        logToFile(`   User: ${oracle2Config.user}`);
        
        oracle2Pool = await oracledb.createPool(oracle2Config);
        
        let testConn = await oracle2Pool.getConnection();
        await testConn.execute('SELECT 1 FROM DUAL');
        await testConn.close();
        
        connectionStatus.eps = true;
        connectionStatus.epsError = null;
        logToFile('✅ EPS PTLF (Oracle 2) Database - Connected successfully');
        
    } catch (err) {
        connectionStatus.eps = false;
        connectionStatus.epsError = err.message;
        logToFile('❌ EPS PTLF (Oracle 2) Database - Connection failed: ' + err.message);
        oracle2Pool = null;
    }
    
    // Summary
    logToFile('\n📊 Connection Summary:');
    logToFile(`   PRM (MSSQL): ${connectionStatus.prm ? '🟢 Online' : '🔴 Offline'}`);
    logToFile(`   UPF (Oracle): ${connectionStatus.upf ? '🟢 Online' : '🔴 Offline'}`);
    logToFile(`   EPS (Oracle): ${connectionStatus.eps ? '🟢 Online' : '🔴 Offline'}`);
    logToFile('');
}

// Format JSON data
function formatJSONData(jsonString) {
    if (!jsonString) return null;
    try {
        if (typeof jsonString === 'object') return jsonString;
        return JSON.parse(jsonString);
    } catch (e) {
        return { raw_value: jsonString, parse_error: e.message };
    }
}

// Mask PAN (show first 6 and last 4)
function maskPAN(pan) {
    if (!pan || pan.length < 10) return pan;
    const panStr = pan.toString();
    if (panStr.length <= 10) return panStr;
    return `${panStr.substring(0, 6)}******${panStr.substring(panStr.length - 4)}`;
}

// PRM Query endpoint
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
        let query = `SELECT * FROM [PRMNRT].[dbo].[DETAIL] WHERE 1=1`;
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
        
        logToFile(`PRM Query - PAN: ${pan}, RRN: ${rrn}, STAN: ${stan}`);
        
        const result = await request.query(query);
        
        logToFile(`PRM Query completed - Found ${result.recordset.length} records`);
        
        const formattedData = result.recordset.map(record => {
            const formatted = {};
            for (const [key, value] of Object.entries(record)) {
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
        logToFile('PRM Query Error: ' + err.message);
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

// UPF Query endpoint (Oracle 1) - FIXED WITH CORRECT JSON PATHS
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
        
        // Build query dynamically based on provided parameters
        let query = `
            SELECT 
                stan,
                msg_tp,
                ext,
                trx_dt,
                trx_tm,
                JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Cntxt.SaleCntxt.SaleRefNb') as rrn,
                JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Envt.Card.PlainCardData.PAN') as pan_from_json,
                JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Cntxt.SaleCntxt.Amt') as amount,
                JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Cntxt.SaleCntxt.Ccy') as currency,
                JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Rspn.RspnCd') as response_code
            FROM ep_log
            WHERE msg_tp = 'AccptrCmpltnAdvc'
        `;
        
        const params = {};
        
        // Add conditions based on what's provided
        if (stan && stan.trim()) {
            query += ` AND stan = :stan`;
            params.stan = stan;
        }
        
        if (rrn && rrn.trim()) {
            query += ` AND JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Cntxt.SaleCntxt.SaleRefNb') = :rrn`;
            params.rrn = rrn;
        }
        
        if (pan && pan.trim()) {
            query += ` AND JSON_VALUE(ext, '$.AccptrCmpltnAdvc.CmpltnAdvc.Envt.Card.PlainCardData.PAN') = :pan`;
            params.pan = pan;
        }
        
        // If NO stan provided, don't filter by stan
        // The query already has msg_tp filter only
        
        query += ` ORDER BY trx_dt DESC, trx_tm DESC`;
        
        console.log(`UPF Query - STAN: ${stan || 'NOT PROVIDED'}, RRN: ${rrn || 'NOT PROVIDED'}, PAN: ${pan || 'NOT PROVIDED'}`);
        
        const result = await connection.execute(query, params);
        
        console.log(`UPF Query completed - Found ${result.rows.length} records`);
        
        const formattedData = [];
        
        for (const row of result.rows) {
            const formattedRow = {
                stan: row[0],
                msg_tp: row[1],
                transaction_date: row[3],
                transaction_time: row[4],
                rrn: row[5],
                pan: row[6] ? maskPAN(row[6]) : null,
                amount: row[7],
                currency: row[8],
                response_code: row[9]
            };
            
            // Parse and include full JSON data for reference
            if (row[2]) {
                try {
                    const extJson = typeof row[2] === 'string' ? JSON.parse(row[2]) : row[2];
                    formattedRow.full_json_data = extJson;
                } catch (e) {
                    formattedRow.full_json_data = { raw: row[2], parse_error: e.message };
                }
            }
            
            formattedData.push(formattedRow);
        }
        
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
        
        let query = `SELECT * FROM EPS_PTLF_RECORDS WHERE 1=1`;
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
        
        if (Object.keys(params).length === 0) {
            query = `SELECT * FROM EPS_PTLF_RECORDS WHERE ROWNUM <= 10`;
        }
        
        logToFile(`EPS Query - PAN: ${pan}, RRN: ${rrn}, STAN: ${stan}`);
        
        const result = await connection.execute(query, params);
        
        const formattedData = result.rows.map(row => {
            const obj = {};
            if (result.metaData) {
                result.metaData.forEach((col, index) => {
                    let value = row[index];
                    if (value && typeof value === 'object' && value.toISOString) {
                        value = value.toISOString();
                    }
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
        logToFile('EPS Query Error: ' + err.message);
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

// Serve HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function startServer() {
    await initializeDatabases();
    
    app.listen(port, () => {
        logToFile(`\n🚀 Server running on http://localhost:${port}`);
        logToFile(`📱 Open your browser to use the application\n`);
        logToFile(`🔍 Debug Endpoints:`);
        logToFile(`   - PRM Columns: http://localhost:${port}/api/prm/columns`);
        logToFile(`   - UPF Tables: http://localhost:${port}/api/upf/tables`);
        logToFile(`   - Health Check: http://localhost:${port}/api/health\n`);
    });
}

startServer();
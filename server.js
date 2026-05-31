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

// PRM Database configuration (MSSQL) - Updated with your credentials
const mssqlConfig = {
    user: process.env.MSSQL_USER || 'test_user',
    password: process.env.MSSQL_PASSWORD || 'test123',
    server: process.env.MSSQL_SERVER || '10.230.195.68',
    database: process.env.MSSQL_DATABASE || 'PRMNRT',
    port: parseInt(process.env.MSSQL_PORT) || 14889,
    options: {
        encrypt: false,  // Set to false for local/internal connections
        trustServerCertificate: true,  // Important for self-signed certificates
        enableArithAbort: true,
        connectionTimeout: 30000,
        requestTimeout: 30000,
        instanceName: ''
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Oracle 1 (UPF) Configuration - Update with your actual values
const oracle1Config = {
    user: process.env.ORACLE1_USER || 'upf_user',
    password: process.env.ORACLE1_PASSWORD || '',
    connectString: process.env.ORACLE1_CONNECT_STRING || 'localhost:1521/UPFDB'
};

// Oracle 2 (EPS) Configuration - Update with your actual values
const oracle2Config = {
    user: process.env.ORACLE2_USER || 'eps_user',
    password: process.env.ORACLE2_PASSWORD || '',
    connectString: process.env.ORACLE2_CONNECT_STRING || 'localhost:1521/EPSDB'
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

// Initialize connections with detailed status
async function initializeDatabases() {
    console.log('\n🔌 Initializing Database Connections...\n');
    
    // Initialize MSSQL (PRM) - Using your actual database
    try {
        console.log(`Attempting to connect to PRM Database:`);
        console.log(`   Server: ${mssqlConfig.server}:${mssqlConfig.port}`);
        console.log(`   Database: ${mssqlConfig.database}`);
        console.log(`   User: ${mssqlConfig.user}`);
        
        mssqlPool = await sql.connect(mssqlConfig);
        connectionStatus.prm = true;
        connectionStatus.prmError = null;
        console.log('✅ PRM (MSSQL) Database - Connected successfully');
        
        // Test the connection with a simple query
        const testResult = await mssqlPool.request().query('SELECT @@VERSION as version, GETDATE() as currentTime');
        console.log(`   PRM Connection verified - SQL Server Version: ${testResult.recordset[0].version.substring(0, 50)}...`);
        
        // Test your actual table exists
        try {
            const tableCheck = await mssqlPool.request().query('SELECT TOP 1 * FROM [PRMNRT].[dbo].[DETAIL]');
            console.log(`   Table 'DETAIL' is accessible - Found ${tableCheck.recordset.length} sample record(s)`);
        } catch (tableErr) {
            console.log(`   ⚠️  Table 'DETAIL' check: ${tableErr.message}`);
        }
        
    } catch (err) {
        connectionStatus.prm = false;
        connectionStatus.prmError = err.message;
        console.log('❌ PRM (MSSQL) Database - Connection failed:', err.message);
        if (err.code) console.log(`   Error Code: ${err.code}`);
        if (err.number) console.log(`   SQL Error Number: ${err.number}`);
    }
    
    // Initialize Oracle 1 (UPF)
    try {
        if (process.env.ORACLE_CLIENT_PATH) {
            oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_PATH });
        }
        oracle1Pool = await oracledb.createPool({
            ...oracle1Config,
            poolMin: 1,
            poolMax: 5,
            poolIncrement: 1
        });
        
        // Test the connection
        let testConn = await oracle1Pool.getConnection();
        await testConn.execute('SELECT 1 FROM DUAL');
        await testConn.close();
        
        connectionStatus.upf = true;
        connectionStatus.upfError = null;
        console.log('✅ UPF (Oracle 1) Database - Connected successfully');
    } catch (err) {
        connectionStatus.upf = false;
        connectionStatus.upfError = err.message;
        console.log('❌ UPF (Oracle 1) Database - Connection failed:', err.message);
        oracle1Pool = null;
    }
    
    // Initialize Oracle 2 (EPS)
    try {
        oracle2Pool = await oracledb.createPool({
            ...oracle2Config,
            poolMin: 1,
            poolMax: 5,
            poolIncrement: 1
        });
        
        // Test the connection
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
    
    console.log('\n📊 Connection Summary:');
    console.log(`   PRM (MSSQL): ${connectionStatus.prm ? '🟢 Online' : '🔴 Offline'}${connectionStatus.prmError ? ` - ${connectionStatus.prmError}` : ''}`);
    console.log(`   UPF (Oracle): ${connectionStatus.upf ? '🟢 Online' : '🔴 Offline'}${connectionStatus.upfError ? ` - ${connectionStatus.upfError}` : ''}`);
    console.log(`   EPS (Oracle): ${connectionStatus.eps ? '🟢 Online' : '🔴 Offline'}${connectionStatus.epsError ? ` - ${connectionStatus.epsError}` : ''}\n`);
}

// PRM Query endpoint - Using your actual DETAIL table
app.post('/api/prm/query', async (req, res) => {
    const { pan, rrn, stan } = req.body;
    
    if (!mssqlPool || !connectionStatus.prm) {
        return res.json({
            success: false,
            database: 'PRM (MSSQL)',
            error: connectionStatus.prmError || 'Database is not connected. Please check your MSSQL configuration.',
            data: [],
            count: 0,
            connectionError: true,
            isConnected: false
        });
    }
    
    try {
        // Query your actual DETAIL table
        // Adjust the WHERE clause based on your actual column names
        // Assuming your DETAIL table has columns like PAN, RRN, STAN
        // If column names are different, please update them below
        const query = `
            SELECT * 
            FROM [PRMNRT].[dbo].[DETAIL]
            WHERE PAN = @pan 
               OR RRN = @rrn 
               OR STAN = @stan
        `;
        
        console.log(`PRM Query - PAN: ${pan}, RRN: ${rrn}, STAN: ${stan}`);
        
        const request = mssqlPool.request();
        request.input('pan', sql.VarChar, pan);
        request.input('rrn', sql.VarChar, rrn);
        request.input('stan', sql.VarChar, stan);
        
        const result = await request.query(query);
        
        console.log(`PRM Query completed - Found ${result.recordset.length} records`);
        
        res.json({
            success: true,
            database: 'PRM (MSSQL)',
            data: result.recordset,
            count: result.recordset.length,
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

// Alternative PRM query that shows all records (for testing)
app.get('/api/prm/all', async (req, res) => {
    if (!mssqlPool || !connectionStatus.prm) {
        return res.json({
            success: false,
            error: 'Database not connected'
        });
    }
    
    try {
        const result = await mssqlPool.request().query('SELECT TOP 100 * FROM [PRMNRT].[dbo].[DETAIL]');
        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });
    } catch (err) {
        console.error('Error fetching all records:', err);
        res.json({
            success: false,
            error: err.message
        });
    }
});

// Get table structure for debugging
app.get('/api/prm/structure', async (req, res) => {
    if (!mssqlPool || !connectionStatus.prm) {
        return res.json({
            success: false,
            error: 'Database not connected'
        });
    }
    
    try {
        const query = `
            SELECT 
                COLUMN_NAME, 
                DATA_TYPE, 
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'DETAIL'
            ORDER BY ORDINAL_POSITION
        `;
        
        const result = await mssqlPool.request().query(query);
        res.json({
            success: true,
            columns: result.recordset
        });
    } catch (err) {
        console.error('Error fetching table structure:', err);
        res.json({
            success: false,
            error: err.message
        });
    }
});

// UPF Query endpoint (Oracle 1)
app.post('/api/upf/query', async (req, res) => {
    const { pan, rrn, stan } = req.body;
    let connection;
    
    if (!oracle1Pool || !connectionStatus.upf) {
        return res.json({
            success: false,
            database: 'UPF (Oracle 1)',
            error: connectionStatus.upfError || 'Database is not connected. Please check your Oracle UPF configuration.',
            data: [],
            count: 0,
            connectionError: true,
            isConnected: false
        });
    }
    
    try {
        connection = await oracle1Pool.getConnection();
        
        // Update this query based on your UPF table structure
        const query = `
            SELECT * FROM UPF_TRANSACTIONS
            WHERE PAN = :pan OR RRN = :rrn OR STAN = :stan
        `;
        
        const result = await connection.execute(query, { pan, rrn, stan });
        
        // Format Oracle data
        const formattedData = result.rows.map(row => {
            const obj = {};
            if (result.metaData) {
                result.metaData.forEach((col, index) => {
                    obj[col.name.toLowerCase()] = row[index];
                });
            }
            return obj;
        });
        
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
            error: connectionStatus.epsError || 'Database is not connected. Please check your Oracle EPS configuration.',
            data: [],
            count: 0,
            connectionError: true,
            isConnected: false
        });
    }
    
    try {
        connection = await oracle2Pool.getConnection();
        
        // Update this query based on your EPS table structure
        const query = `
            SELECT * FROM EPS_PTLF_RECORDS
            WHERE PAN = :pan OR RRN = :rrn OR STAN = :stan
        `;
        
        const result = await connection.execute(query, { pan, rrn, stan });
        
        // Format Oracle data
        const formattedData = result.rows.map(row => {
            const obj = {};
            if (result.metaData) {
                result.metaData.forEach((col, index) => {
                    obj[col.name.toLowerCase()] = row[index];
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

// Health check endpoint
app.get('/api/health', async (req, res) => {
    let prmAlive = false;
    let upfAlive = false;
    let epsAlive = false;
    
    // Check PRM
    if (mssqlPool && connectionStatus.prm) {
        try {
            await mssqlPool.request().query('SELECT 1');
            prmAlive = true;
        } catch (err) {
            prmAlive = false;
            connectionStatus.prm = false;
            connectionStatus.prmError = err.message;
        }
    }
    
    // Check UPF
    if (oracle1Pool && connectionStatus.upf) {
        let conn;
        try {
            conn = await oracle1Pool.getConnection();
            await conn.execute('SELECT 1 FROM DUAL');
            upfAlive = true;
        } catch (err) {
            upfAlive = false;
            connectionStatus.upf = false;
            connectionStatus.upfError = err.message;
        } finally {
            if (conn) await conn.close();
        }
    }
    
    // Check EPS
    if (oracle2Pool && connectionStatus.eps) {
        let conn;
        try {
            conn = await oracle2Pool.getConnection();
            await conn.execute('SELECT 1 FROM DUAL');
            epsAlive = true;
        } catch (err) {
            epsAlive = false;
            connectionStatus.eps = false;
            connectionStatus.epsError = err.message;
        } finally {
            if (conn) await conn.close();
        }
    }
    
    const health = {
        prm: prmAlive,
        upf: upfAlive,
        eps: epsAlive,
        details: {
            prm: {
                connected: prmAlive,
                error: connectionStatus.prmError,
                server: mssqlConfig.server,
                database: mssqlConfig.database
            },
            upf: {
                connected: upfAlive,
                error: connectionStatus.upfError
            },
            eps: {
                connected: epsAlive,
                error: connectionStatus.epsError
            }
        },
        timestamp: new Date().toISOString()
    };
    
    res.json(health);
});

// Debug endpoint to see table structure
app.get('/api/debug/columns', async (req, res) => {
    if (!mssqlPool || !connectionStatus.prm) {
        return res.json({ error: 'PRM Database not connected' });
    }
    
    try {
        const result = await mssqlPool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'DETAIL'
        `);
        res.json({
            success: true,
            columns: result.recordset
        });
    } catch (err) {
        res.json({ error: err.message });
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
        console.log(`\n🚀 Server running on http://localhost:${port}`);
        console.log(`📱 Open your browser and navigate to the URL above\n`);
        console.log(`🔍 Debug URLs:`);
        console.log(`   - Check all PRM records: http://localhost:${port}/api/prm/all`);
        console.log(`   - Check DETAIL table structure: http://localhost:${port}/api/debug/columns`);
        console.log(`   - Health check: http://localhost:${port}/api/health\n`);
    });
}

startServer();
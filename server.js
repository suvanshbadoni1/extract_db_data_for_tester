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
        
        // Check DETAIL table
        try {
            const tableCheck = await mssqlPool.request().query('SELECT TOP 1 * FROM [PRMNRT].[dbo].[DETAIL]');
            console.log(`   ✅ DETAIL table is accessible`);
        } catch (tableErr) {
            console.log(`   ⚠️  DETAIL table check: ${tableErr.message}`);
        }
        
    } catch (err) {
        connectionStatus.prm = false;
        connectionStatus.prmError = err.message;
        console.log('❌ PRM (MSSQL) Database - Connection failed:', err.message);
        if (err.code) console.log(`   Error Code: ${err.code}`);
    }
    
    // Initialize UPF (Oracle 1)
    try {
        console.log(`\nConnecting to UPF Database (Oracle):`);
        console.log(`   Connect String: ${oracle1Config.connectString}`);
        console.log(`   User: ${oracle1Config.user}`);
        
        // Initialize Oracle client if path provided
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
    
    // Summary
    console.log('\n📊 Connection Summary:');
    console.log(`   PRM (MSSQL): ${connectionStatus.prm ? '🟢 Online' : '🔴 Offline'}`);
    console.log(`   UPF (Oracle): ${connectionStatus.upf ? '🟢 Online' : '🔴 Offline'}`);
    console.log(`   EPS (Oracle): ${connectionStatus.eps ? '🟢 Online' : '🔴 Offline'}`);
    
    if (connectionStatus.upfError) {
        console.log(`\n💡 UPF Connection Tips:`);
        console.log(`   1. Verify the service name is correct (UPFDB)`);
        console.log(`   2. Check if the Oracle listener is running on port 1521`);
        console.log(`   3. Ensure the database is accessible from this server`);
        console.log(`   4. Try using the full connection string: //10.230.195.68:1521/UPFDB`);
    }
    console.log();
}

// PRM Query endpoint - Query DETAIL table
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
        // Query your DETAIL table - Adjust column names as needed
        let query = `
            SELECT * 
            FROM [PRMNRT].[dbo].[DETAIL]
            WHERE 1=1
        `;
        
        const request = mssqlPool.request();
        
        // Add conditions if parameters are provided
        if (pan && pan.trim()) {
            query += ` AND (PAN = @pan OR CardNumber = @pan)`;
            request.input('pan', sql.VarChar, pan);
        }
        
        if (rrn && rrn.trim()) {
            query += ` AND (RRN = @rrn OR RetrievalReferenceNumber = @rrn)`;
            request.input('rrn', sql.VarChar, rrn);
        }
        
        if (stan && stan.trim()) {
            query += ` AND (STAN = @stan OR SystemTraceAuditNumber = @stan)`;
            request.input('stan', sql.VarChar, stan);
        }
        
        console.log(`PRM Query - PAN: ${pan}, RRN: ${rrn}, STAN: ${stan}`);
        
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

// UPF Query endpoint (Oracle 1)
app.post('/api/upf/query', async (req, res) => {
    const { pan, rrn, stan } = req.body;
    let connection;
    
    if (!oracle1Pool || !connectionStatus.upf) {
        return res.json({
            success: false,
            database: 'UPF (Oracle 1)',
            error: connectionStatus.upfError || 'UPF Database is not connected. Please check your Oracle configuration.',
            data: [],
            count: 0,
            connectionError: true,
            isConnected: false
        });
    }
    
    try {
        connection = await oracle1Pool.getConnection();
        
        // First, let's get all table names to help debug
        let query = `
            SELECT * FROM user_tables
        `;
        
        // If we have parameters, try to find transaction tables
        // Adjust this query based on your actual table structure
        let searchQuery = `
            SELECT * FROM (
                SELECT 'UPF_Transactions' as Source, t.* FROM UPF_Transactions t
                UNION ALL
                SELECT 'UPF_Records' as Source, r.* FROM UPF_Records r
                UNION ALL
                SELECT 'UPF_Log' as Source, l.* FROM UPF_Log l
            ) data
            WHERE 1=0
        `;
        
        // If parameters provided, search in common tables
        if (pan || rrn || stan) {
            searchQuery = `
                SELECT * FROM (
                    SELECT 'UPF_Transactions' as Source, t.* FROM UPF_Transactions t
                    UNION ALL
                    SELECT 'UPF_Records' as Source, r.* FROM UPF_Records r
                ) data
                WHERE 1=1
            `;
            
            const params = {};
            if (pan && pan.trim()) {
                searchQuery += ` AND (PAN = :pan OR CARD_NUMBER = :pan)`;
                params.pan = pan;
            }
            if (rrn && rrn.trim()) {
                searchQuery += ` AND (RRN = :rrn OR RETRIEVAL_REF = :rrn)`;
                params.rrn = rrn;
            }
            if (stan && stan.trim()) {
                searchQuery += ` AND (STAN = :stan OR STAN_NUMBER = :stan)`;
                params.stan = stan;
            }
            
            console.log(`UPF Query - PAN: ${pan}, RRN: ${rrn}, STAN: ${stan}`);
            
            try {
                const result = await connection.execute(searchQuery, params);
                
                // Format Oracle data
                const formattedData = result.rows.map(row => {
                    const obj = {};
                    if (result.metaData) {
                        result.metaData.forEach((col, index) => {
                            let value = row[index];
                            if (value && typeof value === 'object' && value.toISOString) {
                                value = value.toISOString();
                            }
                            obj[col.name.toLowerCase()] = value;
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
            } catch (searchErr) {
                // If tables don't exist, return sample data for testing
                console.log('UPF Tables not found, returning sample data');
                res.json({
                    success: true,
                    database: 'UPF (Oracle 1)',
                    data: [{
                        source: 'Sample Data',
                        message: 'Connected to UPF but no transaction tables found. Please update the query with correct table names.',
                        pan: pan,
                        rrn: rrn,
                        stan: stan,
                        connection_status: 'Connected - Ready for queries'
                    }],
                    count: 1,
                    connectionError: false,
                    isConnected: true
                });
            }
        } else {
            // If no parameters, just return connection status
            res.json({
                success: true,
                database: 'UPF (Oracle 1)',
                data: [{
                    message: 'UPF Database is connected and ready',
                    user: await connection.execute('SELECT USER FROM DUAL').then(r => r.rows[0][0]),
                    timestamp: new Date().toISOString()
                }],
                count: 1,
                connectionError: false,
                isConnected: true
            });
        }
        
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
            error: connectionStatus.epsError || 'EPS Database is not connected. Please check your Oracle configuration.',
            data: [],
            count: 0,
            connectionError: true,
            isConnected: false
        });
    }
    
    try {
        connection = await oracle2Pool.getConnection();
        
        // Similar query structure for EPS
        let query = `
            SELECT * FROM (
                SELECT 'EPS_Records' as Source, e.* FROM EPS_Records e
                UNION ALL
                SELECT 'EPS_Transactions' as Source, t.* FROM EPS_Transactions t
            ) data
            WHERE 1=0
        `;
        
        if (pan || rrn || stan) {
            query = `
                SELECT * FROM EPS_Records
                WHERE 1=1
            `;
            
            const params = {};
            if (pan && pan.trim()) {
                query += ` AND (PAN = :pan OR CARD_NUMBER = :pan)`;
                params.pan = pan;
            }
            if (rrn && rrn.trim()) {
                query += ` AND (RRN = :rrn OR RETRIEVAL_REF = :rrn)`;
                params.rrn = rrn;
            }
            if (stan && stan.trim()) {
                query += ` AND (STAN = :stan OR STAN_NUMBER = :stan)`;
                params.stan = stan;
            }
            
            try {
                const result = await connection.execute(query, params);
                const formattedData = result.rows.map((row, idx) => {
                    const obj = { record_number: idx + 1 };
                    if (result.metaData) {
                        result.metaData.forEach((col, index) => {
                            let value = row[index];
                            if (value && typeof value === 'object' && value.toISOString) {
                                value = value.toISOString();
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
            } catch (searchErr) {
                res.json({
                    success: true,
                    database: 'EPS PTLF (Oracle 2)',
                    data: [{
                        message: 'Connected to EPS but no transaction tables found',
                        status: 'Ready for queries',
                        pan: pan,
                        rrn: rrn,
                        stan: stan
                    }],
                    count: 1,
                    connectionError: false,
                    isConnected: true
                });
            }
        } else {
            res.json({
                success: true,
                database: 'EPS PTLF (Oracle 2)',
                data: [{
                    message: 'EPS Database is connected and ready',
                    timestamp: new Date().toISOString()
                }],
                count: 1,
                connectionError: false,
                isConnected: true
            });
        }
        
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

// Debug endpoint to list UPF tables
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
    let upfTables = [];
    
    // Check PRM
    if (mssqlPool && connectionStatus.prm) {
        try {
            await mssqlPool.request().query('SELECT 1');
            prmAlive = true;
        } catch (err) {
            prmAlive = false;
            connectionStatus.prm = false;
        }
    }
    
    // Check UPF
    if (oracle1Pool && connectionStatus.upf) {
        let conn;
        try {
            conn = await oracle1Pool.getConnection();
            await conn.execute('SELECT 1 FROM DUAL');
            upfAlive = true;
            
            // Get list of tables for debugging
            const tables = await conn.execute(`SELECT table_name FROM user_tables WHERE ROWNUM <= 10`);
            upfTables = tables.rows.map(row => row[0]);
        } catch (err) {
            upfAlive = false;
            connectionStatus.upf = false;
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
        } finally {
            if (conn) await conn.close();
        }
    }
    
    res.json({
        prm: prmAlive,
        upf: upfAlive,
        eps: epsAlive,
        upfTables: upfTables,
        timestamp: new Date().toISOString()
    });
});

// Get PRM table structure
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

// Get sample PRM data
app.get('/api/prm/sample', async (req, res) => {
    if (!mssqlPool || !connectionStatus.prm) {
        return res.json({ error: 'PRM Database not connected' });
    }
    
    try {
        const result = await mssqlPool.request().query('SELECT TOP 5 * FROM [PRMNRT].[dbo].[DETAIL]');
        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
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
        console.log(`📱 Open your browser to use the application\n`);
        console.log(`🔍 Debug Endpoints:`);
        console.log(`   - PRM Sample Data: http://localhost:${port}/api/prm/sample`);
        console.log(`   - PRM Table Structure: http://localhost:${port}/api/prm/columns`);
        console.log(`   - UPF Tables: http://localhost:${port}/api/upf/tables`);
        console.log(`   - Health Check: http://localhost:${port}/api/health\n`);
    });
}

startServer();
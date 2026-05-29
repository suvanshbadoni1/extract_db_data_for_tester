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

// Database configuration
const mssqlConfig = {
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASSWORD || '',
    server: process.env.MSSQL_SERVER || 'localhost',
    database: process.env.MSSQL_DATABASE || 'PRM_DB',
    port: parseInt(process.env.MSSQL_PORT) || 1433,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectionTimeout: 30000,
        requestTimeout: 30000
    }
};

const oracle1Config = {
    user: process.env.ORACLE1_USER || 'upf_user',
    password: process.env.ORACLE1_PASSWORD || '',
    connectString: process.env.ORACLE1_CONNECT_STRING || 'localhost:1521/UPFDB'
};

const oracle2Config = {
    user: process.env.ORACLE2_USER || 'eps_user',
    password: process.env.ORACLE2_PASSWORD || '',
    connectString: process.env.ORACLE2_CONNECT_STRING || 'localhost:1521/EPSDB'
};

// Connection pools
let mssqlPool = null;
let oracle1Pool = null;
let oracle2Pool = null;

// Initialize connections with better error handling
async function initializeDatabases() {
    console.log('\n🔌 Initializing Database Connections...\n');
    
    // Initialize MSSQL (PRM)
    try {
        mssqlPool = await sql.connect(mssqlConfig);
        console.log('✅ PRM (MSSQL) Database - Connected successfully');
    } catch (err) {
        console.log('❌ PRM (MSSQL) Database - Connection failed:', err.message);
        mssqlPool = null;
    }
    
    // Initialize Oracle 1 (UPF)
    try {
        oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_PATH || '' });
        oracle1Pool = await oracledb.createPool({
            ...oracle1Config,
            poolMin: 1,
            poolMax: 5,
            poolIncrement: 1
        });
        console.log('✅ UPF (Oracle 1) Database - Connected successfully');
    } catch (err) {
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
        console.log('✅ EPS PTLF (Oracle 2) Database - Connected successfully');
    } catch (err) {
        console.log('❌ EPS PTLF (Oracle 2) Database - Connection failed:', err.message);
        oracle2Pool = null;
    }
    
    console.log('\n📊 Connection Summary:');
    console.log(`   PRM (MSSQL): ${mssqlPool ? '🟢 Online' : '🔴 Offline'}`);
    console.log(`   UPF (Oracle): ${oracle1Pool ? '🟢 Online' : '🔴 Offline'}`);
    console.log(`   EPS (Oracle): ${oracle2Pool ? '🟢 Online' : '🔴 Offline'}\n`);
}

// PRM Query endpoint
app.post('/api/prm/query', async (req, res) => {
    const { pan, rrn, stan } = req.body;
    
    if (!mssqlPool) {
        return res.json({
            success: false,
            database: 'PRM (MSSQL)',
            error: 'Database connection is not available. Please check your MSSQL configuration.',
            data: [],
            count: 0,
            connectionError: true
        });
    }
    
    try {
        // Sample query - Replace with your actual table/column names
        const query = `
            SELECT 
                'Sample Data' as TransactionID,
                @pan as PAN,
                @rrn as RRN,
                @stan as STAN,
                1000.00 as Amount,
                GETDATE() as TransactionDate,
                '00' as ResponseCode,
                'Test Merchant' as MerchantName,
                'VISA' as CardType,
                'PURCHASE' as TransactionType
        `;
        
        const request = mssqlPool.request();
        request.input('pan', sql.VarChar, pan);
        request.input('rrn', sql.VarChar, rrn);
        request.input('stan', sql.VarChar, stan);
        
        const result = await request.query(query);
        
        res.json({
            success: true,
            database: 'PRM (MSSQL)',
            data: result.recordset,
            count: result.recordset.length,
            connectionError: false
        });
    } catch (err) {
        console.error('PRM Query Error:', err);
        res.json({
            success: false,
            database: 'PRM (MSSQL)',
            error: err.message,
            data: [],
            count: 0,
            connectionError: false
        });
    }
});

// UPF Query endpoint (Oracle 1)
app.post('/api/upf/query', async (req, res) => {
    const { pan, rrn, stan } = req.body;
    let connection;
    
    if (!oracle1Pool) {
        return res.json({
            success: false,
            database: 'UPF (Oracle 1)',
            error: 'Database connection is not available. Please check your Oracle UPF configuration.',
            data: [],
            count: 0,
            connectionError: true
        });
    }
    
    try {
        connection = await oracle1Pool.getConnection();
        
        // Sample query - Replace with your actual table/column names
        const query = `
            SELECT 
                'Sample Data' as TRANSACTION_ID,
                :pan as PAN,
                :rrn as RRN,
                :stan as STAN,
                1000.00 as AMOUNT,
                SYSDATE as TRANSACTION_DATE,
                '00' as RESPONSE_CODE,
                'Test Merchant' as MERCHANT_NAME,
                'VISA' as CARD_TYPE,
                'PURCHASE' as TRANSACTION_TYPE
            FROM DUAL
        `;
        
        const result = await connection.execute(query, { pan, rrn, stan });
        
        // Format Oracle data
        const formattedData = result.rows.map(row => ({
            transaction_id: row[0],
            pan: row[1],
            rrn: row[2],
            stan: row[3],
            amount: row[4],
            transaction_date: row[5],
            response_code: row[6],
            merchant_name: row[7],
            card_type: row[8],
            transaction_type: row[9]
        }));
        
        res.json({
            success: true,
            database: 'UPF (Oracle 1)',
            data: formattedData,
            count: formattedData.length,
            connectionError: false
        });
    } catch (err) {
        console.error('UPF Query Error:', err);
        res.json({
            success: false,
            database: 'UPF (Oracle 1)',
            error: err.message,
            data: [],
            count: 0,
            connectionError: false
        });
    } finally {
        if (connection) await connection.close();
    }
});

// EPS Query endpoint (Oracle 2)
app.post('/api/eps/query', async (req, res) => {
    const { pan, rrn, stan } = req.body;
    let connection;
    
    if (!oracle2Pool) {
        return res.json({
            success: false,
            database: 'EPS PTLF (Oracle 2)',
            error: 'Database connection is not available. Please check your Oracle EPS configuration.',
            data: [],
            count: 0,
            connectionError: true
        });
    }
    
    try {
        connection = await oracle2Pool.getConnection();
        
        // Sample query - Replace with your actual table/column names
        const query = `
            SELECT 
                'Sample Data' as RECORD_ID,
                :pan as PAN,
                :rrn as RRN,
                :stan as STAN,
                1000.00 as AMOUNT,
                SYSDATE as TRANSACTION_DATE,
                '00' as RESPONSE_CODE,
                'PTLC001' as PTLC_CODE,
                'Test Merchant' as MERCHANT_ID,
                'TERM001' as TERMINAL_ID,
                'CLASSIC' as CARD_PRODUCT
            FROM DUAL
        `;
        
        const result = await connection.execute(query, { pan, rrn, stan });
        
        // Format Oracle data
        const formattedData = result.rows.map(row => ({
            record_id: row[0],
            pan: row[1],
            rrn: row[2],
            stan: row[3],
            amount: row[4],
            transaction_date: row[5],
            response_code: row[6],
            ptlc_code: row[7],
            merchant_id: row[8],
            terminal_id: row[9],
            card_product: row[10]
        }));
        
        res.json({
            success: true,
            database: 'EPS PTLF (Oracle 2)',
            data: formattedData,
            count: formattedData.length,
            connectionError: false
        });
    } catch (err) {
        console.error('EPS Query Error:', err);
        res.json({
            success: false,
            database: 'EPS PTLF (Oracle 2)',
            error: err.message,
            data: [],
            count: 0,
            connectionError: false
        });
    } finally {
        if (connection) await connection.close();
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    const health = {
        prm: mssqlPool !== null,
        upf: oracle1Pool !== null,
        eps: oracle2Pool !== null,
        timestamp: new Date().toISOString()
    };
    res.json(health);
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
    });
}

startServer();
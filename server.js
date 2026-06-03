require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const oracledb = require('oracledb');
const path = require('path');
const fs = require('fs');

// Import the PTLF parser
const { parseWithTokensToMap, maskPAN } = require('./ptlf-parser');

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

// EPS Database (Oracle 2) - Contains PTLF data in SFRTFPOSREG table
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
        
    } catch (err) {
        connectionStatus.upf = false;
        connectionStatus.upfError = err.message;
        logToFile('❌ UPF (Oracle 1) Database - Connection failed: ' + err.message);
        oracle1Pool = null;
    }
    
    // Initialize EPS (Oracle 2) - Using SFRTFPOSREG table
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
        
        // Check if SFRTFPOSREG table exists
        let checkConn = await oracle2Pool.getConnection();
        try {
            const tableCheck = await checkConn.execute(`SELECT COUNT(*) FROM SFRTFPOSREG WHERE ROWNUM = 1`);
            logToFile(`   ✅ SFRTFPOSREG table is accessible`);
        } catch (tableErr) {
            logToFile(`   ⚠️ SFRTFPOSREG table check: ${tableErr.message}`);
            logToFile(`   Trying alternative table: EPS_PTLF_RECORDS`);
            try {
                const altCheck = await checkConn.execute(`SELECT COUNT(*) FROM EPS_PTLF_RECORDS WHERE ROWNUM = 1`);
                logToFile(`   ✅ EPS_PTLF_RECORDS table is accessible`);
            } catch (altErr) {
                logToFile(`   ⚠️ No known EPS table found`);
            }
        }
        await checkConn.close();
        
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

// PRM Query endpoint
app.post('/api/prm/query', async (req, res) => {
    const { pan, rrn, dateFrom, dateTo } = req.body;
    
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
        
        if (dateFrom && dateFrom.trim()) {
            query += ` AND DD_APDATE >= @dateFrom`;
            request.input('dateFrom', sql.DateTime, new Date(dateFrom));
        }
        
        if (dateTo && dateTo.trim()) {
            query += ` AND DD_APDATE <= @dateTo`;
            request.input('dateTo', sql.DateTime, new Date(dateTo));
        }
        
        query += ` ORDER BY DD_APDATE DESC`;
        
        logToFile(`PRM Query - PAN: ${pan || 'NOT PROVIDED'}, RRN: ${rrn || 'NOT PROVIDED'}`);
        
        const result = await request.query(query);
        
        logToFile(`PRM Query completed - Found ${result.recordset.length} records`);
        
        res.json({
            success: true,
            database: 'PRM (MSSQL)',
            data: result.recordset,
            count: result.recordset.length,
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
// Simple endpoint to browse UPF data
app.get('/api/upf/browse', async (req, res) => {
    let connection;
    const limit = parseInt(req.query.limit) || 20;
    
    try {
        if (!oracle1Pool || !connectionStatus.upf) {
            return res.json({ error: 'UPF Database not connected' });
        }
        
        connection = await oracle1Pool.getConnection();
        
        // Get latest records
        const result = await connection.execute(`
            SELECT STAN, MSG_TP, 
                   SUBSTR(EXT, 1, 300) as EXT_PREVIEW,
                   LAST_MODIFIED
            FROM ep_log 
            ORDER BY LAST_MODIFIED DESC 
            FETCH FIRST ${limit} ROWS ONLY
        `);
        
        const records = result.rows.map(row => ({
            stan: row[0],
            msg_tp: row[1],
            ext_preview: row[2],
            last_modified: row[3]
        }));
        
        res.json({
            success: true,
            total_showing: records.length,
            records: records
        });
        
    } catch (err) {
        res.json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// UPF Query endpoint (Oracle 1) - FIXED for your actual data structure
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
        
        // Build query - using MSG_TP and STAN which are direct columns
        let query = `SELECT * FROM ep_log WHERE 1=1`;
        const params = {};
        
        // Filter by STAN if provided (direct column - works!)
        if (stan && stan.trim()) {
            query += ` AND STAN = :stan`;
            params.stan = stan;
            logToFile(`Searching by STAN: ${stan}`);
        }
        
        // Filter by RRN - need to search in the EXT content
        if (rrn && rrn.trim()) {
            // Search for RRN in both JSON and XML formats within the EXT column
            query += ` AND (`;
            query += ` EXT LIKE '%' || :rrn1 || '%'`;  // Direct string search
            query += ` OR EXT LIKE '%' || :rrn2 || '%'`;
            query += ` OR EXT LIKE '%' || :rrn3 || '%'`;
            query += `)`;
            params.rrn1 = `"SaleRefNb":"${rrn}"`;      // JSON format
            params.rrn2 = `>${rrn}<`;                   // XML format  
            params.rrn3 = rrn;                          // Direct match
            logToFile(`Searching by RRN: ${rrn}`);
        }
        
        // Filter by PAN - search in EXT content
        if (pan && pan.trim()) {
            const cleanPan = pan.trim();
            query += ` AND (`;
            query += ` EXT LIKE '%' || :pan1 || '%'`;
            query += ` OR EXT LIKE '%' || :pan2 || '%'`;
            query += ` OR EXT LIKE '%' || :pan3 || '%'`;
            query += `)`;
            params.pan1 = `"PAN":"${cleanPan}"`;        // JSON format
            params.pan2 = `>${cleanPan}<`;              // XML format
            params.pan3 = cleanPan;                      // Direct match
            logToFile(`Searching by PAN: ${maskPAN(cleanPan)}`);
        }
        
        // Add ORDER BY and LIMIT
        query += ` ORDER BY LAST_MODIFIED DESC`;
        
        if (Object.keys(params).length === 0) {
            query += ` FETCH FIRST 50 ROWS ONLY`;
        } else {
            query += ` FETCH FIRST 200 ROWS ONLY`;
        }
        
        // Log the query
        logToFile(`\n🔍 UPF Query:`);
        logToFile(`SQL: ${query}`);
        logToFile(`Params: ${JSON.stringify(params, (key, val) => {
            if (key.includes('pan') && val) return maskPAN(val);
            return val;
        })}`);
        
        const result = await connection.execute(query, params);
        logToFile(`Found ${result.rows.length} records`);
        
        // Process results
        const formattedData = [];
        
        for (const row of result.rows) {
            const record = {};
            
            if (result.metaData) {
                for (let idx = 0; idx < result.metaData.length; idx++) {
                    const col = result.metaData[idx];
                    let value = row[idx];
                    const columnName = col.name;
                    
                    if (columnName === 'EXT') {
                        if (value) {
                            // Clean up the value - remove surrounding quotes if present
                            let cleanValue = value;
                            if (typeof cleanValue === 'string') {
                                // Remove surrounding double quotes if they exist
                                if (cleanValue.startsWith('"') && cleanValue.endsWith('"')) {
                                    cleanValue = cleanValue.slice(1, -1);
                                    // Unescape internal quotes
                                    cleanValue = cleanValue.replace(/\\"/g, '"');
                                }
                            }
                            
                            record.raw_ext = cleanValue;
                            
                            // Determine content type
                            const trimmedValue = cleanValue.trim();
                            const isJson = trimmedValue.startsWith('{');
                            const isXml = trimmedValue.startsWith('<?xml') || trimmedValue.startsWith('<');
                            record.content_format = isJson ? 'json' : (isXml ? 'xml' : 'unknown');
                            
                            // Try to parse based on format
                            try {
                                if (isJson) {
                                    // Parse as JSON
                                    const parsed = JSON.parse(cleanValue);
                                    record.parsed_content = parsed;
                                    
                                    // Extract fields based on message type
                                    if (parsed.AccptrCmpltnAdvc) {
                                        record.message_type = 'AccptrCmpltnAdvc';
                                        const data = parsed.AccptrCmpltnAdvc.CmpltnAdvc;
                                        record.extracted_rrn = data?.Cntxt?.SaleCntxt?.SaleRefNb;
                                        record.extracted_pan = data?.Envt?.Card?.PlainCardData?.PAN ? 
                                            maskPAN(data.Envt.Card.PlainCardData.PAN) : null;
                                        record.extracted_amount = data?.Cntxt?.SaleCntxt?.Amt;
                                        record.extracted_currency = data?.Cntxt?.SaleCntxt?.Ccy;
                                        record.extracted_response_code = data?.Rspn?.RspnCd;
                                    } 
                                    else if (parsed.AccptrCmpltnAdvcRspn) {
                                        record.message_type = 'AccptrCmpltnAdvcRspn';
                                        const data = parsed.AccptrCmpltnAdvcRspn.CmpltnAdvcRspn;
                                        record.extracted_rrn = data?.Cntxt?.SaleCntxt?.SaleRefNb;
                                        record.extracted_pan = data?.Envt?.Card?.PlainCardData?.PAN ?
                                            maskPAN(data.Envt.Card.PlainCardData.PAN) : null;
                                    }
                                    else if (parsed.AccptrRjctn) {
                                        record.message_type = 'AccptrRjctn';
                                        const data = parsed.AccptrRjctn.Rjctn;
                                        record.extracted_rrn = data?.Cntxt?.SaleCntxt?.SaleRefNb;
                                        record.extracted_pan = data?.Envt?.Card?.PlainCardData?.PAN ?
                                            maskPAN(data.Envt.Card.PlainCardData.PAN) : null;
                                        record.rejection_reason = data?.Tx?.FailrRsn;
                                    }
                                } 
                                else if (isXml) {
                                    record.message_type = record.msg_tp || 'XML_Content';
                                    record.xml_content = cleanValue;
                                    
                                    // Extract using regex for XML
                                    const panMatch = cleanValue.match(/<PAN>([^<]+)<\/PAN>/);
                                    if (panMatch) record.extracted_pan = maskPAN(panMatch[1]);
                                    
                                    const rrnMatch = cleanValue.match(/<SaleRefNb>([^<]+)<\/SaleRefNb>/);
                                    if (rrnMatch) record.extracted_rrn = rrnMatch[1];
                                    
                                    const amountMatch = cleanValue.match(/<TtlAmt>([^<]+)<\/TtlAmt>/);
                                    if (amountMatch) record.extracted_amount = amountMatch[1];
                                }
                            } catch (parseErr) {
                                record.parse_error = parseErr.message;
                                // Still try regex extraction as fallback
                                const panMatch = cleanValue.match(/PAN["':\s>]+([0-9]{15,19})/);
                                if (panMatch) record.extracted_pan = maskPAN(panMatch[1]);
                                
                                const rrnMatch = cleanValue.match(/(?:SaleRefNb|SaleRefNb)[":\s>]+([0-9A-Za-z]+)/);
                                if (rrnMatch) record.extracted_rrn = rrnMatch[1];
                            }
                        }
                    } else {
                        // Handle other columns
                        if (columnName === 'STAN' && value) {
                            record.stan = value;
                        } else if (columnName === 'MSG_TP') {
                            if (!record.message_type && value) record.message_type = value;
                            record.msg_tp = value;
                        } else if (columnName === 'LAST_MODIFIED' && value) {
                            record.last_modified = value;
                        } else {
                            record[columnName] = value;
                        }
                    }
                }
            }
            
            formattedData.push(record);
        }
        
        res.json({
            success: true,
            database: 'UPF (Oracle 1)',
            data: formattedData,
            count: formattedData.length,
            search_criteria: {
                stan: stan || null,
                rrn: rrn || null,
                pan: pan ? maskPAN(pan) : null
            },
            message_types_found: [...new Set(formattedData.map(r => r.message_type).filter(t => t))],
            connectionError: false,
            isConnected: true
        });
        
    } catch (err) {
        logToFile('❌ UPF Query Error: ' + err.message);
        console.error(err);
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

// EPS Query endpoint - Using PTLF Parser like the Java EpsJournalService
app.post('/api/eps/query', async (req, res) => {
    const { pan, rrn, stan, ctxKey, dateFrom, dateTo } = req.body;
    let connection;
    
    if (!oracle2Pool || !connectionStatus.eps) {
        return res.json({
            success: false,
            database: 'EPS PTLF (Oracle)',
            error: connectionStatus.epsError || 'EPS Database is not connected',
            data: [],
            count: 0,
            connectionError: true,
            isConnected: false
        });
    }
    
    try {
        connection = await oracle2Pool.getConnection();
        
        // Build query for SFRTFPOSREG table (as used in EpsJournalService)
        let query = `SELECT PAN, CTX_KEY, SAF_MSG FROM SFRTFPOSREG WHERE 1=1`;
        const params = {};
        
        if (ctxKey && ctxKey.trim()) {
            query += ` AND CTX_KEY = :ctxKey`;
            params.ctxKey = ctxKey;
        }
        
        if (pan && pan.trim()) {
            query += ` AND PAN = :pan`;
            params.pan = pan;
        }
        
        // If no specific key, try alternative table or limit results
        if (Object.keys(params).length === 0) {
            // Try alternative table or just get recent records
            try {
                const altCheck = await connection.execute(`SELECT COUNT(*) FROM SFRTFPOSREG WHERE ROWNUM = 1`);
                query = `SELECT PAN, CTX_KEY, SAF_MSG FROM SFRTFPOSREG WHERE ROWNUM <= 20`;
            } catch (err) {
                // Try alternative table name
                query = `SELECT PAN, CTX_KEY, SAF_MSG FROM EPS_PTLF_RECORDS WHERE ROWNUM <= 20`;
            }
        }
        
        logToFile(`EPS Query - CTX_KEY: ${ctxKey || 'NOT PROVIDED'}, PAN: ${pan || 'NOT PROVIDED'}`);
        
        const result = await connection.execute(query, params);
        
        // Process each record with PTLF parser - similar to Java's parseWithTokensToMap
        const formattedData = [];
        const safBeginIndex = 85; // They remove 85 characters of header before parsing
        
        for (const row of result.rows) {
            const record = {
                pan: row[0],
                ctx_key: row[1],
                saf_msg_length: row[2] ? row[2].length : 0
            };
            
            // Parse the SAF_MSG if it exists (similar to their safMessage.substring(safBeginIndex))
            if (row[2] && row[2].length > safBeginIndex) {
                const safMessage = typeof row[2] === 'string' ? row[2] : String(row[2]);
                const ptlfData = safMessage.substring(safBeginIndex); // Remove 85-character header
                
                logToFile(`Parsing PTLF data, length: ${ptlfData.length}`);
                
                // Use the same parser as the Java ptlfxParser.parseWithTokensToMap()
                const parsedData = parseWithTokensToMap(ptlfData);
                
                record.ptlf_parsed = parsedData;
                
                // Extract key fields for display
                if (parsedData.stan) record.stan = parsedData.stan;
                if (parsedData.rrn) record.rrn = parsedData.rrn;
                if (parsedData.masked_pan) record.masked_pan = parsedData.masked_pan;
                if (parsedData.pan) record.extracted_pan = parsedData.pan;
                if (parsedData.settlement_amount) record.settlement_amount = parsedData.settlement_amount;
                if (parsedData.converted_amount) record.converted_amount = parsedData.converted_amount;
                
                // Extract QP fields
                if (parsedData.QP_DE015) record.qp_amount = parsedData.QP_DE015;
                if (parsedData.QP_DE043) record.merchant_name = parsedData.QP_DE043;
                if (parsedData.QP_DE057) record.approval_code = parsedData.QP_DE057;
                if (parsedData.QP_DE122) record.terminal_id = parsedData.QP_DE122;
                
                // Extract BE fields
                if (parsedData.BE_CRNCYCDE) record.currency = parsedData.BE_CRNCYCDE;
                
                // Extract B0 fields
                if (parsedData.B0_RESPCDE) record.response_code = parsedData.B0_RESPCDE;
            } else {
                record.raw_saf_msg = row[2];
                record.parse_note = `SAF_MSG length ${row[2] ? row[2].length : 0} is less than header length ${safBeginIndex}`;
            }
            
            formattedData.push(record);
        }
        
        logToFile(`EPS Query completed - Found ${formattedData.length} records, parsed with PTLF parser`);
        
        res.json({
            success: true,
            database: 'EPS PTLF (Oracle) - SFRTFPOSREG',
            data: formattedData,
            count: formattedData.length,
            parser_note: "PTLF parser applied - removed 85-byte header before parsing (same as Java EpsJournalService)",
            saf_begin_index: 85,
            connectionError: false,
            isConnected: true
        });
        
    } catch (err) {
        logToFile('EPS Query Error: ' + err.message);
        res.json({
            success: false,
            database: 'EPS PTLF (Oracle)',
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

// Debug endpoint to show EPS table structure
app.get('/api/eps/tables', async (req, res) => {
    let connection;
    try {
        if (!oracle2Pool || !connectionStatus.eps) {
            return res.json({ error: 'EPS Database not connected' });
        }
        
        connection = await oracle2Pool.getConnection();
        
        // Check for SFRTFPOSREG table
        const result = await connection.execute(`
            SELECT table_name FROM user_tables WHERE table_name IN ('SFRTFPOSREG', 'EPS_PTLF_RECORDS')
        `);
        
        const tables = result.rows.map(row => row[0]);
        
        let tableInfo = {};
        for (const table of tables) {
            const columns = await connection.execute(`
                SELECT COLUMN_NAME, DATA_TYPE 
                FROM ALL_TAB_COLUMNS 
                WHERE TABLE_NAME = '${table}' 
                AND OWNER = USER
            `);
            tableInfo[table] = columns.rows.map(col => ({ name: col[0], type: col[1] }));
        }
        
        res.json({
            success: true,
            tables_found: tables,
            table_columns: tableInfo,
            note: "EpsJournalService uses SFRTFPOSREG table with columns: PAN, CTX_KEY, SAF_MSG"
        });
        
    } catch (err) {
        res.json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

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
        logToFile(`   - EPS Tables: http://localhost:${port}/api/eps/tables`);
        logToFile(`   - Health Check: http://localhost:${port}/api/health\n`);
        logToFile(`💡 EPS PTLF Parser:`);
        logToFile(`   - Uses same logic as Java EpsJournalService`);
        logToFile(`   - Removes ${85} bytes header before parsing (safBeginIndex)`);
        logToFile(`   - Parses tokens: B0, QP, QS, QC, BE, SN\n`);
    });
}

startServer();
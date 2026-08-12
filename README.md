# Multi-Database Search & PTLF Parser

This repository contains a Node.js application that provides an end-to-end search experience across multiple payment transaction systems.

## Business Requirement

- Change the application runtime port from `3000` to `4000`.
- This requirement was implemented in `server.js`.
- The change has been committed with message: `Business requirement: change application listen port from 3000 to 4000`.

## System Overview

The application is built as a classic frontend/backend web solution:

- Frontend:
  - Served from `public/index.html`
  - Uses HTML, CSS, Bootstrap, and JavaScript
  - Provides search inputs for PAN, RRN, STAN, and date ranges
  - Calls backend API endpoints and displays results for PRM, UPF, and EPS

- Backend:
  - Express server in `server.js`
  - Connects to three databases:
    - PRM via MSSQL
    - UPF via Oracle
    - EPS PTLF via Oracle
  - Uses `ptlf-parser.js` to decode SAF/TPOS PTLF records from EPS

## Architecture and Data Flow

```text
[Browser UI] --> HTTP POST /api/prm/query --> [Express server] --> [MSSQL PRM database]
             \--> HTTP POST /api/upf/query --> [Express server] --> [Oracle UPF database]
             \--> HTTP POST /api/eps/query --> [Express server] --> [Oracle EPS PTLF database]
```

### Frontend flow

1. User enters search criteria in the UI.
2. User clicks `Search Transactions`.
3. Browser sends request(s) to the backend API.
4. Backend returns matching records for each database.
5. Frontend renders results in cards for PRM, UPF, and EPS.
6. User can expand records, inspect parsed data, and copy results.

### Backend flow

1. `server.js` starts and initializes database pools.
2. It reads configuration from `.env` and falls back to default values.
3. Each API route validates connectivity and parameters.
4. PRM and UPF queries are executed using parameterized SQL.
5. EPS results are parsed with the PTLF parser after reading SAF messages.
6. Response data returns as JSON for UI rendering.

## Frontend Description

The UI is a lightweight browser dashboard with:

- Search form with fields for PAN, RRN, STAN, Date From, and Date To
- Status badges for connected databases
- Separate result cards for:
  - PRM (MSSQL) results
  - UPF (Oracle) results
  - EPS PTLF (Oracle) results
- Expand / collapse record details
- Copy record data to clipboard
- Loading overlay during searches

The frontend currently points to `http://localhost:4000/api`.

## Backend Description

Key backend behavior in `server.js`:

- Uses `express`, `cors`, `dotenv`, `mssql`, and `oracledb`
- Creates and maintains connection pools for each database
- Provides the following endpoints:
  - `POST /api/prm/query`
  - `GET /api/upf/browse`
  - `POST /api/upf/query`
  - `POST /api/eps/query`
  - `GET /api/health`
  - `GET /api/eps/tables`
  - `GET /api/prm/columns`
- Logs startup and query details to `logs/app.log`
- Uses `ptlf-parser.js` for EPS token parsing

## PTLF Parser

`ptlf-parser.js` parses PTLF records by:

- Removing a fixed 85-character SAF header
- Reading nested token sections
- Extracting token groups such as:
  - `B0` (transaction metadata)
  - `QP` (ISO8583-related fields)
  - `QS` (timing data)
  - `QC` (variable length fields)
  - `BE` (currency conversion fields)
  - `SN` (sub-token groups)
- Masking PAN values for display

## Deployment / Run Instructions

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the application:
   ```bash
   npm start
   ```

3. Open in browser:
   ```text
   http://localhost:4000
   ```

## Environment Variables

Create or update `.env` with database configuration values:

```env
MSSQL_USER=test_user
MSSQL_PASSWORD=test123
MSSQL_SERVER=10.230.195.68
MSSQL_DATABASE=PRMNRT
MSSQL_PORT=14889
ORACLE1_USER=upfdev4
ORACLE1_PASSWORD=upfdev4
ORACLE1_CONNECT_STRING=10.230.195.68:1521/UPFDB
ORACLE2_USER=eps_user
ORACLE2_PASSWORD=
ORACLE2_CONNECT_STRING=10.230.195.68:1521/EPSDB
```

## Important Notes

- The runtime port is now `4000` unless `PORT` is explicitly set.
- The frontend and backend architecture is separated by the API layer.
- The EPS endpoint applies PTLF parsing after reading SAF message content.

## Useful API Endpoints

- `GET /api/health` - database status
- `POST /api/prm/query` - search PRM by PAN, RRN, dateFrom, dateTo
- `POST /api/upf/query` - search UPF by PAN, RRN, STAN
- `POST /api/eps/query` - search EPS PTLF by PAN, RRN, STAN, CTX_KEY
- `GET /api/prm/columns` - PRM table schema
- `GET /api/eps/tables` - EPS table schema and metadata

## Revision History

- Port change committed and pushed to GitHub on branch `main`.
- Updated documentation to reflect frontend/backend flow and application architecture.

# SQLPad API Endpoints Reference

This document contains all API endpoints discovered from the SQLPad web application JavaScript files. SQLPad is a web-based SQL editor that allows users to write and run SQL queries against various database connections.

**Total API Endpoints Found:** 35+

**Note:** Path parameters are indicated with `:paramName` syntax (e.g., `:queryId`) or `${variable}` for template literals.

---

## Table of Contents

1. [Authentication](#authentication)
2. [Users](#users)
3. [Connections](#connections)
4. [Connection Clients](#connection-clients)
5. [Connection Access](#connection-access)
6. [Queries](#queries)
7. [Query History](#query-history)
8. [Batches (Query Execution)](#batches-query-execution)
9. [Statements](#statements)
10. [Tags](#tags)
11. [Drivers](#drivers)
12. [Service Tokens](#service-tokens)
13. [Utilities](#utilities)
14. [Frontend Routes](#frontend-routes)

---

## Authentication

Endpoints for user authentication, session management, and SSO.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/signin` | POST | Sign in with email/password |
| `/api/signout` | POST/GET | Sign out current user |
| `/api/signup` | POST | Register new user account |
| `/api/password-reset/:passwordResetId` | GET/POST | Password reset flow |
| `/auth/google` | GET | Google OAuth authentication |
| `/auth/oidc` | GET | OpenID Connect authentication |
| `/auth/saml` | GET | SAML SSO authentication |

---

## Users

Endpoints for user management.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users` | GET | List all users |
| `/api/users` | POST | Create new user |
| `/api/users/` | GET | List users (alternate) |
| `/api/users/:userId` | GET | Get specific user by ID |
| `/api/users/:userId` | PUT | Update user |
| `/api/users/:userId` | DELETE | Delete user |

### User Object Fields

```json
{
  "id": "string",
  "email": "string",
  "name": "string",
  "role": "admin | editor | viewer",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

---

## Connections

Endpoints for managing database connections.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/connections` | GET | List all database connections |
| `/api/connections` | POST | Create new connection |
| `/api/connections/:connectionId` | GET | Get specific connection |
| `/api/connections/:connectionId` | PUT | Update connection |
| `/api/connections/:connectionId` | DELETE | Delete connection |
| `/api/connections/:connectionId/schema` | GET | Get database schema |
| `/api/connections/:connectionId/schema?reload=true` | GET | Reload/refresh database schema |
| `/api/test-connection` | POST | Test connection settings |

### Connection Object Fields

```json
{
  "id": "string",
  "name": "string",
  "driver": "string",
  "host": "string",
  "port": "number",
  "database": "string",
  "username": "string",
  "password": "string (encrypted)",
  "ssl": "boolean",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

### Schema Response

The schema endpoint returns database structure including:
- Tables
- Columns with data types
- Indexes
- Foreign keys

---

## Connection Clients

Endpoints for managing active database connection clients/sessions.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/connection-clients` | GET | List active connection clients |
| `/api/connection-clients/:clientId` | GET | Get specific connection client |
| `/api/connection-clients/:clientId` | DELETE | Disconnect/terminate client |

---

## Connection Access

Endpoints for managing user access to database connections.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/connection-accesses` | GET | List connection access grants |
| `/api/connection-accesses` | POST | Grant connection access |
| `/api/connection-accesses/:accessId/expire` | PUT | Expire/revoke connection access |

### Connection Access Object Fields

```json
{
  "id": "string",
  "connectionId": "string",
  "connectionName": "string",
  "userId": "string",
  "userEmail": "string",
  "duration": "number (seconds)",
  "expiryDate": "datetime",
  "createdAt": "datetime"
}
```

---

## Queries

Endpoints for managing saved SQL queries.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/queries` | GET | List all saved queries |
| `/api/queries?` | GET | List queries with filters |
| `/api/queries` | POST | Create/save new query |
| `/api/queries/:queryId` | GET | Get specific query |
| `/api/queries/:queryId` | PUT | Update query |
| `/api/queries/:queryId` | DELETE | Delete query |

### Query Object Fields

```json
{
  "id": "string",
  "name": "string",
  "queryText": "string (SQL)",
  "connectionId": "string",
  "chart": {
    "chartType": "string",
    "fields": {}
  },
  "tags": ["string"],
  "acl": [],
  "createdBy": "string",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

---

## Query History

Endpoints for query execution history.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/query-history?filter=:filter` | GET | Get query execution history with optional filter |

### Query History Object Fields

```json
{
  "id": "string",
  "connectionId": "string",
  "connectionName": "string",
  "userId": "string",
  "userEmail": "string",
  "queryText": "string",
  "startTime": "datetime",
  "stopTime": "datetime",
  "rowCount": "number",
  "status": "started | finished | error"
}
```

---

## Batches (Query Execution)

Endpoints for executing SQL queries as batches (supporting multiple statements).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/batches` | GET | List query batches |
| `/api/batches` | POST | Execute new query batch |
| `/api/batches?queryId=:queryId&includeStatements=true` | GET | Get batches for query with statements |
| `/api/batches/:batchId` | GET | Get specific batch |
| `/api/batches/:batchId/cancel` | PUT | Cancel running batch |

### Batch Object Fields

```json
{
  "id": "string",
  "queryId": "string",
  "connectionId": "string",
  "connectionClientId": "string",
  "userId": "string",
  "status": "started | finished | error | cancelled",
  "startTime": "datetime",
  "stopTime": "datetime",
  "durationMs": "number",
  "statements": [],
  "selectedText": "string",
  "batchText": "string"
}
```

---

## Statements

Endpoints for individual SQL statements within a batch.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/statements/:statementId/results` | GET | Get results for specific statement |

### Statement Object Fields

```json
{
  "id": "string",
  "batchId": "string",
  "sequence": "number",
  "statementText": "string",
  "status": "queued | started | finished | error",
  "startTime": "datetime",
  "stopTime": "datetime",
  "durationMs": "number",
  "rowCount": "number",
  "columns": [],
  "error": "string | null"
}
```

### Results Response

```json
{
  "columns": [
    {
      "name": "string",
      "datatype": "string"
    }
  ],
  "rows": [
    {}
  ],
  "incomplete": "boolean",
  "rowCount": "number"
}
```

---

## Tags

Endpoints for managing query tags/labels.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tags` | GET | List all tags |

### Tag Object Fields

```json
{
  "tag": "string",
  "count": "number"
}
```

---

## Drivers

Endpoints for database driver information.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/drivers` | GET | List supported database drivers |

### Supported Drivers

SQLPad typically supports:
- PostgreSQL
- MySQL
- SQL Server
- SQLite
- Cassandra
- Presto
- Trino
- ClickHouse
- BigQuery
- And more via ODBC

### Driver Object Fields

```json
{
  "id": "string",
  "name": "string",
  "fields": [
    {
      "key": "string",
      "formType": "string",
      "label": "string",
      "required": "boolean"
    }
  ]
}
```

---

## Service Tokens

Endpoints for managing API service tokens (for programmatic access).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/service-tokens` | GET | List service tokens |
| `/api/service-tokens` | POST | Create new service token |
| `/api/service-tokens/:tokenId` | GET | Get specific token |
| `/api/service-tokens/:tokenId` | DELETE | Revoke/delete token |

### Service Token Object Fields

```json
{
  "id": "string",
  "name": "string",
  "role": "admin | editor",
  "maskedToken": "string",
  "expiryDate": "datetime | null",
  "createdAt": "datetime"
}
```

---

## Utilities

Utility endpoints for various operations.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/format-sql` | POST | Format SQL query |

### Format SQL Request

```json
{
  "query": "SELECT * FROM users WHERE id=1"
}
```

### Format SQL Response

```json
{
  "query": "SELECT *\nFROM users\nWHERE id = 1"
}
```

---

## Frontend Routes

These are frontend application routes (not API endpoints) for navigation:

| Route | Description |
|-------|-------------|
| `/queries/new` | Create new query page |
| `/queries/:queryId` | View/edit specific query |
| `/query-chart/:queryId` | View query results as chart |
| `/query-table/:queryId` | View query results as table |
| `/password-reset/:passwordResetId` | Password reset page |

---

## HTTP Methods Summary

Based on the codebase analysis:

| Method | Count | Usage |
|--------|-------|-------|
| GET | 10 | Retrieve resources |
| POST | 2 | Create resources |
| PUT | 2 | Update resources |
| DELETE | 2 | Delete resources |
| PATCH | 1 | Partial updates |

---

## Authentication

SQLPad supports multiple authentication methods:

1. **Local Authentication**
   - Email/password via `/api/signin`
   - User registration via `/api/signup`

2. **OAuth/SSO**
   - Google OAuth via `/auth/google`
   - OpenID Connect via `/auth/oidc`
   - SAML via `/auth/saml`

3. **Service Tokens**
   - For API/programmatic access
   - Created via `/api/service-tokens`

---

## Error Responses

All API endpoints return errors in the following format:

```json
{
  "error": "Error message description"
}
```

HTTP Status Codes:
- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

---

## Notes

1. **Query Execution Flow**:
   - Create a batch via `POST /api/batches`
   - Batch contains one or more statements
   - Poll batch status via `GET /api/batches/:batchId`
   - Retrieve results via `GET /api/statements/:statementId/results`

2. **Connection Schema Caching**:
   - Schema is cached by default
   - Use `?reload=true` to refresh schema cache

3. **Access Control**:
   - Users have roles: `admin`, `editor`, `viewer`
   - Connection access can be time-limited via expiry dates

4. **Query Sharing**:
   - Queries have ACL (Access Control List) for sharing
   - Tags help organize and discover queries

---

*Document generated from SQLPad web application JavaScript analysis*
*Total API endpoints: 35+*

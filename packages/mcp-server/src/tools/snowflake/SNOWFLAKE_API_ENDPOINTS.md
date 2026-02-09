# Snowflake Web Application API Endpoints

This document catalogs API endpoints extracted from the Snowflake web application JavaScript bundles at `app.snowflake.com`.

**Source**: Minified JavaScript files from Snowflake's web application
**Extraction Method**: Regex pattern matching using ripgrep
**Total Endpoints Found**: ~180+ unique endpoints

---

## Table of Contents

1. [Query Management (v0/v1)](#query-management)
2. [Session & Authentication](#session--authentication)
3. [Copilot / AI Assistant](#copilot--ai-assistant)
4. [Cortex AI Services](#cortex-ai-services)
5. [ML Observability](#ml-observability)
6. [Billing & Payments](#billing--payments)
7. [Support & Cases](#support--cases)
8. [Worksheets & Files](#worksheets--files)
9. [Users & Invites](#users--invites)
10. [Marketplace & Listings](#marketplace--listings)
11. [Provider Studio](#provider-studio)
12. [Data Dictionary & Discovery](#data-dictionary--discovery)
13. [Compute Resources](#compute-resources)
14. [Account Management](#account-management)
15. [Organization](#organization)
16. [Agents](#agents)
17. [Workspace & Projects](#workspace--projects)
18. [Streamlit Apps](#streamlit-apps)
19. [Promotions & Tips](#promotions--tips)
20. [Miscellaneous](#miscellaneous)

---

## Query Management

### v0 Query APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/v0/queries` | Execute or list queries |
| GET | `/v0/queries/<queryId>` | Get specific query details |
| POST | `/v0/queries/<queryId>/save-draft` | Save query as draft |
| GET | `/v0/csv-download` | Download query results as CSV |

### v1 Query APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/v1/queries` | Execute or list queries |
| GET | `/v1/queries/<queryId>` | Get specific query details |
| GET | `/v1/queries/<queryId>/charts` | Get charts for query results |
| GET | `/v1/queries/<queryId>/chunks/<chunk>` | Get paginated query result chunks |
| GET | `/v1/queries/<queryId>/download_token` | Get download token for results |
| GET | `/v1/queries/<queryId>/download` | Download query results |
| POST | `/v1/queries/<queryId>/filter` | Apply filters to query results |
| GET | `/v1/queries/<queryId>/stats` | Get query execution statistics |
| POST | `/v1/queries/<queryId>/transforms` | Apply transformations to results |
| GET | `/v1/queries/monitoring` | Monitor running queries |
| GET | `/v1/queries/request-id:<request-id>` | Get query by request ID |
| GET | `/v1/localdev/rows/<queryId>` | Get rows for local development |

---

## Session & Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/session` | Manage user session |
| POST | `/session/query` | Execute query in session context |
| GET | `/session/request/monitoring/queries` | Monitor session queries |
| POST | `/session/request/user/mfa/manage` | Manage MFA settings |
| GET | `/session/files` | Access session files (with fileUrl, role, userToken params) |
| GET | `/session/request/monitoring/dbt/history/<id>` | Get DBT history |
| GET | `/session/request/monitoring/queries/<id>` | Get specific query monitoring |
| POST | `/session/request/queries/<id>/abort-request` | Abort running query |
| GET/POST | `/v1/sessions` | Session management (v1) |
| GET | `/v1/sessions/<sessionToken>` | Get session by token |
| GET | `/login` | Login page/endpoint |
| GET | `/logout` | Logout endpoint |
| GET | `/oauth` | OAuth authentication |
| POST | `/v0/start-redirect-oauth` | Start OAuth redirect flow (with secretName, role, oAuthFlowType params) |
| GET | `/bootstrap` | Application bootstrap data |
| GET | `/v1/bootstrap/console-bootstrap-data` | Console bootstrap data |
| GET | `/token` | Token endpoint |

---

## Copilot / AI Assistant

### v0 Copilot APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v0/copilot/add-new-session` | Create new Copilot chat session |
| POST | `/v0/copilot/run-query` | Execute query via Copilot |
| POST | `/v0/copilot/send-feedback` | Submit Copilot feedback |
| GET | `/v0/copilot/sessions` | List Copilot sessions |
| GET | `/v0/copilot/settings` | Get Copilot settings |
| POST | `/v0/copilot/update-custom-instructions` | Update custom instructions |
| POST | `/v0/copilot/update-database-schema` | Update database schema context |
| POST | `/v0/copilot/update-semantic-model` | Update semantic model |

### v1 Copilot APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/copilot/eligibility` | Check Copilot eligibility |

---

## Cortex AI Services

### Cortex Analyst

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/cortex-analyst/expand` | Expand query/response |
| POST | `/v1/cortex-analyst/expand-multiple` | Expand multiple queries |
| POST | `/v1/cortex-analyst/feedback` | Submit feedback |
| GET/POST | `/v1/cortex-analyst/messages` | Get/send messages |
| POST | `/v1/cortex-analyst/streaming` | Streaming responses |
| POST | `/v1/cortex-analyst/truncate` | Truncate response |
| POST | `/v1/cortex-analyst/validate` | Validate query |
| GET | `/v1/cortex-analyst/verified-query-suggestions` | Get verified query suggestions |
| POST | `/cortex-analyst/preselect-tables-columns` | Preselect tables/columns |
| POST | `/cortex-analyst/streaming` | Streaming endpoint |
| GET | `/cortex-analyst/verified-query-suggestions` | Verified suggestions |

### Cortex Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/cortex-search/queries/databases/<databaseName>/schemas/<schemaName>/cortex-search-services/<serviceName>:query` | Execute Cortex search query |

### Cortex General

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/cortex/complete` | LLM completion endpoint |
| GET | `/v1/cortex/governor` | Cortex governor settings |
| GET | `/v1/cortex/models` | List available models |
| POST | `/v1/cortex/si/complete` | Snowflake Intelligence completion |
| POST | `/v1/cortex/workspace/complete` | Workspace-scoped completion |
| POST | `/cortex/complete` | Direct completion endpoint |
| GET | `/cortex/governor` | Governor endpoint |
| POST | `/cortex/si/complete` | SI completion |

### Cortex Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/cortex-chat/stream` | Streaming chat endpoint |

---

## ML Observability

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/ml-observability/databases/<database>/schemas/<schema>/model-monitors` | List model monitors |
| GET | `/v1/ml-observability/databases/<database>/schemas/<schema>/model-monitors/<modelMonitorName>` | Get specific model monitor |
| POST | `/v1/ml-observability/metric-queries/classification-performance` | Classification performance metrics |
| POST | `/v1/ml-observability/metric-queries/count` | Count metrics |
| POST | `/v1/ml-observability/metric-queries/drift` | Drift metrics |
| POST | `/v1/ml-observability/metric-queries/model-monitor-custom` | Custom model monitor metrics |
| POST | `/v1/ml-observability/metric-queries/model-monitor-drift` | Model monitor drift |
| POST | `/v1/ml-observability/metric-queries/model-monitor-performance` | Performance metrics |
| POST | `/v1/ml-observability/metric-queries/model-monitor-stats` | Model monitor statistics |
| POST | `/v1/ml-observability/metric-queries/regression-performance` | Regression performance metrics |
| GET | `/v1/ml-observability/model-monitor:describe` | Describe model monitor |
| GET | `/v1/ml-observability/model-monitor:list` | List model monitors |
| GET | `/v1/observability` | General observability endpoint |

---

## Billing & Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/billing/billing-notifications` | Get billing notifications |
| GET | `/v1/billing/contacts` | List billing contacts |
| GET | `/v1/billing/get-invoice-pdf` | Download invoice PDF |
| GET | `/v1/billing/get-odss-organization-status` | Get ODSS org status |
| GET | `/v1/billing/invoices` | List invoices |
| GET | `/v1/billing/list-invoices` | Alternative invoice listing |
| POST | `/v1/billing/marketplace-detach-payment-method` | Detach marketplace payment method |
| GET | `/v1/billing/marketplace-funding-instructions` | Get funding instructions |
| POST | `/v1/billing/marketplace-payment-create-payment-intent` | Create payment intent |
| POST | `/v1/billing/marketplace-payment-create-setup-intent` | Create setup intent |
| GET | `/v1/billing/marketplace-payment-gateway-id` | Get payment gateway ID |
| GET | `/v1/billing/marketplace-payment-methods` | List payment methods |
| POST | `/v1/billing/marketplace-payment-save-payment-method` | Save payment method |
| GET | `/v1/billing/provider-invoices` | Get provider invoices |
| POST | `/v1/billing/resend-verification-email` | Resend verification email |
| POST | `/v1/billing/save-billing-contact` | Save billing contact |
| POST | `/v1/billing/verify-address` | Verify billing address |

---

## Support & Cases

### v0 Support APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/v0/support/cases` | List/create support cases |
| GET | `/v0/support/cases/<caseNumber>` | Get specific case |
| GET/POST | `/v0/support/cases/<caseNumber>/attachments` | Case attachments |
| GET/DELETE | `/v0/support/cases/<caseNumber>/attachments/<attachmentId>` | Specific attachment |
| GET/POST | `/v0/support/cases/<caseNumber>/messages` | Case messages |
| GET | `/v0/support/cases/<caseNumber>/queries` | Case-related queries |
| GET/POST | `/v0/support/cases/<caseNumber>/watchers` | Case watchers |
| GET | `/v0/support/categories` | Support categories |
| GET | `/v0/support/incidents` | Current incidents |
| GET | `/v0/support/potential-watchers` | Potential watchers |

### v1 Support APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/v1/support/cases` | List/create support cases |
| POST | `/v1/support/cases/<caseNumber>/reopen` | Reopen closed case |
| GET | `/v1/support/functional-areas` | List functional areas |
| POST | `/v1/support/suggestions/<suggestionId>/visit` | Track suggestion visit |
| POST | `/v1/support/suggestions/retrieve-area` | Retrieve area suggestions |
| POST | `/v1/support/suggestions/retrieve` | Retrieve suggestions |
| POST | `/v1/support/suggestions/upload-interactions` | Upload interactions |

---

## Worksheets & Files

### Worksheets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v0/worksheets/list` | List worksheets |
| GET | `/worksheets` | Worksheets page |
| GET | `/worksheets/folders` | Worksheet folders |
| GET | `/worksheets/legacy/v0/queries` | Legacy query interface |
| POST | `/v1/worksheetsExport` | Export worksheets |

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v0/files/download` | Download file |
| POST | `/v0/files/upload` | Upload file |
| GET | `/v1/files/download-token` | Get file download token |
| GET | `/v1/files/download` | Download file (v1) |
| GET | `/v1/files/list` | List files |
| POST | `/v1/files/upload` | Upload file (v1) |

### Folders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/v0/folders` | List/create folders |
| GET | `/v0/folders/<id>` | Get specific folder |

---

## Users & Invites

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/v1/user-invites` | List/send user invites |
| GET/DELETE | `/v1/user-invites/<inviteUserId>` | Get/delete specific invite |
| GET/PATCH | `/v1/users/<userId>` | Get/update user |
| GET | `/v1/users/avatar/` | List user avatars |
| GET | `/v1/users/avatar/<avatarId>` | Get avatar |
| GET | `/v1/users/avatar/<avatarId>/<avatarSize>` | Get sized avatar |
| POST | `/v1/users/avatar/avatarPreview` | Preview avatar |
| GET | `/users` | Users page |

---

## Marketplace & Listings

### Consumer Listings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/consumer-listings/<listingGlobalName>/images/<index>` | Get listing image |
| GET | `/v1/consumer-listings/<listingGlobalName>/images/<index>/variants/<variant>` | Get image variant |
| GET | `/v1/consumer-listings/<listingGlobalName>/notebooks` | Get listing notebooks |
| GET | `/v1/consumer-listings/<listingGlobalName>/notebooks/results` | Get notebook results |

### Marketplace Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/marketplace` | Marketplace home |
| GET | `/marketplace-billing` | Marketplace billing |
| GET | `/marketplace/sign-up` | Marketplace signup |
| GET | `/marketplace/standard-agreement/` | Standard agreement |
| GET | `/marketplace/requests/` | Marketplace requests |
| GET | `/marketplace/listing/<listingId>` | View listing |
| GET | `/marketplace/listing/<listingId>/<providerNameAndListingTitle>` | View listing (SEO URL) |
| GET | `/marketplace/listing/<listingId>/offer/<offerName>` | View offer |
| GET | `/marketplace/listing/<listingId>/offer/<offerName>/checkout` | Checkout offer |
| GET | `/marketplace/listings/<providerName>` | Provider's listings |
| GET | `/marketplace/providers/<profileGlobalName>/<providerName>` | Provider profile |
| GET | `/marketplace/internal` | Internal marketplace |
| GET | `/marketplace/<tab:enum<listings\|providers\|data-products>>/` | Marketplace tabs |

---

## Provider Studio

### Provider Listings

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/provider-listings/media` | Upload listing media |
| GET | `/v1/provider-listings/monetizationObjects` | Get monetization objects |
| POST | `/v1/provider-listings/monetizationObjectsMigration` | Migrate monetization objects |
| GET/POST | `/v1/provider-listings/notebooks` | Manage listing notebooks |
| GET/POST | `/v1/provider-listings/offer` | Manage listing offers |
| GET/POST | `/v1/provider-listings/pricingPlan` | Manage pricing plans |

### Provider Studio Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/provider-studio` | Provider Studio home |
| GET | `/provider-studio/listing-template/internal` | Internal listing template |
| GET | `/provider` | Provider dashboard |
| GET | `/provider/profile/internal/<orgProfileId>` | Internal provider profile |
| GET | `/providers` | Providers list |
| GET | `/providers/<orgProviderName>` | Provider page |

---

## Data Dictionary & Discovery

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v0/dx/datadictionary/featured-objects` | Get featured objects |
| GET | `/v0/dx/datadictionary/object-details` | Get object details |
| GET | `/v0/dx/datadictionary/published-preview` | Get published preview |
| GET | `/v0/dx/datadictionary/shared-object-list` | List shared objects |
| GET | `/v0/snowscope/browse` | Browse data catalog |
| GET | `/v0/snowscope/search` | Search data catalog |

### Data Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/data` | Data section home |
| GET | `/data/databases/` | List databases |
| GET | `/data/databases/<database>` | Database details |
| GET | `/data/databases/<database>/<tab>` | Database tab |
| GET | `/data/databases/<database>/schemas/<schema>` | Schema details |
| GET | `/data/discover/` | Data discovery |
| GET | `/data/governance` | Data governance |
| GET | `/data/integrations` | Data integrations |
| GET | `/data/integrations/<name>` | Integration details |
| GET | `/data/marketplace/` | Marketplace in data section |
| GET | `/data/manage/<exchangeId>/...` | Manage data exchanges |
| GET | `/data-metric-reference/<uuid>` | Data metric reference |

---

## Compute Resources

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/compute` | Compute section |
| GET | `/compute/compute-pools` | List compute pools |
| GET | `/compute/compute-pools/<entityName>` | Compute pool details |
| GET | `/compute/history/queries/<queryId>` | Query history |
| GET | `/compute/history/queries/<queryId>/dag` | Query DAG |
| GET | `/compute/history/queries/<queryId>/detail` | Query detail |
| GET | `/compute/history/queries/<queryId>/profile` | Query profile |
| GET | `/compute/history/queries/<queryId>/telemetry` | Query telemetry |
| GET | `/compute/job/<database>/<schema>/<entityName>` | Job details |
| GET | `/compute/job/<database>/<schema>/<entityName>/<tab>` | Job tab |
| GET | `/compute/job/<database>/<schema>/<entityName>/<tab>/historical` | Historical job data |
| GET | `/compute/query-history/<queryId>` | Query history (alt) |
| GET | `/compute/query-history/<queryId>/detail` | Query history detail |
| GET | `/compute/query-history/<queryId>/profile` | Query history profile |
| GET | `/compute/resource-monitors` | List resource monitors |
| GET | `/compute/resource-monitors/<entityName>` | Resource monitor details |
| GET | `/compute/service/<database>/<schema>/<entityName>` | Service details |
| GET | `/compute/services-and-jobs/` | Services and jobs list |
| GET | `/compute/warehouses` | List warehouses |
| GET | `/compute/warehouses/<entityName>` | Warehouse details |

---

## Account Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/account` | Account home |
| GET | `/account/billing` | Account billing |
| GET | `/account/invites` | Account invites |
| GET | `/account/replication` | Replication settings |
| GET | `/account/replication?source=banner` | Replication (from banner) |
| GET | `/account/replication/client-redirects` | Client redirects |
| GET | `/account/replication/group/<primaryGroupKey>` | Replication group |
| GET | `/account/replication/groups` | All replication groups |
| GET | `/account/role/<role>` | Role details |
| GET | `/account/roles` | List roles |
| GET | `/account/security` | Security settings |
| GET | `/account/security/network-policies` | Network policies |
| GET | `/account/security/network-rules` | Network rules |
| GET | `/account/security/sessions` | Active sessions |
| GET | `/account/settings` | Account settings |
| GET | `/account/usage/` | Account usage |
| GET | `/account/usage/budget/<database>/<schema>/<budget>` | Budget usage |
| GET | `/account/users` | Account users |
| GET | `/account/users/<userName>` | User details |
| GET | `/accounts` | List accounts (multi-account) |
| GET | `/v1/account-url/openflow` | Account URL for OpenFlow |

---

## Organization

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/organization` | Organization home |
| GET | `/organization/accounts` | Organization accounts |
| GET | `/organization/snowflake-data-marketplace-billing` | Marketplace billing |
| GET | `/organization/terms-and-billing` | Terms and billing |
| GET | `/organization/terms` | Terms |
| GET | `/v0/organizations/<id>/entities/list` | List org entities |
| GET | `/v0/organizations/<id>/entities/views` | Org entity views |

---

## Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agents` | Agents list |
| GET | `/agents/database/<database>/schema/<schema>/agent/<agentName>/configure` | Configure agent |
| GET | `/agents/database/<database>/schema/<schema>/agent/<agentName>/details` | Agent details |
| GET | `/agents/database/<database>/schema/<schema>/agent/<agentName>/evaluations/<runName>/records` | Evaluation records |
| GET | `/agents/oauth-callback` | Agent OAuth callback |

---

## Workspace & Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/workspace/entities/execution-context` | Create execution context |
| PUT | `/v1/workspace/entities/execution-context/move` | Move execution context |
| POST | `/v1/workspaces/imports` | Import workspace |
| GET | `/projects` | Projects list |

---

## Streamlit Apps

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/streamlit-apps` | Streamlit apps list |
| GET | `/streamlit-apps/` | Streamlit apps (alt) |
| POST | `/v1/streamlit/<streamlitUrlId>/_stcore/upload_file/<snowflakeSessionId>/<streamlitOssSessionUuid>/<fileId>` | Upload file to Streamlit app |

---

## Promotions & Tips

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/promotions/` | Get promotions |
| POST | `/v1/promotions/events` | Track promotion events |
| GET | `/v1/tips/<channel>` | Get tips for channel |
| POST | `/v1/tips/events` | Track tip events |

---

## Events & Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v0/a/events` | Track analytics events |
| POST | `/v0/guest/a/events` | Track guest analytics events |
| GET | `/events` | Events page |

---

## Miscellaneous

### API Status & Debug

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | API status |
| GET | `/api/dependency-graph` | Dependency graph |
| GET | `/v1/echo` | Echo/health check |
| GET | `/v1/guest/example-guest-api` | Guest API example |
| GET | `/debug` | Debug page |
| GET | `/debug-tooling` | Debug tooling |

### Navigation & Pages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/home` | Home page |
| GET | `/homepage` | Homepage (alt) |
| GET | `/activity` | Activity feed |
| GET | `/admin` | Admin panel |
| GET | `/ai` | AI features |
| GET | `/ml` | ML features |
| GET | `/alerts-center` | Alerts center |
| GET | `/catalog` | Data catalog |
| GET | `/container` | Container services |
| GET | `/dashboards` | Dashboards |
| GET | `/features` | Feature flags |
| GET | `/function` | Functions |
| GET | `/functions` | Functions list |
| GET | `/git` | Git integration |
| GET | `/github` | GitHub integration |
| GET | `/governance` | Governance (alt) |
| GET | `/help` | Help page |
| GET | `/history` | History |
| GET | `/import` | Import data |
| GET | `/export` | Export data |
| GET | `/intelligence` | Snowflake Intelligence |
| GET | `/lineage` | Data lineage |
| GET | `/model` | Model page |
| GET | `/models` | Models list |
| GET | `/models/drafts` | Model drafts |
| GET | `/models/queries/uuid` | Model queries |
| GET | `/notebooks` | Notebooks |
| GET | `/object` | Object details |
| GET | `/profile` | User profile |
| GET | `/runtime` | Runtime settings |
| GET | `/sample` | Sample data |
| GET | `/search` | Search |
| GET | `/security` | Security page |
| GET | `/service` | Services |
| GET | `/services` | Services list |
| GET | `/settings` | Settings |
| GET | `/settings/general` | General settings |
| GET | `/stats` | Statistics |
| GET | `/stream` | Streams |
| GET | `/tags` | Tags |
| GET | `/task` | Tasks |
| GET | `/tasks` | Tasks list |
| GET | `/test` | Test page |
| GET | `/tests` | Tests |

### Database Reference URLs

The application references Snowflake documentation at `docs.snowflake.com` for:
- SQL reference (functions, constructs, data types)
- Feature documentation
- Tutorials and guides

---

## API Patterns Summary

### Version Prefixes

- **`/v0/`**: Legacy or internal APIs (copilot, dx, support, worksheets, queries)
- **`/v1/`**: Current stable APIs (billing, cortex, files, queries, users, support)

### Common URL Parameters

- `role`: User role context
- `ut` / `userToken`: User authentication token
- `desc`: Description parameter for queries
- `fileUrl`: File location reference
- `sessionToken`: Session identifier

### Response Formats

- Standard JSON responses
- Streaming responses for Cortex AI endpoints
- CSV downloads for query results
- PDF downloads for invoices

### HTTP Methods Distribution (from code analysis)

- **POST**: 273 occurrences (primary for mutations, queries)
- **GET**: 160 occurrences (data retrieval)
- **DELETE**: 59 occurrences (resource deletion)
- **PUT**: 30 occurrences (full updates)
- **PATCH**: 19 occurrences (partial updates)

---

## Notes

1. **Path Parameters**: Parameters in URLs are indicated with `<paramName>` notation
2. **Route Parameters**: Some routes use `:paramName` notation (Express-style)
3. **Dynamic Segments**: Template literals with `${variable}` indicate dynamic path segments
4. **Enumerated Values**: Some routes specify allowed values with `enum<value1|value2>`
5. **Optional Segments**: Routes with `{exists}` indicate optional URL segments

---

*Document generated: 2026-02-06*
*Source: app.snowflake.com JavaScript bundles*

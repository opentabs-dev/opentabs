# LogRocket Web Application API Endpoints

This document catalogs API endpoints extracted from the LogRocket web application JavaScript bundles at `app.logrocket.com`.

**Source**: Minified JavaScript files from LogRocket's web application
**Extraction Method**: Regex pattern matching using ripgrep
**Total Endpoints Found**: ~150+ unique endpoints

---

## Table of Contents

1. [Organization Management](#organization-management)
2. [Application Management](#application-management)
3. [AI/Galileo APIs](#aigalileo-apis)
4. [Issue Tracking & Analysis](#issue-tracking--analysis)
5. [Charts & Dashboards](#charts--dashboards)
6. [Integrations](#integrations)
7. [Support Conversations](#support-conversations)
8. [Feedback & Surveys](#feedback--surveys)
9. [User & Team Management](#user--team-management)
10. [Billing & Subscription](#billing--subscription)
11. [Data Export](#data-export)
12. [Session Management](#session-management)
13. [NRF (Network Request Fingerprint)](#nrf-network-request-fingerprint)
14. [Segments & Definitions](#segments--definitions)
15. [Release Recaps](#release-recaps)
16. [SDK & Goals](#sdk--goals)
17. [Authentication & OAuth](#authentication--oauth)
18. [Application Routes](#application-routes)
19. [External Services](#external-services)

---

## Organization Management

### Core Organization APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs` | List all organizations |
| GET | `/orgs/` | List organizations (alt) |
| GET | `/orgs/<orgSlug>/` | Get organization details |
| POST | `/orgs/<orgSlug>/activate_feature_trial/` | Activate feature trial |
| POST | `/orgs/<orgSlug>/add_replay_partner_app_id/` | Add replay partner app ID |
| GET | `/orgs/<orgSlug>/addons/` | List organization addons |
| POST | `/orgs/<orgSlug>/coupon/` | Apply coupon code |
| POST | `/orgs/<orgSlug>/extend_trial/` | Extend trial period |
| POST | `/orgs/<orgSlug>/extended_viewed_session_retention/` | Extend session retention |
| POST | `/orgs/<orgSlug>/gcp_marketplace_purchase/` | GCP marketplace purchase |
| POST | `/orgs/<orgSlug>/github_marketplace_purchase/` | GitHub marketplace purchase |
| POST | `/orgs/<orgSlug>/initialize_sandbox/` | Initialize sandbox environment |

### Organization Audit

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs/<orgSlug>/audit/` | Get audit summary |
| GET | `/orgs/<orgSlug>/audit/logs/?offset=<offset>&limit=<limit>` | Get paginated audit logs |

### Organization Plans & Billing

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs/<orgSlug>/logrocket_plans/` | Get available plans |
| GET | `/orgs/<orgSlug>/invoices/` | List invoices |
| GET/POST | `/orgs/<orgSlug>/subscription/` | Manage subscription |
| GET | `/orgs/<orgSlug>/subscription/<sessionType>` | Get subscription by type |
| POST | `/orgs/<orgSlug>/setup_intent` | Create Stripe setup intent |
| POST | `/orgs/<orgSlug>/update_card/` | Update payment card |
| GET | `/orgs/<orgSlug>/session_usage_histogram/?start=<start>&sdkType=<sdkType>` | Session usage histogram |
| GET | `/orgs/<orgSlug>/sessions_used_in_range_by_type` | Sessions used by type |

---

## Application Management

### Core Application APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs/<orgSlug>/apps/` | List applications |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/` | Get application details |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/generate_api_key/` | Generate API key |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/request-access/` | Request access to app |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/link_integrations/` | Link integrations |

---

## AI/Galileo APIs

### Galileo Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/ask-galileo-chats/` | Manage Galileo chats |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/ask-galileo-chats/?chat_type=issue_analysis&is_video_available=true` | Get issue analysis chats |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/ask-galileo-chats/?chat_type=stream` | Get stream chats |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/ask-galileo-chats/<chatID>/` | Get specific chat |

### Galileo Streams

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/ask-galileo-streams/` | Manage Galileo streams |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/ask-galileo-streams/<id>/` | Get specific stream |

### Galileo Feedback

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/ask-galileo-chat-feedbacks/` | Submit chat feedback |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/ask-galileo-chat-feedbacks/?chat_id=<chatId>` | Get feedback by chat |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/ask-galileo-chat-feedbacks/<feedbackId>/` | Manage specific feedback |

---

## Issue Tracking & Analysis

### Issues

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/issue-groups/` | List/create issue groups |
| GET/PATCH | `/orgs/<orgSlug>/apps/<appSlug>/issue-groups/<groupID>/` | Manage issue group |
| GET/PATCH | `/orgs/<orgSlug>/apps/<appSlug>/issue-groups/<issueGroupID>/` | Manage issue group (alt) |

### Issue Analysis (AI-powered)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs/<orgSlug>/apps/<appSlug>/issue-analyses/<id>/` | Get issue analysis |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/issue-analyses/<issueAnalysisID>/` | Get issue analysis (alt) |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/issue-analyses/retrieve-by-issue-id/` | Retrieve by issue ID |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/issue-analyses/retrieve-by-issue-ids/` | Retrieve by multiple issue IDs |

### Issue Filters

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/issue-filters/` | Manage issue filters |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/issue-filters/<id>/` | Manage specific filter |

### Issue Alerting

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/issues-alerting-configs/` | Manage alert configs |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/issues-alerting-configs/<alertID>/` | Manage specific alert |

---

## Charts & Dashboards

### Charts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/charts/` | List/create charts |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/charts/?<chartQuery>` | Query charts |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/charts/<chartID>/` | Manage chart |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/charts/<chartID>/alerts/` | Manage chart alerts |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/charts/<chartID>/alerts/<alertID>/` | Manage specific alert |

### Chart Notes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/notes/` | Manage notes |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/notes/?chart_id=<chartID>` | Get notes by chart |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/notes/<id>/` | Manage specific note |

### Dashboards

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/dashboards/` | Manage dashboards |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/dashboards/<dashboardID>/` | Manage specific dashboard |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/dashboards/list_with_owner` | List dashboards with owner info |

---

## Integrations

### Core Integration APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs/<orgSlug>/apps/<appSlug>/integrations/` | List integrations |

### Jira Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/jira/` | Manage Jira integration |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/jira-oauth/` | Jira OAuth |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/integrations/<jiraType>/` | Get Jira type |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/integrations/<jiraType>/?project=<project>` | Get by project |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/integrations/<jiraType>/?project=<project>&issue_type=<issueType>` | Get by project & type |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/<jiraType>/issue/` | Create Jira issue |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/jira-issues/<endpoint>/` | Jira issues API |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/jira-issues/handle/?jiraIdentifier=<jiraIdentifier>` | Handle Jira issue |

### GitHub Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/github/` | Manage GitHub integration |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/github/issue/` | Create GitHub issue |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/integrations/github/repositories/` | List GitHub repositories |

### Linear Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/linear/` | Manage Linear integration |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/linear/issue/` | Create Linear issue |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/linear-issues/<endpoint>/` | Linear issues API |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/linear-issues/handle/?linearIdentifier=<linearIdentifier>` | Handle Linear issue |

### Azure DevOps Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/azure-dev-ops/` | Manage Azure DevOps |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/azure-dev-ops/issue/` | Create work item |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/integrations/azure-dev-ops/work-item-types/?project_id=<projectID>` | Get work item types |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/azure-devops-issues/<endpoint>/` | Azure DevOps issues API |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/azure-devops-issues/handle/?workItemID=<azureDevOpsIdentifier>` | Handle work item |

### Trello Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/trello/` | Manage Trello integration |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/trello/issue/` | Create Trello card |

### Observability Integrations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/datadog/` | Datadog integration |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/integrations/datadog/logs/` | Get Datadog logs |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/newrelic/` | New Relic integration |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/appdynamics/` | AppDynamics integration |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/dynatrace/` | Dynatrace integration |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/splunk/` | Splunk integration |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/kibana/` | Kibana integration |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/gcp/` | GCP integration |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/integrations/gcp/logs/` | Get GCP logs |

### Customer Support Integrations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/intercom/` | Intercom integration |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/zendesk/` | Zendesk integration |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/pagerduty/` | PagerDuty integration |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/integrations/pagerduty/<serviceID>/` | PagerDuty service |

### Other Integrations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/pendo/` | Pendo integration |
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/customlink/` | Custom link integration |

### Issue Link Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/orgs/<orgSlug>/apps/<appSlug>/integration-issues/link/` | Link issue to integration |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/integration-issues/unlink/` | Unlink issue from integration |

### Issues Digest

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/integrations/issues-digest/` | Manage issues digest |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/integrations/issues-digest/<digestID>/` | Manage specific digest |

---

## Support Conversations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs/<orgSlug>/apps/<appSlug>/support-conversation-groups/?page=<page>&pageSize=<pageSize>&ordering=<ordering>` | List conversation groups |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/support-conversation-classifications/?group_id=<groupID>&page=<page>&pageSize=<pageSize>` | Get classifications |

---

## Feedback & Surveys

### Feedback Surveys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/feedback-surveys/` | Manage feedback surveys |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/feedback-surveys/?responseType=<responseType>` | Filter by response type |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/feedback-surveys/<id>/` | Manage specific survey |

### Feedback Analysis (AI-powered)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs/<orgSlug>/apps/<appSlug>/feedback-analyses/<id>/` | Get feedback analysis |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/feedback-analyses/retrieve-by-cluster-id/` | Retrieve by cluster ID |

---

## User & Team Management

### Organization Members

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs/<orgSlug>/members/?limit=<limit>&offset=<offset>&userSearch=<userSearch>` | List members |
| POST | `/orgs/<orgSlug>/update_default_role/` | Update default role |

### Roles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/roles/` | Manage roles |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/roles/<id>/` | Manage specific role |

### Invitations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/invites/` | Manage invitations |
| GET | `/invites/<slug>/` | Get invitation by slug |
| GET | `/invite/` | Invitation page |
| GET | `/invites/` | Invitations list |

### User APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users/` | Get user info |
| GET/PATCH | `/memberships/<id>/` | Manage membership |

---

## Billing & Subscription

See [Organization Plans & Billing](#organization-plans--billing) section above.

---

## Data Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/orgs/<orgSlug>/apps/<appSlug>/data_export_create_auth_token/` | Create export auth token |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/data_export_destinations/` | List export destinations |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/data_export_get_or_create_recipient/` | Get/create recipient |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/data_export_magic_links/` | Get magic links |
| POST | `/orgs/<orgSlug>/apps/<appSlug>/data_export_update_auth_token/` | Update auth token |

---

## Session Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/sessions` | List sessions |
| GET | `/sessions?segmentID=<segmentID>` | List sessions by segment |
| GET | `/sessions?u=<userID>` | List sessions by user |
| GET | `/session/` | Current session |

---

## NRF (Network Request Fingerprint)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orgs/<orgSlug>/apps/<appSlug>/nrf-summaries/<hash>/` | Get NRF summary by hash |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/nrf-summaries/<queryString>` | Query NRF summaries |

---

## Segments & Definitions

### Segments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/segments/` | Manage segments |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/segments/<id>/` | Manage specific segment |

### Definitions (Custom Events/Metrics)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/definitions/` | Manage definitions |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/definitions/?nrf_hash=<nrfHash>` | Filter by NRF hash |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/definitions/?pageSize=<pageSize>&page=<page>&name=<name>` | Paginated search |
| GET/PATCH/DELETE | `/orgs/<orgSlug>/apps/<appSlug>/definitions/<id>/` | Manage definition |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/definitions/<id>/?filter_intent=<filter_intent>` | Filter by intent |
| GET | `/orgs/<orgSlug>/apps/<appSlug>/definitions/default-error-states/` | Get default error states |

---

## Release Recaps

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/orgs/<orgSlug>/apps/<appSlug>/release-recaps/` | Manage release recaps |
| GET/PATCH | `/orgs/<orgSlug>/apps/<appSlug>/release-recaps/<id>/` | Manage specific recap |

---

## SDK & Goals

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/sdk/eval/` | Evaluate SDK configuration |
| GET | `/sdk/goals/` | Get SDK goals |

---

## Authentication & OAuth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/` | Authentication endpoint |
| GET | `/oauth/intercom/` | Intercom OAuth |
| GET | `/oauth/zendesk/` | Zendesk OAuth |
| GET | `/slack-oauth-callback?a=<appId>` | Slack OAuth callback |
| GET | `/v2/logout?returnTo=<url>` | Auth0 logout |

---

## Application Routes

### Main Navigation

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/sessions` | Sessions list |
| GET | `/issues` | Issues list |
| GET | `/issues/` | Issues (alt) |
| GET | `/issues-v3` | Issues v3 interface |
| GET | `/issues/digest` | Issues digest |
| GET | `/issues/needs-triage` | Needs triage view |
| GET | `/issue/<issueID>` | Issue detail |
| GET | `/errors` | Errors page |
| GET | `/metrics` | Metrics overview |
| GET | `/metrics/` | Metrics (alt) |
| GET | `/metrics/ask-galileo` | Galileo metrics |
| GET | `/metrics/logrocket-opportunities` | Opportunities metrics |
| GET | `/metric/<chartID>` | View specific metric |
| GET | `/metric/create` | Create metric |
| GET | `/charts` | Charts page |
| GET | `/dashboards` | Dashboards page |
| GET | `/feedback` | Feedback page |
| GET | `/feedback?cid=<clusterId>` | Feedback with cluster |
| GET | `/surveys` | Surveys page |
| GET | `/definitions` | Definitions page |
| GET | `/definitions?dSearch=<search>` | Search definitions |
| GET | `/release-recaps` | Release recaps |
| GET | `/nrf-management` | NRF management |
| GET | `/nrf-management/<hash>` | Specific NRF |
| GET | `/query-explorer` | Query explorer |

### Session Replay Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/s/<recordingID>/<sessionID>/<tabID>?` | Session replay |
| GET | `/share/<recordingID>/<sessionID>/<tabID>?` | Shared session |
| GET | `/embedded/<recordingID>/<sessionID>/<tabID>?` | Embedded session |

### AI/Galileo Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/galileo-issue-modal` | Galileo issue modal |
| GET | `/galileo-metric-link` | Galileo metric link |
| GET | `/video/<chatId>` | AI video analysis |

### Settings Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/settings` | Settings home |
| GET | `/settings/general` | General settings |
| GET | `/settings/organization` | Organization settings |
| GET | `/settings/team` | Team settings |
| GET | `/settings/roles` | Roles settings |
| GET | `/settings/privacy` | Privacy settings |
| GET | `/settings/gdpr` | GDPR settings |
| GET | `/settings/recording` | Recording settings |
| GET | `/settings/conditional-recording` | Conditional recording |
| GET | `/settings/integrations` | Integrations settings |
| GET | `/settings/integrations?editor=<type>` | Integration editor (azureDevOps, github, linear, trello) |
| GET | `/settings/integrations?filter=<filter>` | Filter integrations |
| GET | `/settings/integrations/?filter=feedback-analytics` | Feedback analytics integrations |
| GET | `/settings/issues` | Issues settings |
| GET | `/settings/plans` | Plans & billing |
| GET | `/settings/plans?showPlans=<type>` | Show specific plans |
| GET | `/settings/plans?showAdditionalAddons=true` | Show addons |
| GET | `/settings/invoices` | Invoices |
| GET | `/settings/invoices/<invoiceID>` | Specific invoice |
| GET | `/settings/session-usage` | Session usage |
| GET | `/settings/streaming-data-export` | Data export settings |
| GET | `/settings/setup` | Setup guide |
| GET | `/settings/setup?step=install&platform=mobile&sdk=REACT_NATIVE` | Mobile setup |
| GET | `/settings/audit` | Audit log |

### Other Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/sandbox` | Sandbox environment |
| GET | `/demo/<slug>` | Demo project |
| GET | `/mobile` | Mobile section |
| GET | `/logs?query=<query>` | Logs search |
| GET | `/create` | Create page |
| GET | `/status` | Status page |

---

## External Services

### LogRocket CDN & Services

| URL | Description |
|-----|-------------|
| `https://cdn.logrocket.com/` | CDN assets |
| `https://cdn.logrocket.io` | CDN assets (alt) |
| `https://r.logrocket.io` | Recording service |
| `https://r.logrocket.io/i` | Ingest endpoint |
| `https://r.logrocket.io/s` | Session endpoint |
| `https://prequel.logrocket.com` | Prequel data export |
| `https://prequel.logrocket.com/public/vendors/magic-links` | Magic links API |
| `https://staging.logrocket.com` | Staging environment |
| `https://status.logrocket.com` | Status page |
| `https://docs.logrocket.com` | Documentation |

### Auth0 Integration

| URL | Description |
|-----|-------------|
| `https://logrocket.auth0.com/authorize` | OAuth authorization |

### Sentry Error Tracking

| URL | Description |
|-----|-------------|
| `https://e.logrocket.com/api/3/store/` | Sentry error store |

---

## GraphQL API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/graphql` | GraphQL endpoint |

---

## API Patterns Summary

### URL Parameter Patterns

- `<orgSlug>`: Organization identifier (e.g., "brex", "demo-kdz7k")
- `<appSlug>`: Application identifier (e.g., "logrocket", "my-app")
- `<id>`: Generic resource ID
- `<chartID>`, `<dashboardID>`, `<alertID>`: Specific resource IDs
- `<recordingID>/<sessionID>/<tabID>`: Session replay identifiers

### Query Parameters

- `page`, `pageSize`, `offset`, `limit`: Pagination
- `ordering`: Sort order
- `chat_type`: Filter chat types (issue_analysis, stream)
- `filter_intent`: Filter by intent
- `responseType`: Filter response types

### HTTP Methods Distribution (from code analysis)

- **POST**: 271 occurrences (primary for mutations)
- **GET**: 121 occurrences (data retrieval)
- **DELETE**: 85 occurrences (resource deletion)
- **PATCH**: 59 occurrences (partial updates)
- **PUT**: 30 occurrences (full updates)

---

## Notes

1. **Path Parameters**: Parameters in URLs are indicated with `<paramName>` notation
2. **Template Variables**: The source uses `{args.paramName}` notation for dynamic segments
3. **GraphQL**: Primary data fetching uses GraphQL alongside REST endpoints
4. **Galileo AI**: LogRocket's AI assistant is called "Galileo" - provides issue analysis, video analysis, and chat features
5. **Integrations**: Extensive integration support for issue trackers, observability tools, and customer support platforms

---

*Document generated: 2026-02-06*
*Source: app.logrocket.com JavaScript bundles*

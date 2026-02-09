# Datadog API Endpoints Reference

This document contains all API endpoints discovered from the Datadog web application JavaScript files. These endpoints are used by the Datadog frontend to communicate with the backend during user sessions.

**Total Endpoints Found:** 765 (166 v1 + 599 v2)

**Note:** Path parameters are indicated with `<paramName>` syntax (e.g., `<dashboard_id>`)

---

## Table of Contents

1. [Account & Users](#account--users)
2. [API Keys & Authentication](#api-keys--authentication)
3. [APM (Application Performance Monitoring)](#apm-application-performance-monitoring)
4. [App Builder](#app-builder)
5. [Cases & Incidents](#cases--incidents)
6. [CI/CD (Continuous Integration)](#cicd-continuous-integration)
7. [Cloud Security & Compliance](#cloud-security--compliance)
8. [Cost Management](#cost-management)
9. [Dashboards](#dashboards)
10. [Downtime](#downtime)
11. [Event Platform](#event-platform)
12. [Integrations](#integrations)
13. [Logs](#logs)
14. [Metrics](#metrics)
15. [Monitors](#monitors)
16. [Network & Infrastructure](#network--infrastructure)
17. [Notebooks](#notebooks)
18. [On-Call & Escalation](#on-call--escalation)
19. [Product Analytics](#product-analytics)
20. [RUM (Real User Monitoring)](#rum-real-user-monitoring)
21. [Security Monitoring](#security-monitoring)
22. [Service Catalog](#service-catalog)
23. [SLOs (Service Level Objectives)](#slos-service-level-objectives)
24. [Source Code Integration](#source-code-integration)
25. [Synthetics](#synthetics)
26. [Teams & Organizations](#teams--organizations)
27. [Watchdog](#watchdog)
28. [Workflows](#workflows)
29. [Miscellaneous](#miscellaneous)

---

## Account & Users

Endpoints for user account management, authentication, and user settings.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/legacy_current_user` | Get legacy current user information |
| `/api/v1/settings/favorite` | Manage user favorites |
| `/api/v1/settings/favorite/list` | List user favorites |
| `/api/v1/trial` | Trial account management |
| `/api/v1/users?limit=20` | List users with pagination |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/activate_trial?force_tracing=true` | Activate trial with tracing |
| `/api/v2/current_user` | Get current authenticated user |
| `/api/v2/current_user/application_keys` | Manage current user's application keys |
| `/api/v2/current_user/change_password` | Change current user's password |
| `/api/v2/current_user/user_team_fave` | User's favorite teams |
| `/api/v2/current_user/user_team_fave/<id>` | Specific favorite team by ID |
| `/api/v2/current_user/user_team_fave/team/<id>` | Favorite team operations |
| `/api/v2/global_orgs` | List global organizations |
| `/api/v2/permissions` | List available permissions |
| `/api/v2/product_trial_summary` | Get product trial summary |
| `/api/v2/roles` | List and manage roles |
| `/api/v2/roles/templates` | Role templates |
| `/api/v2/scopes` | List OAuth scopes |
| `/api/v2/switch_to_user/:key` | Switch to another user |
| `/api/v2/user/sessions` | User session management |
| `/api/v2/users` | List all users |
| `/api/v2/users/<id>` | Get/update specific user |
| `/api/v2/users/<userId>/memberships` | User team memberships |
| `/api/v2/users/<userId>/orgs` | User's organizations |

---

## API Keys & Authentication

Endpoints for managing API keys, application keys, and OAuth clients.

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/api_keys` | List and manage API keys |
| `/api/v2/application_keys` | List and manage application keys |
| `/api/v2/domain_allowlist` | Domain allowlist for security |
| `/api/v2/oauth2_clients` | List OAuth2 clients |
| `/api/v2/oauth2_clients?page[size]=1000` | List OAuth2 clients with pagination |
| `/api/v2/oauth2_clients/<id>` | Specific OAuth2 client |
| `/api/v2/oauth2_clients/<id>/client_secret` | Client secret management |
| `/api/v2/oauth2_clients/<id>/client_secret/regenerate` | Regenerate client secret |
| `/api/v2/oauth2_clients/<id>/scopes` | OAuth2 client scopes |
| `/api/v2/oauth2_clients/<id>/tokens` | OAuth2 client tokens |
| `/api/v2/org_authorized_clients` | Organization authorized clients |
| `/api/v2/org_authorized_clients/<id>` | Specific authorized client |
| `/api/v2/org_configs/<org_config_name>` | Organization configuration |
| `/api/v2/org_connections` | Organization connections |
| `/api/v2/org_connections/<id>` | Specific organization connection |
| `/api/v2/restriction_policy/<id>` | Restriction policies |

---

## APM (Application Performance Monitoring)

Endpoints for APM services, traces, and metrics.

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/apm/apm_metrics/suggestions/resources` | APM resource suggestions |
| `/api/v2/apm/apm_metrics/suggestions/tag_keys` | APM tag key suggestions |
| `/api/v2/apm/apm_metrics/suggestions/tags` | APM tag suggestions |
| `/api/v2/apm/custom-metrics/traces` | Custom APM metrics from traces |
| `/api/v2/apm/custom-metrics/traces/` | Custom trace metrics (alternate) |
| `/api/v2/apm/custom-metrics/traces/<id>` | Specific custom trace metric |
| `/api/v2/apm/pipelines` | APM processing pipelines |
| `/api/v2/apm/pipelines/<pipelineId>/processors` | Processors in APM pipeline |
| `/api/v2/apm/pipelines/<pipelineId>/processors/<processorId>` | Specific APM processor |
| `/api/v2/apm/primary_tags` | APM primary tags configuration |
| `/api/v2/apm/services` | List APM services |
| `/api/v2/apm/services/stats` | APM service statistics |
| `/api/v2/cross-product-sampling-configurations/<configuration_id>` | Cross-product sampling config |
| `/api/v2/cross-product-sampling-configurations/destination/apm/trace` | APM trace sampling destination |
| `/api/v2/semantic-core/apm/span-tag-mappings/bulk` | Bulk span tag mappings |

---

## App Builder

Endpoints for Datadog App Builder low-code application platform.

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/app-builder/apps` | List App Builder applications |
| `/api/v2/app-builder/apps/<appId>/deployment` | App deployment status/actions |
| `/api/v2/app-builder/apps/<appId>/identity` | App identity management |
| `/api/v2/app-builder/apps/<appId>/protection-level` | App protection level |
| `/api/v2/app-builder/apps/<appId>/publish-request` | Request to publish app |
| `/api/v2/app-builder/apps/<appId>/publish-request/<publishRequestId>/approve` | Approve publish request |
| `/api/v2/app-builder/apps/<appId>/queries/<queryUuid>/mocked-outputs` | Mocked query outputs |
| `/api/v2/app-builder/apps/<appId>/revert` | Revert app to previous version |
| `/api/v2/app-builder/apps/<appId>/versions` | App version history |
| `/api/v2/app-builder/apps/<id>` | Get/update specific app |
| `/api/v2/app-builder/apps/<id>/favorite` | Favorite/unfavorite app |
| `/api/v2/app-builder/apps/<id>/self-service` | Self-service app settings |
| `/api/v2/app-builder/apps/<id>/tags` | App tags management |
| `/api/v2/app-builder/chat/stream` | AI chat stream for app building |
| `/api/v2/app-builder/component-templates` | List component templates |
| `/api/v2/app-builder/component-templates/<componentTemplateId>` | Specific component template |
| `/api/v2/app-builder/llm-obs/eval-metric/forward` | LLM observability eval metrics |
| `/api/v2/app-builder/llm-obs/spans/forward` | LLM observability spans |
| `/api/v2/app-builder/tags` | App Builder tags |

---

## Cases & Incidents

Endpoints for case management and incident response.

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/case` | Create new case |
| `/api/v2/cases` | List all cases |
| `/api/v2/cases/<id>` | Get/update specific case |
| `/api/v2/cases/<id>/insights` | Case insights and analytics |
| `/api/v2/cases/projects` | Case projects |
| `/api/v2/cases/projects/<id>` | Specific case project |
| `/api/v2/cases/projects/favorites` | Favorite case projects |
| `/api/v2/cases/suggestions` | Case suggestions |
| `/api/v2/incidents` | List all incidents |
| `/api/v2/incidents/<id>/relationships/integrations` | Incident integration relationships |
| `/api/v2/incidents/<incidentId>/attachments` | Incident attachments |
| `/api/v2/incidents/<incidentId>/timeline` | Incident timeline |
| `/api/v2/incidents/config/org/settings` | Organization incident settings |
| `/api/v2/incidents/config/org/settings/<settingId>` | Specific org incident setting |
| `/api/v2/incidents/config/reserved-roles` | Reserved incident roles |
| `/api/v2/incidents/config/tag_values` | Incident tag values config |
| `/api/v2/incidents/config/types` | Incident types configuration |
| `/api/v2/incidents/config/types/<id>` | Specific incident type |
| `/api/v2/incidents/config/types/org-settings` | Incident types org settings |
| `/api/v2/incidents/config/user-defined-fields` | User-defined incident fields |
| `/api/v2/incidents/config/user-defined-roles` | User-defined incident roles |
| `/api/v2/incidents/ms-teams-router` | Microsoft Teams integration router |
| `/api/v2/incidents/search` | Search incidents |
| `/api/v2/incidents/search-incidents` | Advanced incident search |

### Bits AI (Incident AI Assistant)

| Endpoint | Description |
|----------|-------------|
| `/api/v2/bits-ai/config/global` | Global Bits AI configuration |
| `/api/v2/bits-ai/config/limit/monitor` | Monitor limit config |
| `/api/v2/bits-ai/config/limit/org` | Organization limit config |
| `/api/v2/bits-ai/incidents/<incidentId>/summary-suggestion` | AI-generated incident summary |
| `/api/v2/bits-ai/integration/confluence` | Confluence integration for Bits AI |
| `/api/v2/bits-ai/integration/slack` | Slack integration for Bits AI |

---

## CI/CD (Continuous Integration)

Endpoints for CI/CD visibility, test tracking, and pipeline monitoring.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/ci/builds/environments` | CI build environments |
| `/api/v1/ci/commit` | CI commit information |
| `/api/v1/ci/settings` | CI settings configuration |
| `/api/v1/ci/tests/commits` | CI test commits |
| `/api/v1/ci/tests/commits/latest` | Latest CI test commits |
| `/api/v1/ci/tests/flaky` | Flaky tests detection |
| `/api/v1/ci/tests/services` | CI test services |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/ci/<type>/exclusion-filters` | CI exclusion filters by type |
| `/api/v2/ci/builds/pipelines` | CI build pipelines |
| `/api/v2/ci/git/pull-requests` | Git pull requests tracking |
| `/api/v2/ci/github_opt_in` | GitHub opt-in settings |
| `/api/v2/ci/github_opt_in/<optInId>` | Specific GitHub opt-in |
| `/api/v2/ci/github_opt_in_namespaces` | GitHub namespaces for opt-in |
| `/api/v2/ci/github/comments/valid/<repositoryId>` | Validate GitHub comments |
| `/api/v2/ci/my-commits` | Current user's CI commits |
| `/api/v2/ci/repository/<repositoryId>` | CI repository information |
| `/api/v2/ci/service-catalog/pipelines` | Service catalog CI pipelines |
| `/api/v2/ci/tests/<test_id>/issues` | Issues for specific test |
| `/api/v2/ci/tests/failed` | Failed CI tests |
| `/api/v2/ci/tests/flaky` | Flaky tests (v2) |
| `/api/v2/ci/tests/flaky/aggregated/<fingerprint>` | Aggregated flaky test by fingerprint |
| `/api/v2/ci/tests/issues` | All CI test issues |
| `/api/v2/ci/tests/regressions` | Test regressions |
| `/api/v2/ci/tests/skippable/reason` | Skippable test reasons |
| `/api/v2/ci/tests/test` | Individual test information |
| `/api/v2/dora/backfills` | DORA metrics backfills |
| `/api/v2/dora/settings` | DORA metrics settings |
| `/api/v2/quality-gates/rules` | Quality gate rules |
| `/api/v2/quality-gates/rules/<ruleId>` | Specific quality gate rule |

---

## Cloud Security & Compliance

Endpoints for cloud security posture management and compliance monitoring.

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/agentless_scanning/accounts/aws` | AWS agentless scanning accounts |
| `/api/v2/agentless_scanning/accounts/azure` | Azure agentless scanning accounts |
| `/api/v2/agentless_scanning/accounts/azure/<accountId>` | Specific Azure scanning account |
| `/api/v2/agentless_scanning/accounts/gcp` | GCP agentless scanning accounts |
| `/api/v2/agentless_scanning/accounts/gcp/<accountId>` | Specific GCP scanning account |
| `/api/v2/agentless_scanning/setup_feedback/accounts/aws` | AWS scanning setup feedback |
| `/api/v2/arm/sbom` | Software Bill of Materials |
| `/api/v2/ciem/reverse_blast_radius` | Cloud identity blast radius analysis |
| `/api/v2/ciem/unhandled_policy_statements` | Unhandled IAM policy statements |
| `/api/v2/cloud_security_management/custom_frameworks` | Custom security frameworks |
| `/api/v2/cloud_security_management/integrations/assign` | Assign CSM integrations |
| `/api/v2/cloud_security_management/jira_issues` | CSM Jira issues |
| `/api/v2/cloud_security_management/resource_context/related_cloud_logs` | Related cloud logs for resources |
| `/api/v2/cloud_security_management/resource_filters` | CSM resource filters |
| `/api/v2/compliance/findings/resource_based_view` | Resource-based compliance findings |
| `/api/v2/compliance/frameworks` | Compliance frameworks |
| `/api/v2/compliance/frameworks/:framework/findings/rules` | Framework findings by rules |
| `/api/v2/compliance/frameworks/<handle>/<version>/rules` | Framework version rules |
| `/api/v2/compliance/frameworks/default` | Default compliance framework |
| `/api/v2/compliance/frameworks/posture_score` | Compliance posture score |
| `/api/v2/compliance/frameworks/resource_counts` | Resource counts per framework |
| `/api/v2/compliance/resources/findings` | Compliance resource findings |
| `/api/v2/compliance_findings/rule_based_view` | Rule-based compliance findings |
| `/api/v2/compliance_findings/rules/findings` | Findings by compliance rules |
| `/api/v2/compliance_monitoring/frameworks` | Compliance monitoring frameworks |
| `/api/v2/compliance_monitoring/frameworks/posture_score` | Framework posture scores |
| `/api/v2/compliance_monitoring/frameworks/posture_score/change` | Posture score changes |
| `/api/v2/compliance_monitoring/frameworks/resources` | Framework resources |
| `/api/v2/compliance_monitoring/frameworks/rules` | Framework rules |
| `/api/v2/compliance_monitoring/frameworks/top_failing_rules` | Top failing compliance rules |
| `/api/v2/posture_management/findings` | Posture management findings |
| `/api/v2/posture_management/findings/<findingId>` | Specific posture finding |
| `/api/v2/sec_graph/blast_radius` | Security graph blast radius |
| `/api/v2/sec_graph/resource_types` | Security graph resource types |

---

## Cost Management

Endpoints for cloud cost management and budgeting.

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/cost/arbitrary_rule` | Custom cost allocation rules |
| `/api/v2/cost/arbitrary_rule/status` | Cost rule status |
| `/api/v2/cost/aws_cur_config` | AWS Cost and Usage Report config |
| `/api/v2/cost/aws_cur_config/<cloud_account_id>` | AWS CUR for specific account |
| `/api/v2/cost/azure_uc_config` | Azure Usage Config |
| `/api/v2/cost/azure_uc_config/<cloud_account_id>` | Azure config for specific account |
| `/api/v2/cost/budget/<id>` | Specific budget |
| `/api/v2/cost/budgets` | List all budgets |
| `/api/v2/cost/custom_costs` | Custom cost entries |
| `/api/v2/cost/custom_costs/<id>` | Specific custom cost |
| `/api/v2/cost/gcp_uc_config` | GCP Usage Config |
| `/api/v2/cost/gcp_uc_config/<cloud_account_id>` | GCP config for specific account |
| `/api/v2/cost/tag_description/generate` | Generate cost tag descriptions |
| `/api/v2/cost/tag_descriptions` | Cost tag descriptions |
| `/api/v2/widgets/ccm_reports` | Cloud Cost Management report widgets |
| `/api/v2/widgets/ccm_reports/<id>` | Specific CCM report widget |

---

## Dashboards

Endpoints for dashboard management, widgets, and sharing.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/dash/<timeboard_id>` | Get timeboard by ID |
| `/api/v1/dash/integration/<dashboard_id>` | Integration dashboard |
| `/api/v1/dashboard` | List/create dashboards |
| `/api/v1/dashboard/<dashboard_id>` | Get/update/delete specific dashboard |
| `/api/v1/dashboard_search` | Search dashboards |
| `/api/v1/dashboard/lists` | Dashboard lists |
| `/api/v1/dashboard/lists/manual` | Manual dashboard lists |
| `/api/v1/dashboard/lists/manual/<listId>` | Specific manual list |
| `/api/v1/dashboard/lists/manual/<listId>/dashboards` | Dashboards in manual list |
| `/api/v1/dashboard/recommendations_load_event/<dashType>/<dashId>` | Dashboard recommendations |
| `/api/v1/screen/integration/<dashboard_id>` | Integration screenboard |
| `/api/v1/widget/share` | Share widget |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/dashboard/lists/manual/<dashboard_list_id>/dashboards` | Dashboards in manual list (v2) |
| `/api/v2/dashboard/template-variables/tags` | Dashboard template variable tags |
| `/api/v2/dashboards/search` | Search dashboards (v2) |
| `/api/v2/embed_query/scalar` | Embedded scalar query |
| `/api/v2/embed_query/timeseries` | Embedded timeseries query |
| `/api/v2/reporting/preview` | Dashboard report preview |
| `/api/v2/reporting/schedule` | Schedule dashboard reports |
| `/api/v2/reporting/schedule/<resource_type>/<resource_id>` | Scheduled report by resource |
| `/api/v2/reporting/schedule/<uuid>` | Specific scheduled report |
| `/api/v2/reporting/schedule/<uuid>/toggle` | Toggle scheduled report |
| `/api/v2/reporting/schedule/dashboard/<resource_id>` | Dashboard-specific schedule |
| `/api/v2/reporting/schedule/integration_dashboard/<resource_id>` | Integration dashboard schedule |
| `/api/v2/reporting/schedule/list` | List scheduled reports |
| `/api/v2/reporting/schedule/uniboard` | Uniboard schedule |

---

## Downtime

Endpoints for scheduling and managing monitor downtimes.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/downtime` | List/create downtimes |
| `/api/v1/downtime/` | Alternative downtime endpoint |
| `/api/v1/downtime/<downtime_id>` | Get/update/delete specific downtime |
| `/api/v1/downtime/search` | Search downtimes |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/downtime` | List/create downtimes (v2) |
| `/api/v2/downtime/` | Alternative downtime endpoint (v2) |
| `/api/v2/downtime/<downtime_id>` | Get/update/delete specific downtime (v2) |

---

## Event Platform

Endpoints for event processing pipelines and log processing.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/event-platform/<track>/processing/pipelines` | Processing pipelines by track |
| `/api/v1/event-platform/<track>/processing/pipelines/<pipelineId>` | Specific pipeline |
| `/api/v1/event-platform/<track>/processing/pipelines/<pipelineId>/processors` | Pipeline processors |
| `/api/v1/event-platform/<track>/processing/pipelines/<pipelineId>/processors/<processorId>` | Specific processor |
| `/api/v1/event-platform/<track>/processing/pipelines/<pipelineId>/processors/duplicate` | Duplicate processor |
| `/api/v1/event-platform/<track>/processing/pipelines/duplicate` | Duplicate pipeline |
| `/api/v1/event-platform/<track>/processors/configurations` | Processor configurations |
| `/api/v1/event-platform/<track>/processors/samples` | Processor samples |
| `/api/v1/event-platform/<track>/remapping` | Field remapping |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/event-platform/<track>/activity` | Event platform activity |
| `/api/v2/event-platform/logs/offline-queries` | Offline log queries |
| `/api/v2/event-platform/logs/offline-queries/<query_uuid>` | Specific offline query |
| `/api/v2/event-platform/logs/offline-queries/results` | Offline query results |
| `/api/v2/event-platform/logs/offline-query` | Submit offline query |
| `/api/v2/events/mail/on-call` | On-call email events |
| `/api/v2/events/mail/on-call/<emailId>` | Specific on-call email |

---

## Integrations

Endpoints for managing third-party integrations.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/integration` | List integrations |
| `/api/v1/integration/alibaba_cloud` | Alibaba Cloud integration |
| `/api/v1/integration/alibaba_cloud/host_filters` | Alibaba Cloud host filters |
| `/api/v1/integration/detected` | Auto-detected integrations |
| `/api/v1/integration/gcp` | GCP integration |
| `/api/v1/integration/pagerduty` | PagerDuty integration |
| `/api/v1/integration/pagerduty/configuration/services` | PagerDuty service config |
| `/api/v1/integrations/tiles/list` | Integration tiles list |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/connection/connection_groups` | Connection groups |
| `/api/v2/connection/connection_groups/<connectionGroupId>` | Specific connection group |
| `/api/v2/connection/connections` | List connections |
| `/api/v2/connection/custom_connections` | Custom connections |
| `/api/v2/connection/custom_connections/<connectionId>` | Specific custom connection |
| `/api/v2/connection/custom_connections/by_tags` | Connections filtered by tags |
| `/api/v2/connection/custom_connections/set_default_tag` | Set default connection tag |
| `/api/v2/connection/integrations` | Connection integrations |
| `/api/v2/integration/aws/accounts` | AWS integration accounts |
| `/api/v2/integration/aws/accounts/<account_id>` | Specific AWS account |
| `/api/v2/integration/aws/accounts/<id>` | Specific AWS account (alt) |
| `/api/v2/integration/aws/generate_new_external_id` | Generate AWS external ID |
| `/api/v2/integration/confluent_cloud/list_resource_topology?account_id=<accountId>` | Confluent Cloud topology |
| `/api/v2/integration/confluent_cloud/add_resources_to_account?account_id=<accountId>` | Add Confluent resources |
| `/api/v2/integration/curated_metrics` | Curated integration metrics |
| `/api/v2/integration/eventarc` | Google Eventarc integration |
| `/api/v2/integration/gcp/accounts/<id>` | GCP integration account |
| `/api/v2/integration/github_apps/feature-available` | GitHub App feature availability |
| `/api/v2/integration/github_apps/permissions` | GitHub App permissions |
| `/api/v2/integration/jira/accounts` | Jira integration accounts |
| `/api/v2/integration/jira/accounts/<id>` | Specific Jira account |
| `/api/v2/integration/jira/issue-templates` | Jira issue templates |
| `/api/v2/integration/jira/issue-templates/<id>` | Specific Jira template |
| `/api/v2/integration/jira/issue-templates/<id>?overwrite_fields=true` | Update Jira template |
| `/api/v2/integration/oci/products` | Oracle Cloud products |
| `/api/v2/integration/oci/tenancies` | OCI tenancies |
| `/api/v2/integration/oci/tenancies/<tenancy_ocid>` | Specific OCI tenancy |
| `/api/v2/integration/opsgenie/accounts` | OpsGenie accounts |
| `/api/v2/integration/opsgenie/accounts/<id>` | Specific OpsGenie account |
| `/api/v2/integration/opsgenie/services` | OpsGenie services |
| `/api/v2/integration/opsgenie/services/<id>` | Specific OpsGenie service |

---

## Logs

Endpoints for log management, search, and analytics.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/logs` | Log ingestion endpoint |
| `/api/v1/logs-analytics/<queryType>` | Log analytics by query type |
| `/api/v1/logs-analytics/aggregate` | Aggregate log analytics |
| `/api/v1/logs-analytics/cluster` | Log clustering |
| `/api/v1/logs-analytics/cluster?type=<track>` | Log clustering by track |
| `/api/v1/logs-analytics/fetch_one` | Fetch single log |
| `/api/v1/logs-analytics/list` | List logs |
| `/api/v1/logs-analytics/list-csv` | Export logs as CSV |
| `/api/v1/logs-analytics/look_ahead` | Log look-ahead query |
| `/api/v1/logs-analytics/transaction` | Log transactions |
| `/api/v1/logs-analytics/transaction_computes` | Transaction computations |
| `/api/v1/logs-analytics/transaction_start_end` | Transaction start/end detection |
| `/api/v1/logs/configuration/indexes` | Log index configuration |
| `/api/v1/logs/default-views` | Default log views |
| `/api/v1/logs/external_archives` | External log archives |
| `/api/v1/logs/external_archives/<archiveId>` | Specific external archive |
| `/api/v1/logs/external_archives/<archiveId>/read_roles` | Archive read roles |
| `/api/v1/logs/external_archives/<externalArchiveId>` | External archive (alt) |
| `/api/v1/logs/filters` | Log filters |
| `/api/v1/logs/historical_indexes` | Historical log indexes |
| `/api/v1/logs/historical_indexes/<indexName>` | Specific historical index |
| `/api/v1/logs/indexes` | Log indexes |
| `/api/v1/logs/indexes/<indexName>` | Specific log index |
| `/api/v1/logs/integration/views/<integrationId>/<integrationShortName>` | Integration log views |
| `/api/v1/logs/scopes/<indexName>/filters` | Index scope filters |
| `/api/v1/logs/start_using_logs` | Log onboarding |
| `/api/v1/logs/views` | Log views |
| `/api/v1/logs/views/<id>` | Specific log view |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/logs/events/search` | Search log events |
| `/api/v2/logs/external_archives/validate` | Validate external archive |
| `/api/v2/logs/historical_indexes` | Historical indexes (v2) |
| `/api/v2/logs/recommendations` | Log recommendations |
| `/api/v2/logs/recommendations/total-log-count` | Total log count for recommendations |
| `/api/v2/logs/views/mark-as-viewed` | Mark log views as viewed |
| `/api/v2/audit-trail/nlq-translation` | Natural language query translation |

---

## Metrics

Endpoints for metrics management and queries.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/tag_keys` | List tag keys |
| `/api/v1/timeseries` | Timeseries data |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/metrics` | List metrics |
| `/api/v2/metrics/<metric_name>/active-configurations` | Active metric configurations |
| `/api/v2/metrics/<metric_name>/volumes` | Metric volumes |
| `/api/v2/metrics/<metricName>/all-tags` | All tags for metric |
| `/api/v2/metrics/<metricName>/assets` | Metric assets |
| `/api/v2/metrics/<metricName>/estimate` | Metric cardinality estimate |
| `/api/v2/metrics/<metricName>/tag-cardinalities` | Tag cardinalities for metric |
| `/api/v2/metrics/<metricName>/tags` | Tags for metric |
| `/api/v2/metrics/config/bulk-tags` | Bulk tag configuration |
| `/api/v2/metrics/late-metrics-config-bulk` | Bulk late metrics config |
| `/api/v2/metrics/late-metrics-config-single` | Single late metric config |
| `/api/v2/semantic-core/mappings` | Semantic core mappings |
| `/api/v2/semantic-core/tag-mappings` | Tag mappings |

---

## Monitors

Endpoints for monitor management and alerting.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/monitor` | List/create monitors |
| `/api/v1/monitor/` | Alternative monitor endpoint |
| `/api/v1/monitor/<id>` | Get/update/delete monitor |
| `/api/v1/monitor/<id>?migrate_locked=true` | Migrate locked monitor |
| `/api/v1/monitor/<id>/search_groups` | Search monitor groups |
| `/api/v1/monitor/<monitorId>` | Monitor by ID (alt) |
| `/api/v1/monitor/<monitorId>/search_groups` | Search monitor groups (alt) |
| `/api/v1/monitor/can_delete` | Check if monitor can be deleted |
| `/api/v1/monitor/get_composite_preview` | Composite monitor preview |
| `/api/v1/monitor/groups/search` | Search monitor groups |
| `/api/v1/monitor/saved_view/<id>` | Saved monitor view |
| `/api/v1/monitor/search` | Search monitors |
| `/api/v1/monitor/tags` | Monitor tags |
| `/api/v1/monitor/validate` | Validate monitor definition |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/monitor/` | List monitors (v2) |
| `/api/v2/monitor/<monitor_id>/downtime_matches` | Monitor downtime matches |
| `/api/v2/monitor/notification_rule` | Monitor notification rules |
| `/api/v2/monitor/notification_rule/<rule_id>` | Specific notification rule |
| `/api/v2/monitor/policy` | Monitor policies |
| `/api/v2/monitor/policy/<id>` | Specific monitor policy |
| `/api/v2/monitor/recommended` | Recommended monitors |
| `/api/v2/notifications/handles` | Notification handles |

---

## Network & Infrastructure

Endpoints for network monitoring and infrastructure management.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/account/public_sharing_ips` | Public sharing IP addresses |
| `/api/v1/hosts` | List hosts |
| `/api/v1/network/edges` | Network edges |
| `/api/v1/node_map/nodes_by_group` | Node map grouped nodes |
| `/api/v1/process/metric` | Process metrics |
| `/api/v1/process/metric/<metricKey>` | Specific process metric |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/infrastructure/devices` | Infrastructure devices |
| `/api/v2/infrastructure/devices/<deviceId>` | Specific infrastructure device |
| `/api/v2/ndm/tags/devices/<deviceId>` | NDM device tags |
| `/api/v2/ndm/tags/devices/<deviceId>?bySource=<bySource>` | NDM tags by source |
| `/api/v2/network-health-insights` | Network health insights |
| `/api/v2/process/label_counts` | Process label counts |
| `/api/v2/process/summary` | Process summary |
| `/api/v2/change-tracking/service_edges` | Service change tracking edges |

---

## Notebooks

Endpoints for collaborative notebooks.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/notebook/` | Notebooks endpoint |
| `/api/v1/notebooks` | List notebooks |
| `/api/v1/notebooks/<notebookId>` | Specific notebook |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/notebooks` | List notebooks (v2) |
| `/api/v2/notebooks/search` | Search notebooks |

---

## On-Call & Escalation

Endpoints for on-call scheduling and escalation management.

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/on-call/escalation-policies` | List escalation policies |
| `/api/v2/on-call/escalation-policies/<policyId>` | Specific escalation policy |
| `/api/v2/on-call/escalation-policies/<policyUUID>` | Escalation policy by UUID |
| `/api/v2/on-call/schedules` | On-call schedules |
| `/api/v2/on-call/schedules/<scheduleId>` | Specific on-call schedule |
| `/api/v2/on-call/schedules/<scheduleId>/on-call` | Who's on-call for schedule |
| `/api/v2/on-call/schedules/<scheduleId>/overrides` | Schedule overrides |
| `/api/v2/on-call/schedules/<scheduleId>/overrides/<overrideId>` | Specific override |
| `/api/v2/on-call/teams/<teamId>/routing-rules` | Team routing rules |
| `/api/v2/on-call/teams/<teamUUID>/on-call` | Who's on-call for team |
| `/api/v2/on-call/teams/<teamUUID>/routing-rules` | Team routing rules (UUID) |
| `/api/v2/on-call/users/<userId>/shifts` | User's on-call shifts |
| `/api/v2/on_prem_runners` | On-premises runners |
| `/api/v2/on-prem-management-service/enrollments` | On-prem service enrollments |
| `/api/v2/on-prem-management-service/enrollments/<hash>` | Specific enrollment |
| `/api/v2/on-prem-management-service/runner/latest-image` | Latest runner image |

---

## Product Analytics

Endpoints for product analytics and user behavior tracking.

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/product-analytics/accounts/facet_info` | Account facet information |
| `/api/v2/product-analytics/accounts/mapping` | Account mapping |
| `/api/v2/product-analytics/accounts/mapping/connection` | Account mapping connection |
| `/api/v2/product-analytics/accounts/mapping/connection/<id>` | Specific connection |
| `/api/v2/product-analytics/accounts/mapping/connections` | All mapping connections |
| `/api/v2/product-analytics/accounts/query` | Account analytics query |
| `/api/v2/product-analytics/insights/<insightId>` | Specific insight |
| `/api/v2/product-analytics/insights/<insightId>/notebook` | Insight notebook |
| `/api/v2/product-analytics/insights/<insightType>` | Insights by type |
| `/api/v2/product-analytics/insights/notebook` | Insights notebook |
| `/api/v2/product-analytics/integrations/snowflake/accounts/<accountId>/databases` | Snowflake databases |
| `/api/v2/product-analytics/integrations/snowflake/accounts/<accountId>/databases/<databaseName>/tables` | Snowflake tables |
| `/api/v2/product-analytics/integrations/snowflake/accounts/<accountId>/tables/<tableId>/columns` | Snowflake columns |
| `/api/v2/product-analytics/integrations/snowflake/accounts/<accountId>/tables/<tableId>/preview` | Snowflake table preview |
| `/api/v2/product-analytics/labeled-action` | Labeled actions |
| `/api/v2/product-analytics/labeled-action/<id>` | Specific labeled action |
| `/api/v2/product-analytics/labeled-action/list` | List labeled actions |
| `/api/v2/product-analytics/users/event_filtered_query` | User event filtered query |
| `/api/v2/product-analytics/users/facet_info` | User facet information |
| `/api/v2/product-analytics/users/mapping` | User mapping |
| `/api/v2/product-analytics/users/mapping/connection` | User mapping connection |
| `/api/v2/product-analytics/users/mapping/connection/<id>` | Specific user connection |
| `/api/v2/product-analytics/users/mapping/connections` | All user connections |
| `/api/v2/product-analytics/users/query` | User analytics query |
| `/api/v2/product-analytics/users/unified_segment_preview` | Unified segment preview |
| `/api/v2/widgets/product_analytics` | Product analytics widgets |
| `/api/v2/widgets/product_analytics/<id>` | Specific widget |

---

## RUM (Real User Monitoring)

Endpoints for RUM applications, sessions, and replay.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/rum/projects` | RUM projects (legacy) |
| `/api/v1/rum/projects/<application_id>` | Specific RUM project |
| `/api/v1/rum/replay/sessions/` | RUM replay sessions |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/rum/applications` | RUM applications |
| `/api/v2/rum/applications/<application_id>` | Specific RUM application |
| `/api/v2/rum/applications/<applicationId>/relationships/retention_filters` | Application retention filter relationships |
| `/api/v2/rum/applications/<applicationId>/retention_filters` | Application retention filters |
| `/api/v2/rum/applications/<applicationId>/retention_filters/<filterId>` | Specific retention filter |
| `/api/v2/rum/cohort/users` | RUM user cohorts |
| `/api/v2/rum/config` | RUM configuration |
| `/api/v2/rum/funnel` | RUM funnel analysis |
| `/api/v2/rum/replay/playlists` | Session replay playlists |
| `/api/v2/rum/replay/playlists/<playlistId>` | Specific replay playlist |
| `/api/v2/rum/replay/playlists/<playlistId>/sessions` | Sessions in playlist |
| `/api/v2/rum/replay/playlists/<playlistId>/sessions/<sessionId>` | Specific session in playlist |
| `/api/v2/rum/replay/sessions/` | RUM replay sessions (v2) |
| `/api/v2/rum/replay/sessions/<session_id>/extended-retention` | Extended retention for session |
| `/api/v2/rum/replay/sessions/<session_id>/metadata` | Session metadata |
| `/api/v2/rum/replay/sessions/<session_id>/retention` | Session retention settings |
| `/api/v2/rum/replay/sessions/<sessionId>/watchers` | Session watchers |
| `/api/v2/rum/replay/sessions/<sessionId>/watches` | Session watches |
| `/api/v2/rum/replay/viewership-history/sessions` | Session viewership history |
| `/api/v2/rum/resource` | RUM resources |
| `/api/v2/rum/resource/token` | RUM resource token |
| `/api/v2/rum/sankey` | RUM Sankey diagram data |
| `/api/v2/rum/segment` | RUM segments |
| `/api/v2/rum/segment/<id>` | Specific RUM segment |
| `/api/v2/rum/segment/static` | Static RUM segments |
| `/api/v2/remote_config/products/rum/configs` | RUM remote configs |
| `/api/v2/remote_config/products/rum/configs/<remoteConfigId>` | Specific remote config |
| `/api/v2/replay/heatmap/snapshots` | Replay heatmap snapshots |
| `/api/v2/replay/summary/<session_id>` | Replay session summary |

---

## Security Monitoring

Endpoints for security monitoring, detection rules, and signals.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/security_analytics` | Security analytics overview |
| `/api/v1/security_analytics/<product>/<activationType>` | Product security activation |
| `/api/v1/security_analytics/activation` | Security activation |
| `/api/v1/security_analytics/application_security/activation` | App security activation |
| `/api/v1/security_analytics/resource_type_mapping` | Security resource type mapping |
| `/api/v1/security_analytics/rules/<ruleId>` | Security rule by ID |
| `/api/v1/security_analytics/rules/facet_info` | Rule facet information |
| `/api/v1/security_analytics/rules/facets` | Rule facets |
| `/api/v1/security_analytics/saved_views` | Saved security views |
| `/api/v1/security_analytics/signals/<signal_id>/add_to_incident` | Add signal to incident |
| `/api/v1/security_analytics/signals/rule_based_view` | Rule-based signal view |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/security_monitoring/cloud_workload_security/activity_dumps/<activity_dump_id>` | CWS activity dump |
| `/api/v2/security_monitoring/cloud_workload_security/agent_rules` | CWS agent rules |
| `/api/v2/security_monitoring/cloud_workload_security/agent_rules/<id>` | Specific CWS rule |
| `/api/v2/security_monitoring/cloud_workload_security/agent_rules_facets` | CWS rule facets |
| `/api/v2/security_monitoring/cloud_workload_security/agent_rules_facets/facet_info` | CWS facet info |
| `/api/v2/security_monitoring/configuration/critical_assets` | Critical assets config |
| `/api/v2/security_monitoring/configuration/integration_config` | Integration config |
| `/api/v2/security_monitoring/configuration/integration_config/<configId>` | Specific integration config |
| `/api/v2/security_monitoring/configuration/notification_rules` | Security notification rules |
| `/api/v2/security_monitoring/configuration/notification_rules/<id>` | Specific notification rule |
| `/api/v2/security_monitoring/configuration/notification_rules/send_notification_preview` | Preview notification |
| `/api/v2/security_monitoring/configuration/security_filters` | Security filters |
| `/api/v2/security_monitoring/configuration/security_filters/<security_filter_id>` | Specific security filter |
| `/api/v2/security_monitoring/configuration/suppressions` | Security suppressions |
| `/api/v2/security_monitoring/configuration/suppressions/<id>` | Specific suppression |
| `/api/v2/security_monitoring/configuration/suppressions/<id>/version_history` | Suppression version history |
| `/api/v2/security_monitoring/configuration/suppressions/rules/<ruleId>` | Suppressions for rule |
| `/api/v2/security_monitoring/content_packs/<contentPackId>/activate` | Activate content pack |
| `/api/v2/security_monitoring/content_packs/<contentPackId>/deactivate` | Deactivate content pack |
| `/api/v2/security_monitoring/content_packs/states` | Content pack states |
| `/api/v2/security_monitoring/datasets` | Security datasets |
| `/api/v2/security_monitoring/datasets/<datasetId>` | Specific dataset |
| `/api/v2/security_monitoring/datasets/<datasetId>/version/<version>` | Dataset version |
| `/api/v2/security_monitoring/datasets/<datasetId>/version_history` | Dataset version history |
| `/api/v2/security_monitoring/datasets/dependencies` | Dataset dependencies |
| `/api/v2/security_monitoring/livetail` | Security livetail |
| `/api/v2/security_monitoring/rules` | Security monitoring rules |
| `/api/v2/security_monitoring/rules/<id>/filter` | Rule filter |
| `/api/v2/security_monitoring/rules/<ruleId>` | Specific security rule |
| `/api/v2/security_monitoring/rules/<ruleId>/version_history` | Rule version history |
| `/api/v2/security_monitoring/rules/bulk_delete` | Bulk delete rules |
| `/api/v2/security_monitoring/rules/bulk_export` | Bulk export rules |
| `/api/v2/security_monitoring/rules/convert` | Convert rule format |
| `/api/v2/security_monitoring/rules/convert/bulk` | Bulk convert rules |
| `/api/v2/security_monitoring/rules/test` | Test security rule |
| `/api/v2/security_monitoring/sample_log_generation/subscriptions` | Sample log subscriptions |
| `/api/v2/security_monitoring/sample_log_generation/subscriptions/<contentPackId>` | Specific subscription |
| `/api/v2/security_monitoring/security_agent/activate` | Activate security agent |
| `/api/v2/security_monitoring/security_agent/compatible_rules` | Compatible agent rules |
| `/api/v2/security_monitoring/security_agent/filter_query` | Agent filter query |
| `/api/v2/security_monitoring/security_agent/investigation_credits` | Investigation credits |
| `/api/v2/security_monitoring/security_agent/min_severity` | Minimum severity setting |
| `/api/v2/security_monitoring/security_agent/rules` | Security agent rules |
| `/api/v2/security_monitoring/signals/<signal_id>/assignee` | Signal assignee |
| `/api/v2/security_monitoring/signals/<signal_id>/state` | Signal state |
| `/api/v2/security_monitoring/signals/<signalId>/entities` | Signal entities |
| `/api/v2/security_monitoring/signals/<signalId>/summary` | Signal summary |
| `/api/v2/security_monitoring/signals/bulk/assignee` | Bulk update assignee |
| `/api/v2/security_monitoring/signals/bulk/state` | Bulk update state |
| `/api/v2/security_monitoring/signals/investigation` | Signal investigation |
| `/api/v2/security_monitoring/signals/investigation/feedback` | Investigation feedback |
| `/api/v2/security_monitoring/signals/investigation/feedback/<signalId>` | Specific feedback |
| `/api/v2/security_monitoring/signals/summarize` | Summarize signals |
| `/api/v2/security/appsec/invite` | AppSec invite |
| `/api/v2/security/findings/cases` | Security findings cases |
| `/api/v2/security/findings/cases/<id>` | Specific findings case |
| `/api/v2/security/findings/jira_issues` | Security Jira issues |
| `/api/v2/security/findings/jira_issues/metadata` | Jira issues metadata |
| `/api/v2/security/findings/servicenow_tickets` | ServiceNow tickets |
| `/api/v2/security/siem/ioc-explorer` | SIEM IOC explorer |
| `/api/v2/security/vulnerabilities/pipelines/due_date_rules` | Vulnerability due date rules |
| `/api/v2/security/vulnerabilities/pipelines/due_date_rules/<ruleId>` | Specific due date rule |
| `/api/v2/security/vulnerabilities/pipelines/due_date_rules/reorder` | Reorder due date rules |
| `/api/v2/security/vulnerabilities/pipelines/inbox_rules` | Vulnerability inbox rules |
| `/api/v2/security/vulnerabilities/pipelines/inbox_rules/<ruleId>` | Specific inbox rule |
| `/api/v2/security/vulnerabilities/pipelines/inbox_rules/reorder` | Reorder inbox rules |
| `/api/v2/security/vulnerabilities/pipelines/mute_rules` | Vulnerability mute rules |
| `/api/v2/security/vulnerabilities/pipelines/mute_rules/<ruleId>` | Specific mute rule |
| `/api/v2/security/vulnerabilities/pipelines/mute_rules/reorder` | Reorder mute rules |

### SIEM Historical Detections & Threat Hunting

| Endpoint | Description |
|----------|-------------|
| `/api/v2/siem-historical-detections/jobs` | Historical detection jobs |
| `/api/v2/siem-historical-detections/jobs/` | Alternative jobs endpoint |
| `/api/v2/siem-historical-detections/jobs/<jobId>` | Specific detection job |
| `/api/v2/siem-historical-detections/jobs/<jobId>/cancel` | Cancel detection job |
| `/api/v2/siem-historical-detections/jobs/signal_convert` | Convert to signal |
| `/api/v2/siem-threat-hunting/jobs` | Threat hunting jobs |
| `/api/v2/siem-threat-hunting/jobs/` | Alternative jobs endpoint |
| `/api/v2/siem-threat-hunting/jobs/<jobId>` | Specific hunting job |
| `/api/v2/siem-threat-hunting/jobs/<jobId>/cancel` | Cancel hunting job |
| `/api/v2/siem-threat-hunting/jobs/signal_convert` | Convert to signal |

---

## Service Catalog

Endpoints for service catalog and service definitions.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/service_dependencies/<service>` | Service dependencies |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/catalog/entity` | Catalog entities |
| `/api/v2/catalog/entity/<refOrUuid>` | Specific catalog entity |
| `/api/v2/catalog/kind` | Catalog kinds |
| `/api/v2/catalog/kind/<kindName>` | Specific catalog kind |
| `/api/v2/catalog/recommended_entity/bulk_accept` | Bulk accept recommended entities |
| `/api/v2/catalog/recommended_entity/bulk_decline` | Bulk decline recommended entities |
| `/api/v2/catalog/recommended_entity/trigger` | Trigger entity recommendation |
| `/api/v2/catalog/relation` | Catalog relations |
| `/api/v2/idp/config/<config_name>` | IDP configuration |
| `/api/v2/idp/entity_graph/entities` | Entity graph entities |
| `/api/v2/idp/entity_graph/facets` | Entity graph facets |
| `/api/v2/idp/entity_graph/kind_counts` | Entity kind counts |
| `/api/v2/scorecard/outcomes/batch` | Scorecard outcomes batch |
| `/api/v2/scorecard/rules/<ruleID>` | Scorecard rule |
| `/api/v2/scorecard/scores/by-<aggr>` | Scorecard scores by aggregation |
| `/api/v2/service-overrides` | Service overrides |
| `/api/v2/service-overrides/migration` | Service overrides migration |
| `/api/v2/services/catalog` | Service catalog |
| `/api/v2/services/catalog/active` | Active services |
| `/api/v2/services/catalog/product_areas` | Product areas |
| `/api/v2/services/definitions` | Service definitions |
| `/api/v2/services/definitions/<service>` | Specific service definition |
| `/api/v2/services/discover` | Service discovery |
| `/api/v2/services/discover/snapshot` | Discovery snapshot |
| `/api/v2/services/integrations/opsgenie/oncalls` | OpsGenie on-calls |
| `/api/v2/services/integrations/pagerduty/oncalls` | PagerDuty on-calls |
| `/api/v2/services/raw_definitions/<service>` | Raw service definition |

---

## SLOs (Service Level Objectives)

Endpoints for SLO management and reporting.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/slo` | List/create SLOs |
| `/api/v1/slo/<slo_id>` | Get/update/delete SLO |
| `/api/v1/slo/<slo_id>/corrections` | SLO corrections |
| `/api/v1/slo/<slo_id>/history` | SLO history |
| `/api/v1/slo/<sloId>` | SLO by ID (alternate) |
| `/api/v1/slo/bulk_delete?force=true` | Bulk delete SLOs |
| `/api/v1/slo/can_delete` | Check if SLO can be deleted |
| `/api/v1/slo/correction` | SLO corrections |
| `/api/v1/slo/correction/<id>` | Specific SLO correction |
| `/api/v1/slo/correction/bulk_delete` | Bulk delete corrections |
| `/api/v1/slo/search` | Search SLOs |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/slo/<slo_id>/status` | SLO status |
| `/api/v2/slo/report` | SLO reports |
| `/api/v2/slo/report/<id>/download` | Download SLO report |
| `/api/v2/slo/report/<id>/status` | SLO report status |

---

## Source Code Integration

Endpoints for source code integration with GitHub, GitLab, and Azure DevOps.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/source-code-integration/search-tracked-files` | Search tracked files |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/source-code-integration/code-owners` | Code owners |
| `/api/v2/source-code-integration/code-snippet` | Code snippets |
| `/api/v2/source-code-integration/enrich-stack-trace` | Enrich stack traces |
| `/api/v2/source-code-integration/get-file-link` | Get file links |
| `/api/v2/source-code-integration/repositories-v2` | Repositories (v2) |
| `/api/v2/source-code/azdevops-accounts/cwp_settings` | Azure DevOps CWP settings |
| `/api/v2/source-code/azdevops-instances` | Azure DevOps instances |
| `/api/v2/source-code/azdevops/apps` | Azure DevOps apps |
| `/api/v2/source-code/azdevops/apps/<appId>` | Specific Azure DevOps app |
| `/api/v2/source-code/azdevops/apps/<appId>/organizations/<orgId>` | App organization |
| `/api/v2/source-code/azdevops/apps/<id>/organizations` | App organizations |
| `/api/v2/source-code/azdevops/organizations` | Azure DevOps organizations |
| `/api/v2/source-code/azdevops/organizations/<orgId>/repositories` | Org repositories |
| `/api/v2/source-code/azdevops/organizations/<orgName>/sync` | Sync organization |
| `/api/v2/source-code/azdevops/organizations/<orgName>/webhooks` | Org webhooks |
| `/api/v2/source-code/change-request/product/<dd_product>/changes/<change_id>` | Change request |
| `/api/v2/source-code/change-request/supported` | Supported change requests |
| `/api/v2/source-code/cwp-runs/bulk-search` | CWP runs bulk search |
| `/api/v2/source-code/github-accounts` | GitHub accounts |
| `/api/v2/source-code/github-accounts/cwp_settings` | GitHub CWP settings |
| `/api/v2/source-code/github/accounts` | GitHub accounts (alt) |
| `/api/v2/source-code/github/accounts/<accountId>/repositories` | GitHub account repos |
| `/api/v2/source-code/github/apps` | GitHub apps |
| `/api/v2/source-code/github/available-accounts` | Available GitHub accounts |
| `/api/v2/source-code/github/available-accounts-with-permissions` | Accounts with permissions |
| `/api/v2/source-code/github/available-repositories` | Available repositories |
| `/api/v2/source-code/github/available-repositories-with-permissions` | Repos with permissions |
| `/api/v2/source-code/github/check-app-health` | Check GitHub app health |
| `/api/v2/source-code/github/private-apps/repositories` | Private app repos |
| `/api/v2/source-code/github/public-app/installations` | Public app installations |
| `/api/v2/source-code/github/public-app/installations/<installation_id>/repositories` | Installation repos |
| `/api/v2/source-code/gitlab-accounts/cwp_settings` | GitLab CWP settings |
| `/api/v2/source-code/gitlab-instances` | GitLab instances |
| `/api/v2/source-code/gitlab/instances` | GitLab instances (alt) |
| `/api/v2/source-code/gitlab/instances/<id>/repositories` | Instance repositories |
| `/api/v2/source-code/gitlab/instances/<id>/sync` | Sync GitLab instance |
| `/api/v2/source-code/gitlab/instances/<instanceId>` | Specific GitLab instance |
| `/api/v2/source-code/gitlab/instances/ping` | Ping GitLab instance |
| `/api/v2/source-code/gitlab/oauth-apps` | GitLab OAuth apps |
| `/api/v2/source-code/gitlab/oauth-apps/<oauthAppId>` | Specific OAuth app |
| `/api/v2/source-code/gitlab/oauth/groups` | GitLab OAuth groups |
| `/api/v2/source-code/gitlab/tokens` | GitLab tokens |
| `/api/v2/source-code/gitlab/tokens/<tokenId>` | Specific GitLab token |
| `/api/v2/source-code/mappings/overrides/service-repository` | Service-repo mapping overrides |
| `/api/v2/source-code/mappings/overrides/service-repository/<serviceName>` | Service mapping override |
| `/api/v2/source-code/mappings/service-repository/<serviceName>` | Service-repo mapping |
| `/api/v2/source-code/mappings/span` | Span mappings |
| `/api/v2/source-code/pr-gates/rules` | PR gate rules |
| `/api/v2/source-code/pr-gates/rules/<ruleId>` | Specific PR gate rule |
| `/api/v2/source-code/repositories` | Source code repositories |
| `/api/v2/source-code/repositories/<repoId>` | Specific repository |
| `/api/v2/source-code/repositories/<repoID>/commits/<commitSHA>/link` | Commit link |
| `/api/v2/source-code/repositories/<repoId>/features/<feature>` | Repository feature |
| `/api/v2/source-code/repositories/cwp_settings` | Repositories CWP settings |
| `/api/v2/source-code/repository-configured-v2` | Check configured repos |
| `/api/v2/source-code/repository-id` | Get repository ID |
| `/api/v2/sourcemaps/sources` | Sourcemaps |
| `/api/v2/static-analysis/codegen/rulesets` | Static analysis rulesets |
| `/api/v2/static-analysis/repositories/summary` | Static analysis summary |

---

## Synthetics

Endpoints for synthetic monitoring tests and results.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/synthetics/browser/subtests` | Browser subtests |
| `/api/v1/synthetics/browser/subtests/<testId>` | Specific browser subtest |
| `/api/v1/synthetics/browser/subtests/<testId>/parents` | Subtest parents |
| `/api/v1/synthetics/browser/tests/<testId>` | Browser test by ID |
| `/api/v1/synthetics/browser/tests/<testId>/emails` | Test emails |
| `/api/v1/synthetics/browser/tests/<testId>/results/<resultId>/artifacts` | Result artifacts |
| `/api/v1/synthetics/browser/tests/<testId>/results/<resultId>/steps/<stepId>/email` | Step email |
| `/api/v1/synthetics/browser/tests/<testId>/results/<resultId>/steps/<stepIndex>/screenshot` | Step screenshot |
| `/api/v1/synthetics/browser/tests/<testId>/results/<resultId>/steps/<stepIndex>/snapshot` | Step snapshot |
| `/api/v1/synthetics/browser/tests/<testId>/steps` | Test steps |
| `/api/v1/synthetics/config` | Synthetics configuration |
| `/api/v1/synthetics/enforced_tags` | Enforced tags |
| `/api/v1/synthetics/locations` | Test locations |
| `/api/v1/synthetics/private-locations` | Private locations |
| `/api/v1/synthetics/private-locations/<privateLocationId>` | Specific private location |
| `/api/v1/synthetics/results-encryption-public-key` | Results encryption key |
| `/api/v1/synthetics/settings` | Synthetics settings |
| `/api/v1/synthetics/settings/apm_wildcard_urls` | APM wildcard URLs |
| `/api/v1/synthetics/settings/default_locations` | Default test locations |
| `/api/v1/synthetics/tests` | List/create tests |
| `/api/v1/synthetics/tests/<testId>` | Get/update/delete test |
| `/api/v1/synthetics/tests/<testId>/locations` | Test locations |
| `/api/v1/synthetics/tests/<testId>/search_events` | Search test events |
| `/api/v1/synthetics/tests/<testId>/status` | Test status |
| `/api/v1/synthetics/tests/<testType>/<testId>` | Test by type and ID |
| `/api/v1/synthetics/tests/delete` | Delete tests |
| `/api/v1/synthetics/tests/fast` | Fast tests |
| `/api/v1/synthetics/tests/search` | Search tests |
| `/api/v1/synthetics/tests/trigger/ui` | Trigger test from UI |
| `/api/v1/synthetics/tests/uptimes` | Test uptimes |
| `/api/v1/synthetics/variables` | Synthetics variables |
| `/api/v1/synthetics/variables/<variableId>` | Specific variable |
| `/api/v1/synthetics/variables/<variableId>/clear` | Clear variable |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/synthetics/api-multistep/subtests/<testId>` | API multistep subtests |
| `/api/v2/synthetics/api-multistep/subtests/<testId>/parents` | Subtest parents |
| `/api/v2/synthetics/authentication` | Synthetics authentication |
| `/api/v2/synthetics/authentication/<auth_id>` | Specific authentication |
| `/api/v2/synthetics/browser/session_replay` | Browser session replay |
| `/api/v2/synthetics/browser/session_replay/session/<sessionId>` | Specific session replay |
| `/api/v2/synthetics/browser/tests/<testId>/steps/multipart-presigned-urls` | Multipart presigned URLs |
| `/api/v2/synthetics/browser/tests/<testId>/steps/multipart-upload-abort` | Abort multipart upload |
| `/api/v2/synthetics/browser/tests/<testId>/steps/multipart-upload-complete` | Complete multipart upload |
| `/api/v2/synthetics/crawlers` | Synthetics crawlers |
| `/api/v2/synthetics/crawlers/<crawlerId>` | Specific crawler |
| `/api/v2/synthetics/crawlers/jobs` | Crawler jobs |
| `/api/v2/synthetics/crawlers/jobs/latest` | Latest crawler job |
| `/api/v2/synthetics/data_tables` | Data tables |
| `/api/v2/synthetics/data_tables/<dataTableId>` | Specific data table |
| `/api/v2/synthetics/features/<featureId>/coverage` | Feature coverage |
| `/api/v2/synthetics/settings/on_demand_concurrency_cap` | On-demand concurrency cap |
| `/api/v2/synthetics/suites` | Test suites |
| `/api/v2/synthetics/suites/<public_id>` | Suite by public ID |
| `/api/v2/synthetics/suites/<suiteId>` | Suite by ID |
| `/api/v2/synthetics/suites/bulk-delete` | Bulk delete suites |
| `/api/v2/synthetics/suites/search` | Search suites |
| `/api/v2/synthetics/tests/<testId>/parent-suites` | Test parent suites |
| `/api/v2/synthetics/tests/<testId>/results` | Test results |
| `/api/v2/synthetics/tests/<testId>/results/<resultId>` | Specific test result |
| `/api/v2/synthetics/tests/<testId>/version_history` | Test version history |
| `/api/v2/synthetics/tests/fast/<fastTestUuid>` | Fast test by UUID |
| `/api/v2/synthetics/user_journeys` | User journeys |
| `/api/v2/synthetics/user_journeys/<journeyId>` | Specific user journey |
| `/api/v2/synthetics/variables/<variable_id>/jsonpatch` | Variable JSON patch |

---

## Teams & Organizations

Endpoints for team and organization management.

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/team` | List/create teams |
| `/api/v2/team/<id>` | Get/update/delete team |
| `/api/v2/team/<id>/links` | Team links |
| `/api/v2/team/<id>/memberships` | Team memberships |
| `/api/v2/team/<id>/permission-settings` | Team permission settings |
| `/api/v2/team/<id>/permission-settings/<action>` | Specific permission action |
| `/api/v2/team/<teamId>/links/<id>` | Specific team link |
| `/api/v2/team/connections` | Team connections |
| `/api/v2/team/sync` | Sync teams |

---

## Watchdog

Endpoints for Watchdog automated insights and anomaly detection.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/watchdog/stories` | Watchdog stories |
| `/api/v1/watchdog/stories/<storyId>` | Specific Watchdog story |
| `/api/v1/watchdog/stories/<storyId>/actions` | Story actions |
| `/api/v1/watchdog/story_facets` | Story facets |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/watchdog/insights/search` | Search Watchdog insights |
| `/api/v2/watchdog/insights/search/<request_id>` | Specific insight search |
| `/api/v2/watchdog/insights/search/<id>?filter[request_type]=<type>` | Filtered insight search |

---

## Workflows

Endpoints for workflow automation.

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/actions-datastores` | Action datastores |
| `/api/v2/actions-datastores/<datastoreId>` | Specific datastore |
| `/api/v2/actions-datastores/<datastoreId>/automation-rules` | Datastore automation rules |
| `/api/v2/actions-datastores/<datastoreId>/automation-rules/<ruleId>` | Specific automation rule |
| `/api/v2/actions-datastores/<datastoreId>/items` | Datastore items |
| `/api/v2/actions-datastores/<datastoreId>/items/bulk` | Bulk datastore items |
| `/api/v2/actions-datastores/import` | Import datastore |
| `/api/v2/suggest_workflow_templates` | Suggest workflow templates |
| `/api/v2/suggest_workflows` | Suggest workflows |
| `/api/v2/workflow_actions` | Workflow actions |
| `/api/v2/workflow_actions/<bundleId>` | Specific action bundle |
| `/api/v2/workflow_generation/data_transformation` | Generate data transformation |
| `/api/v2/workflow_generation/data_transformation/description` | Transformation description |
| `/api/v2/workflow_generation/description` | Workflow description generation |
| `/api/v2/workflow_generation/scaffold_agentic_stream` | Generate agentic workflow |
| `/api/v2/workflow_generation/scaffold_iterative` | Generate iterative workflow |
| `/api/v2/workflow_handles/<handle>` | Workflow by handle |
| `/api/v2/workflow_headless/<parentId>/instances` | Headless workflow instances |
| `/api/v2/workflow_instance_sources/<sourceId>/instances` | Instance source workflows |
| `/api/v2/workflow_templates` | Workflow templates |
| `/api/v2/workflow_templates/<templateId>` | Specific workflow template |
| `/api/v2/workflow_user_tags` | Workflow user tags |
| `/api/v2/workflows/<workflowId>` | Get/update workflow |
| `/api/v2/workflows/<workflowId>/clone` | Clone workflow |
| `/api/v2/workflows/<workflowId>/favorite` | Favorite workflow |
| `/api/v2/workflows/<workflowId>/instances` | Workflow instances |
| `/api/v2/workflows/<workflowId>/instances/<instanceId>` | Specific workflow instance |
| `/api/v2/workflows/<workflowId>/instances/<instanceId>/cancel` | Cancel instance |
| `/api/v2/workflows/<workflowId>/instances/<instanceId>/step/<stepName>` | Instance step |
| `/api/v2/workflows/<workflowId>/instances/<instanceId>/step/<stepName>/iterations` | Step iterations |
| `/api/v2/workflows/<workflowId>/instances/<instanceId>/step/<stepName>/iterations/<loopIndex>` | Specific iteration |
| `/api/v2/workflows/<workflowId>/key_integrations` | Workflow key integrations |
| `/api/v2/workflows/<workflowId>/relationships/owner` | Workflow owner |
| `/api/v2/workflows/<workflowId>/relationships/runAs` | Workflow run-as user |
| `/api/v2/workflows/<workflowId>/relationships/unset_run_as_internal_user_mode` | Unset internal user mode |
| `/api/v2/workflows/<workflowId>/single_action_runs` | Single action runs |
| `/api/v2/workflows/<workflowId>/single_action_runs/<singleActionRunId>` | Specific action run |
| `/api/v2/workflows/workflow_id/<handle>` | Get workflow ID by handle |

---

## Miscellaneous

Other endpoints that don't fit into the categories above.

### API v1

| Endpoint | Description |
|----------|-------------|
| `/api/v1/error-tracking/profile-link` | Error tracking profile links |
| `/api/v1/snapshot` | Graph snapshots |
| `/api/v1/snapshot/image_upload` | Upload snapshot image |
| `/api/v1/trace/query_value_shadow` | Trace query shadow |

### API v2

| Endpoint | Description |
|----------|-------------|
| `/api/v2/:roomType/presence/:roomId` | Real-time presence |
| `/api/v2/apicatalog/endpoints/team/` | API catalog team endpoints |
| `/api/v2/apicatalog/facet/<name>` | API catalog facets |
| `/api/v2/apicatalog/openapi/validate` | Validate OpenAPI spec |
| `/api/v2/change-management/change-request` | Change management requests |
| `/api/v2/change-management/change-request/<changeRequestId>/branch` | Change request branch |
| `/api/v2/change-management/change-request/<changeRequestId>/decisions/<changeRequestDecisionId>` | Change request decisions |
| `/api/v2/change-management/change-request/<id>` | Specific change request |
| `/api/v2/ddsql/user/table` | DDSQL user tables |
| `/api/v2/experimentation-playground/annotation/<annotationId>` | Experiment annotations |
| `/api/v2/experimentation-playground/annotation/<annotationId>/history` | Annotation history |
| `/api/v2/experimentation-playground/finding/<findingId>` | Experiment findings |
| `/api/v2/experimentation-playground/finding/<findingId>/annotation` | Finding annotations |
| `/api/v2/hamr` | HAMR (Host Agent Monitoring) |
| `/api/v2/images/` | Image uploads |
| `/api/v2/llm-obs/v1/<projectId>/datasets` | LLM observability datasets |
| `/api/v2/llm-obs/v1/<projectId>/datasets/<datasetId>/batch_update` | Batch update datasets |
| `/api/v2/llm-obs/v2/<projectId>/datasets/<datasetId>/records/upload?overwrite=false` | Upload dataset records |
| `/api/v2/query-translation` | Query translation |
| `/api/v2/reference-tables/tables/<id>` | Reference tables |
| `/api/v2/reference-tables/tables/<id>/rows` | Reference table rows |

---

## Notes

1. **Path Parameters**: Parameters in angle brackets (e.g., `<dashboard_id>`) are dynamic path parameters that should be replaced with actual values.

2. **Query Parameters**: Some endpoints include query parameters in the path (e.g., `?force=true`). Additional query parameters may be supported but not discovered through static analysis.

3. **HTTP Methods**: Most endpoints support standard REST methods:
   - `GET` - Retrieve resources
   - `POST` - Create resources
   - `PUT/PATCH` - Update resources
   - `DELETE` - Remove resources

4. **Authentication**: All endpoints require authentication via API key or session cookie.

5. **Rate Limiting**: Datadog applies rate limits to API calls. Check the response headers for rate limit information.

6. **Versioning**: API v2 is the current version for most new features. API v1 endpoints may be deprecated in the future.

---

*Document generated from Datadog web application JavaScript analysis*
*Total endpoints: 765 (166 v1 + 599 v2)*

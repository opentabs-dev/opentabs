import {
  Activity,
  AlertCircle,
  BarChart3,
  Bell,
  Calendar,
  Database,
  File,
  FlaskConical,
  Gauge,
  Hash,
  LayoutDashboard,
  Link2,
  MessageSquare,
  Pin,
  Search,
  Server,
  Settings,
  SmilePlus,
  Sparkles,
  Star,
  Target,
  Users,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

interface ToolPermissions {
  [key: string]: boolean;
}

interface CategoryDef<C extends string> {
  id: C | 'all';
  name: string;
  icon: LucideIcon;
}

interface ServiceTab {
  id: string;
  label: string;
  icon: string;
}

// =============================================================================
// Service Tabs
// =============================================================================

const SERVICE_TABS: ServiceTab[] = [
  { id: 'slack', label: 'Slack', icon: 'icons/slack-bw.svg' },
  { id: 'datadog', label: 'Datadog', icon: 'icons/datadog-bw.svg' },
  { id: 'sqlpad', label: 'SQLPad', icon: 'icons/sqlpad-bw.svg' },
  { id: 'logrocket', label: 'LogRocket', icon: 'icons/logrocket-bw.svg' },
  { id: 'retool', label: 'Retool', icon: 'icons/retool-bw.svg' },
  { id: 'snowflake', label: 'Snowflake', icon: 'icons/snowflake-bw.svg' },
];

// =============================================================================
// Tool Definitions
// =============================================================================

const SLACK_TOOLS = [
  {
    id: 'slack_send_message',
    name: 'Send Message',
    description: 'Send a message to a channel or DM',
    category: 'messages',
  },
  {
    id: 'slack_read_messages',
    name: 'Read Messages',
    description: 'Read recent messages from a channel',
    category: 'messages',
  },
  { id: 'slack_read_thread', name: 'Read Thread', description: 'Read all replies in a thread', category: 'messages' },
  {
    id: 'slack_reply_to_thread',
    name: 'Reply to Thread',
    description: 'Reply to a message thread',
    category: 'messages',
  },
  {
    id: 'slack_react_to_message',
    name: 'React to Message',
    description: 'Add an emoji reaction to a message',
    category: 'messages',
  },
  { id: 'slack_update_message', name: 'Update Message', description: 'Edit an existing message', category: 'messages' },
  {
    id: 'slack_delete_message',
    name: 'Delete Message',
    description: 'Delete a message from a channel',
    category: 'messages',
  },
  { id: 'slack_open_dm', name: 'Open DM', description: 'Open a direct message with a user', category: 'conversations' },
  {
    id: 'slack_create_channel',
    name: 'Create Channel',
    description: 'Create a new channel',
    category: 'conversations',
  },
  { id: 'slack_archive_channel', name: 'Archive Channel', description: 'Archive a channel', category: 'conversations' },
  {
    id: 'slack_unarchive_channel',
    name: 'Unarchive Channel',
    description: 'Unarchive a channel',
    category: 'conversations',
  },
  {
    id: 'slack_set_channel_topic',
    name: 'Set Channel Topic',
    description: 'Set the topic of a channel',
    category: 'conversations',
  },
  {
    id: 'slack_set_channel_purpose',
    name: 'Set Channel Purpose',
    description: 'Set the purpose of a channel',
    category: 'conversations',
  },
  {
    id: 'slack_invite_to_channel',
    name: 'Invite to Channel',
    description: 'Invite users to a channel',
    category: 'conversations',
  },
  {
    id: 'slack_kick_from_channel',
    name: 'Kick from Channel',
    description: 'Remove a user from a channel',
    category: 'conversations',
  },
  { id: 'slack_rename_channel', name: 'Rename Channel', description: 'Rename a channel', category: 'conversations' },
  { id: 'slack_join_channel', name: 'Join Channel', description: 'Join a public channel', category: 'conversations' },
  { id: 'slack_leave_channel', name: 'Leave Channel', description: 'Leave a channel', category: 'conversations' },
  {
    id: 'slack_list_channels',
    name: 'List Channels',
    description: 'List channels in the workspace',
    category: 'conversations',
  },
  {
    id: 'slack_get_channel_info',
    name: 'Get Channel Info',
    description: 'Get detailed channel information',
    category: 'channels',
  },
  {
    id: 'slack_list_channel_members',
    name: 'List Channel Members',
    description: 'List members of a channel',
    category: 'channels',
  },
  { id: 'slack_get_user_info', name: 'Get User Info', description: 'Get information about a user', category: 'users' },
  { id: 'slack_list_users', name: 'List Users', description: 'List users in the workspace', category: 'users' },
  { id: 'slack_get_my_profile', name: 'Get My Profile', description: 'Get your own profile', category: 'users' },
  { id: 'slack_search_messages', name: 'Search Messages', description: 'Search for messages', category: 'search' },
  { id: 'slack_search_files', name: 'Search Files', description: 'Search for files', category: 'search' },
  { id: 'slack_search_users', name: 'Search Users', description: 'Search for users', category: 'search' },
  { id: 'slack_get_file_info', name: 'Get File Info', description: 'Get information about a file', category: 'files' },
  { id: 'slack_list_files', name: 'List Files', description: 'List files in the workspace', category: 'files' },
  {
    id: 'slack_remove_reaction',
    name: 'Remove Reaction',
    description: 'Remove an emoji reaction',
    category: 'reactions',
  },
  {
    id: 'slack_get_reactions',
    name: 'Get Reactions',
    description: 'Get all reactions on a message',
    category: 'reactions',
  },
  { id: 'slack_star_message', name: 'Star Message', description: 'Add a star to a message', category: 'stars' },
  { id: 'slack_star_file', name: 'Star File', description: 'Add a star to a file', category: 'stars' },
  {
    id: 'slack_unstar_message',
    name: 'Unstar Message',
    description: 'Remove a star from a message',
    category: 'stars',
  },
  { id: 'slack_unstar_file', name: 'Unstar File', description: 'Remove a star from a file', category: 'stars' },
  { id: 'slack_list_stars', name: 'List Stars', description: 'List all starred items', category: 'stars' },
  { id: 'slack_pin_message', name: 'Pin Message', description: 'Pin a message to a channel', category: 'pins' },
  { id: 'slack_unpin_message', name: 'Unpin Message', description: 'Remove a pinned message', category: 'pins' },
  { id: 'slack_list_pins', name: 'List Pins', description: 'List all pinned items in a channel', category: 'pins' },
] as const;

const DATADOG_TOOLS = [
  { id: 'datadog_search_logs', name: 'Search Logs', description: 'Search Datadog logs with a query', category: 'logs' },
  { id: 'datadog_search_traces', name: 'Search Traces', description: 'Search APM spans with a query', category: 'apm' },
  { id: 'datadog_get_trace', name: 'Get Trace', description: 'Get details of a specific trace by ID', category: 'apm' },
  {
    id: 'datadog_get_trace_logs',
    name: 'Get Trace Logs',
    description: 'Get all logs correlated with a trace',
    category: 'apm',
  },
  {
    id: 'datadog_get_trace_flame_graph',
    name: 'Get Trace Flame Graph',
    description: 'Get trace timeline visualization',
    category: 'apm',
  },
  {
    id: 'datadog_get_span',
    name: 'Get Span',
    description: 'Get detailed information about a specific span',
    category: 'apm',
  },
  {
    id: 'datadog_get_service_summary',
    name: 'Get Service Summary',
    description: 'Get summary stats for a service',
    category: 'apm',
  },
  {
    id: 'datadog_list_apm_services',
    name: 'List APM Services',
    description: 'List all services sending traces to Datadog',
    category: 'apm',
  },
  {
    id: 'datadog_analyze_trace_errors',
    name: 'Analyze Trace Errors',
    description: 'Analyze errors in a trace with root cause identification',
    category: 'apm',
  },
  {
    id: 'datadog_get_slow_spans',
    name: 'Get Slow Spans',
    description: 'Get the slowest spans in a trace for performance debugging',
    category: 'apm',
  },
  {
    id: 'datadog_get_trace_critical_path',
    name: 'Get Trace Critical Path',
    description: 'Get the critical path of a trace',
    category: 'apm',
  },
  {
    id: 'datadog_search_similar_traces',
    name: 'Search Similar Traces',
    description: 'Find traces with similar errors, endpoints, or patterns',
    category: 'apm',
  },
  {
    id: 'datadog_get_customer_traces',
    name: 'Get Customer Traces',
    description: 'Find all traces for a specific customer account or user',
    category: 'apm',
  },
  {
    id: 'datadog_get_database_query_analysis',
    name: 'Get DB Query Analysis',
    description: 'Analyze database queries for N+1 patterns and slow queries',
    category: 'apm',
  },
  {
    id: 'datadog_compare_traces',
    name: 'Compare Traces',
    description: 'Compare two traces side-by-side for performance debugging',
    category: 'apm',
  },
  {
    id: 'datadog_batch_compare_traces',
    name: 'Batch Compare Traces',
    description: 'Analyze and compare multiple traces at once',
    category: 'apm',
  },
  {
    id: 'datadog_get_grpc_method_stats',
    name: 'Get gRPC Method Stats',
    description: 'Get p50/p95/p99 latency statistics for gRPC methods',
    category: 'apm',
  },
  {
    id: 'datadog_search_rum_sessions',
    name: 'Search RUM Sessions',
    description: 'Search Real User Monitoring sessions',
    category: 'rum',
  },
  {
    id: 'datadog_search_rum_errors',
    name: 'Search RUM Errors',
    description: 'Search frontend errors captured by RUM',
    category: 'rum',
  },
  {
    id: 'datadog_get_session_replay',
    name: 'Get Session Replay',
    description: 'Get Session Replay URL for a RUM session',
    category: 'rum',
  },
  {
    id: 'datadog_list_error_tracking_issues',
    name: 'List Error Issues',
    description: 'List grouped error tracking issues',
    category: 'errors',
  },
  {
    id: 'datadog_get_error_tracking_issue',
    name: 'Get Error Issue',
    description: 'Get details of a specific error issue',
    category: 'errors',
  },
  {
    id: 'datadog_list_deployments',
    name: 'List Deployments',
    description: 'List deployments for a service',
    category: 'deployments',
  },
  {
    id: 'datadog_get_deployment',
    name: 'Get Deployment',
    description: 'Get deployment details by version',
    category: 'deployments',
  },
  {
    id: 'datadog_query_metrics',
    name: 'Query Metrics',
    description: 'Query time series metrics data',
    category: 'metrics',
  },
  { id: 'datadog_list_metrics', name: 'List Metrics', description: 'List available metric names', category: 'metrics' },
  {
    id: 'datadog_get_metric_metadata',
    name: 'Get Metric Metadata',
    description: 'Get metadata for a specific metric',
    category: 'metrics',
  },
  {
    id: 'datadog_list_monitors',
    name: 'List Monitors',
    description: 'List all monitors with optional filtering',
    category: 'monitors',
  },
  {
    id: 'datadog_get_monitor',
    name: 'Get Monitor',
    description: 'Get details of a specific monitor',
    category: 'monitors',
  },
  {
    id: 'datadog_search_monitors',
    name: 'Search Monitors',
    description: 'Search monitors by name or tag',
    category: 'monitors',
  },
  {
    id: 'datadog_get_monitor_status',
    name: 'Get Monitor Status',
    description: 'Get current status of monitors',
    category: 'monitors',
  },
  {
    id: 'datadog_delete_monitor',
    name: 'Delete Monitor',
    description: 'Permanently delete a monitor',
    category: 'monitors',
  },
  {
    id: 'datadog_mute_monitor',
    name: 'Mute Monitor',
    description: 'Mute a monitor to suppress alerts temporarily',
    category: 'monitors',
  },
  {
    id: 'datadog_unmute_monitor',
    name: 'Unmute Monitor',
    description: 'Unmute a previously muted monitor',
    category: 'monitors',
  },
  {
    id: 'datadog_list_dashboards',
    name: 'List Dashboards',
    description: 'List all dashboards',
    category: 'dashboards',
  },
  {
    id: 'datadog_get_dashboard',
    name: 'Get Dashboard',
    description: 'Get dashboard definition by ID',
    category: 'dashboards',
  },
  {
    id: 'datadog_search_dashboards',
    name: 'Search Dashboards',
    description: 'Search dashboards by name',
    category: 'dashboards',
  },
  { id: 'datadog_list_slos', name: 'List SLOs', description: 'List Service Level Objectives', category: 'slos' },
  { id: 'datadog_get_slo', name: 'Get SLO', description: 'Get details of a specific SLO', category: 'slos' },
  {
    id: 'datadog_get_slo_history',
    name: 'Get SLO History',
    description: 'Get historical SLI data and error budget',
    category: 'slos',
  },
  { id: 'datadog_search_slos', name: 'Search SLOs', description: 'Search SLOs by name or tags', category: 'slos' },
  {
    id: 'datadog_get_error_budget_status',
    name: 'Get Error Budget Status',
    description: 'Check error budget health across all SLOs',
    category: 'slos',
  },
  {
    id: 'datadog_list_services',
    name: 'List Services',
    description: 'List services from the Service Catalog',
    category: 'services',
  },
  {
    id: 'datadog_get_service_definition',
    name: 'Get Service Definition',
    description: 'Get service details including ownership and contacts',
    category: 'services',
  },
  {
    id: 'datadog_list_teams',
    name: 'List Teams',
    description: 'List teams in the Datadog organization',
    category: 'teams',
  },
  { id: 'datadog_get_team', name: 'Get Team', description: 'Get details of a specific team', category: 'teams' },
  { id: 'datadog_list_hosts', name: 'List Hosts', description: 'List hosts in the infrastructure', category: 'hosts' },
  {
    id: 'datadog_get_host_info',
    name: 'Get Host Info',
    description: 'Get detailed information about a host',
    category: 'hosts',
  },
  {
    id: 'datadog_get_hosts_by_service',
    name: 'Get Hosts by Service',
    description: 'Find all hosts running a specific service',
    category: 'hosts',
  },
  {
    id: 'datadog_mute_host',
    name: 'Mute Host',
    description: 'Mute or unmute a host to suppress alerts',
    category: 'hosts',
  },
  {
    id: 'datadog_list_downtimes',
    name: 'List Downtimes',
    description: 'List scheduled maintenance downtimes',
    category: 'downtimes',
  },
  {
    id: 'datadog_get_downtime',
    name: 'Get Downtime',
    description: 'Get details of a specific downtime',
    category: 'downtimes',
  },
  {
    id: 'datadog_create_downtime',
    name: 'Create Downtime',
    description: 'Create a scheduled downtime to mute monitors',
    category: 'downtimes',
  },
  {
    id: 'datadog_cancel_downtime',
    name: 'Cancel Downtime',
    description: 'Cancel an existing downtime',
    category: 'downtimes',
  },
  {
    id: 'datadog_get_watchdog_stories',
    name: 'Get Watchdog Stories',
    description: 'Get ML-detected anomalies and alerts from Watchdog',
    category: 'watchdog',
  },
  {
    id: 'datadog_get_watchdog_insights',
    name: 'Get Watchdog Insights',
    description: 'Get anomaly detection insights from Watchdog',
    category: 'watchdog',
  },
  {
    id: 'datadog_list_synthetics_tests',
    name: 'List Synthetics Tests',
    description: 'List Synthetic monitoring tests',
    category: 'synthetics',
  },
  {
    id: 'datadog_get_synthetics_test',
    name: 'Get Synthetics Test',
    description: 'Get details of a specific Synthetic test',
    category: 'synthetics',
  },
  {
    id: 'datadog_get_synthetics_test_results',
    name: 'Get Synthetics Results',
    description: 'Get recent results for a Synthetic test',
    category: 'synthetics',
  },
  {
    id: 'datadog_list_incidents',
    name: 'List Incidents',
    description: 'List incidents from Incident Management',
    category: 'incidents',
  },
  {
    id: 'datadog_get_incident',
    name: 'Get Incident',
    description: 'Get details of a specific incident',
    category: 'incidents',
  },
  {
    id: 'datadog_search_incidents',
    name: 'Search Incidents',
    description: 'Search incidents by query',
    category: 'incidents',
  },
  {
    id: 'datadog_list_incident_services',
    name: 'List Incident Services',
    description: 'List services configured for incidents',
    category: 'incidents',
  },
  {
    id: 'datadog_list_notebooks',
    name: 'List Notebooks',
    description: 'List Datadog notebooks',
    category: 'notebooks',
  },
  {
    id: 'datadog_get_notebook',
    name: 'Get Notebook',
    description: 'Get content of a specific notebook',
    category: 'notebooks',
  },
  {
    id: 'datadog_search_audit_logs',
    name: 'Search Audit Logs',
    description: 'Search Datadog audit logs',
    category: 'audit',
  },
  {
    id: 'datadog_list_audit_event_types',
    name: 'List Audit Event Types',
    description: 'List available audit log event types',
    category: 'audit',
  },
  {
    id: 'datadog_get_usage_summary',
    name: 'Get Usage Summary',
    description: 'Get usage summary statistics',
    category: 'usage',
  },
  {
    id: 'datadog_get_logs_usage',
    name: 'Get Logs Usage',
    description: 'Get hourly log ingestion usage',
    category: 'usage',
  },
  {
    id: 'datadog_get_usage_attribution',
    name: 'Get Usage Attribution',
    description: 'Get usage breakdown by tag',
    category: 'usage',
  },
] as const;

const SQLPAD_TOOLS = [
  {
    id: 'sqlpad_list_connections',
    name: 'List Connections',
    description: 'List available database connections',
    category: 'connections',
  },
  {
    id: 'sqlpad_get_connection',
    name: 'Get Connection',
    description: 'Get details of a specific database connection',
    category: 'connections',
  },
  {
    id: 'sqlpad_run_query',
    name: 'Run Query',
    description: 'Execute a SQL query and return results',
    category: 'queries',
  },
  {
    id: 'sqlpad_list_saved_queries',
    name: 'List Saved Queries',
    description: 'List saved SQL queries',
    category: 'queries',
  },
  {
    id: 'sqlpad_get_saved_query',
    name: 'Get Saved Query',
    description: 'Get a specific saved query with full SQL text',
    category: 'queries',
  },
  {
    id: 'sqlpad_get_schema',
    name: 'Get Schema',
    description: 'Get schema information including tables and columns',
    category: 'schema',
  },
  { id: 'sqlpad_list_tables', name: 'List Tables', description: 'List all tables in a database', category: 'schema' },
] as const;

const LOGROCKET_TOOLS = [
  {
    id: 'logrocket_list_orgs',
    name: 'List Orgs',
    description: 'List all LogRocket organizations',
    category: 'organization',
  },
  {
    id: 'logrocket_get_org',
    name: 'Get Org',
    description: 'Get org details including plan, session limits, and app list',
    category: 'organization',
  },
  {
    id: 'logrocket_list_apps',
    name: 'List Apps',
    description: 'List applications in an organization',
    category: 'organization',
  },
  {
    id: 'logrocket_get_app',
    name: 'Get App',
    description: 'Get app config: SDK settings, recording options, integrations',
    category: 'organization',
  },
  {
    id: 'logrocket_list_members',
    name: 'List Members',
    description: 'List org members with roles, emails, and last login',
    category: 'organization',
  },
  {
    id: 'logrocket_get_session_usage',
    name: 'Get Session Usage',
    description: 'Get session volume histogram for incident correlation',
    category: 'organization',
  },
  {
    id: 'logrocket_search_sessions',
    name: 'Search Sessions',
    description: 'Search sessions by user, URL, error, browser, or location',
    category: 'sessions',
  },
  {
    id: 'logrocket_get_session_url',
    name: 'Get Session URL',
    description: 'Get session replay URL',
    category: 'sessions',
  },
  { id: 'logrocket_list_issues', name: 'List Issues', description: 'List grouped error issues', category: 'issues' },
  {
    id: 'logrocket_get_issue',
    name: 'Get Issue',
    description: 'Get issue details and stack trace',
    category: 'issues',
  },
  {
    id: 'logrocket_get_issue_analysis',
    name: 'Get Issue Analysis',
    description: 'Get AI-powered root cause analysis for an issue',
    category: 'issues',
  },
  {
    id: 'logrocket_get_issue_analysis_by_id',
    name: 'Get Analysis by ID',
    description: 'Get issue analysis by analysis UUID',
    category: 'issues',
  },
  {
    id: 'logrocket_batch_issue_analysis',
    name: 'Batch Issue Analysis',
    description: 'Analyze multiple issues in parallel',
    category: 'issues',
  },
  {
    id: 'logrocket_list_issue_filters',
    name: 'List Issue Filters',
    description: 'List team-saved issue views and search criteria',
    category: 'issues',
  },
  {
    id: 'logrocket_list_galileo_chats',
    name: 'List Galileo Chats',
    description: 'List AI analysis conversations',
    category: 'galileo',
  },
  {
    id: 'logrocket_get_galileo_chat',
    name: 'Get Galileo Chat',
    description: 'Get AI analysis chat details',
    category: 'galileo',
  },
  {
    id: 'logrocket_create_galileo_stream',
    name: 'Ask Galileo AI',
    description: 'Ask a freeform question about application data',
    category: 'galileo',
  },
  {
    id: 'logrocket_get_galileo_stream',
    name: 'Get Galileo Stream',
    description: 'Get AI analysis stream results',
    category: 'galileo',
  },
  { id: 'logrocket_list_charts', name: 'List Charts', description: 'List custom metric charts', category: 'charts' },
  {
    id: 'logrocket_get_chart',
    name: 'Get Chart',
    description: 'Get chart config: type, filters, aggregations, and alerts',
    category: 'charts',
  },
  {
    id: 'logrocket_list_dashboards',
    name: 'List Dashboards',
    description: 'List dashboards with their chart listings and owners',
    category: 'charts',
  },
  {
    id: 'logrocket_get_dashboard',
    name: 'Get Dashboard',
    description: 'Get dashboard layout with chart names, types, and positions',
    category: 'charts',
  },
  {
    id: 'logrocket_list_segments',
    name: 'List Segments',
    description: 'List team-defined user cohorts',
    category: 'segments',
  },
  {
    id: 'logrocket_get_segment',
    name: 'Get Segment',
    description: 'Get segment filter criteria',
    category: 'segments',
  },
  {
    id: 'logrocket_list_definitions',
    name: 'List Definitions',
    description: 'List tracked page definitions and auto-detected error states',
    category: 'segments',
  },
  {
    id: 'logrocket_list_integrations',
    name: 'List Integrations',
    description: 'List connected services with status',
    category: 'integrations',
  },
  {
    id: 'logrocket_list_surveys',
    name: 'List Surveys',
    description: 'List in-app feedback surveys and their configurations',
    category: 'integrations',
  },
  {
    id: 'logrocket_list_release_recaps',
    name: 'List Release Recaps',
    description: 'List deployment impact summaries',
    category: 'integrations',
  },
  {
    id: 'logrocket_list_alerts',
    name: 'List Alerts',
    description: 'List alert rules: thresholds, notification targets, enabled status',
    category: 'integrations',
  },
] as const;

const RETOOL_TOOLS = [
  {
    id: 'retool_get_current_user',
    name: 'Get Current User',
    description: 'Get your profile, org info, group memberships, and feature flags',
    category: 'organization',
  },
  {
    id: 'retool_list_groups',
    name: 'List Groups',
    description: 'List all permission groups with their access levels',
    category: 'organization',
  },
  {
    id: 'retool_list_environments',
    name: 'List Environments',
    description: 'List deployment environments (production, staging)',
    category: 'organization',
  },
  {
    id: 'retool_list_experiments',
    name: 'List Experiments',
    description: 'List feature flags and their enabled/disabled status',
    category: 'organization',
  },
  {
    id: 'retool_search_users',
    name: 'Search Users',
    description: 'Find users by name or email across the organization',
    category: 'organization',
  },
  {
    id: 'retool_list_apps',
    name: 'List Apps',
    description: 'List all apps with names, UUIDs, folders, and edit info',
    category: 'apps',
  },
  {
    id: 'retool_list_page_names',
    name: 'List Page Names',
    description: 'Lightweight list of all page names and UUIDs',
    category: 'apps',
  },
  {
    id: 'retool_get_app',
    name: 'Get App',
    description: 'Get full app details: components, queries, and config',
    category: 'apps',
  },
  { id: 'retool_lookup_app', name: 'Lookup App', description: 'Find an app by its URL path or name', category: 'apps' },
  {
    id: 'retool_get_app_docs',
    name: 'Get App Docs',
    description: 'Get documentation and usage notes for an app',
    category: 'apps',
  },
  {
    id: 'retool_list_app_tags',
    name: 'List App Tags',
    description: 'List published version tags (releases) for an app',
    category: 'apps',
  },
  {
    id: 'retool_list_page_saves',
    name: 'List Page Saves',
    description: 'View edit history: who changed an app and when',
    category: 'apps',
  },
  {
    id: 'retool_list_workflows',
    name: 'List Workflows',
    description: 'List all workflows with names, triggers, and status',
    category: 'workflows',
  },
  {
    id: 'retool_get_workflow',
    name: 'Get Workflow',
    description: 'Get workflow blocks, configuration, and trigger settings',
    category: 'workflows',
  },
  {
    id: 'retool_list_workflow_runs',
    name: 'List Workflow Runs',
    description: 'List recent execution runs with status and timing',
    category: 'workflows',
  },
  {
    id: 'retool_get_workflow_run',
    name: 'Get Workflow Run',
    description: 'Get detailed results and block outputs for a run',
    category: 'workflows',
  },
  {
    id: 'retool_get_workflow_run_log',
    name: 'Get Workflow Run Log',
    description: 'Get block-by-block execution logs and errors',
    category: 'workflows',
  },
  {
    id: 'retool_list_workflow_triggers',
    name: 'List Workflow Triggers',
    description: 'List webhooks, schedules, and event triggers',
    category: 'workflows',
  },
  {
    id: 'retool_get_workflow_run_count',
    name: 'Get Workflow Run Count',
    description: 'Get total run counts per workflow for health checks',
    category: 'workflows',
  },
  {
    id: 'retool_get_workflow_releases',
    name: 'Get Workflow Releases',
    description: 'View deployment history and release versions',
    category: 'workflows',
  },
  {
    id: 'retool_get_workflows_config',
    name: 'Get Workflows Config',
    description: 'Get runtime settings: Retool version, Python, Temporal',
    category: 'workflows',
  },
  {
    id: 'retool_get_workflow_usage',
    name: 'Get Workflow Usage',
    description: 'Get billable run counts and usage statistics',
    category: 'workflows',
  },
  {
    id: 'retool_list_resources',
    name: 'List Resources',
    description: 'List all data sources: databases, APIs, and GraphQL endpoints',
    category: 'resources',
  },
  {
    id: 'retool_get_resource_usage',
    name: 'Get Resource Usage',
    description: 'See which apps and workflows use each resource',
    category: 'resources',
  },
  {
    id: 'retool_list_queries',
    name: 'List Queries',
    description: 'List saved queries with names and resource associations',
    category: 'queries',
  },
  {
    id: 'retool_get_query',
    name: 'Get Query',
    description: 'Get the full SQL/code and configuration for a query',
    category: 'queries',
  },
  {
    id: 'retool_get_query_usages',
    name: 'Get Query Usages',
    description: 'Find which apps and workflows reference a query',
    category: 'queries',
  },
  {
    id: 'retool_list_branches',
    name: 'List Branches',
    description: 'List source control branches with owners and commit counts',
    category: 'scm',
  },
  {
    id: 'retool_list_commits',
    name: 'List Commits',
    description: 'List commits on a specific branch',
    category: 'scm',
  },
  {
    id: 'retool_check_observability',
    name: 'Check Observability',
    description: 'Check if error tracking and performance monitoring are enabled',
    category: 'scm',
  },
  {
    id: 'retool_get_app_errors',
    name: 'Get App Errors',
    description: 'Get application errors tracked by observability',
    category: 'scm',
  },
  {
    id: 'retool_list_user_tasks',
    name: 'List User Tasks',
    description: 'List human-in-the-loop tasks pending approval',
    category: 'scm',
  },
  {
    id: 'retool_list_task_definitions',
    name: 'List Task Definitions',
    description: 'List all HITL task types configured in workflows',
    category: 'scm',
  },
  {
    id: 'retool_list_vectors',
    name: 'List Vectors',
    description: 'List RAG knowledge bases and vector embeddings',
    category: 'scm',
  },
  {
    id: 'retool_list_grids',
    name: 'List Grids',
    description: 'List Retool Database tables and their metadata',
    category: 'scm',
  },
] as const;

const SNOWFLAKE_TOOLS = [
  {
    id: 'snowflake_run_query',
    name: 'Run Query',
    description: 'Execute SQL and return rows inline or write large results (1M+) to a local JSONL file',
    category: 'queries',
  },
  {
    id: 'snowflake_get_query',
    name: 'Get Query',
    description: 'Re-fetch results of a previously executed query by ID',
    category: 'queries',
  },
  {
    id: 'snowflake_monitor_queries',
    name: 'Monitor Queries',
    description: 'List active queries with state, SQL, user, and duration',
    category: 'queries',
  },
  {
    id: 'snowflake_browse_data',
    name: 'Browse Databases',
    description: 'List all databases accessible to the current role',
    category: 'data',
  },
  {
    id: 'snowflake_search_data',
    name: 'Search Databases',
    description: 'Search databases by name pattern',
    category: 'data',
  },
  {
    id: 'snowflake_get_object_details',
    name: 'Describe Table',
    description: 'Get column names, types, and nullability for a table or view',
    category: 'data',
  },
  {
    id: 'snowflake_list_shared_objects',
    name: 'List Shares',
    description: 'List data shares in the account',
    category: 'data',
  },
  {
    id: 'snowflake_list_worksheets',
    name: 'List Worksheets',
    description: 'List saved SQL worksheets with names and metadata',
    category: 'worksheets',
  },
  { id: 'snowflake_list_folders', name: 'List Folders', description: 'List worksheet folders', category: 'worksheets' },
  {
    id: 'snowflake_list_files',
    name: 'List Worksheet Drafts',
    description: 'Get worksheet drafts with full SQL content and execution context',
    category: 'worksheets',
  },
  {
    id: 'snowflake_get_session',
    name: 'Get Session',
    description: 'Get current user, role, warehouse, and organization info',
    category: 'account',
  },
  {
    id: 'snowflake_diagnose',
    name: 'Diagnose',
    description: 'Check adapter connectivity and authenticated user',
    category: 'account',
  },
] as const;

// =============================================================================
// Derived Types
// =============================================================================

type SlackTool = (typeof SLACK_TOOLS)[number];
type DatadogTool = (typeof DATADOG_TOOLS)[number];
type SqlpadTool = (typeof SQLPAD_TOOLS)[number];
type LogrocketTool = (typeof LOGROCKET_TOOLS)[number];
type RetoolTool = (typeof RETOOL_TOOLS)[number];
type SnowflakeTool = (typeof SNOWFLAKE_TOOLS)[number];
type Tool = SlackTool | DatadogTool | SqlpadTool | LogrocketTool | RetoolTool | SnowflakeTool;

type SlackCategoryId = SlackTool['category'];
type DatadogCategoryId = DatadogTool['category'];
type SqlpadCategoryId = SqlpadTool['category'];
type LogrocketCategoryId = LogrocketTool['category'];
type RetoolCategoryId = RetoolTool['category'];
type SnowflakeCategoryId = SnowflakeTool['category'];

// =============================================================================
// Category Definitions
// =============================================================================

const SLACK_CATEGORIES: CategoryDef<SlackCategoryId>[] = [
  { id: 'all', name: 'All', icon: Settings },
  { id: 'messages', name: 'Messages', icon: MessageSquare },
  { id: 'conversations', name: 'Conversations', icon: Hash },
  { id: 'channels', name: 'Channels', icon: Hash },
  { id: 'users', name: 'Users', icon: Users },
  { id: 'search', name: 'Search', icon: Search },
  { id: 'files', name: 'Files', icon: File },
  { id: 'reactions', name: 'Reactions', icon: SmilePlus },
  { id: 'stars', name: 'Stars', icon: Star },
  { id: 'pins', name: 'Pins', icon: Pin },
];

const DATADOG_CATEGORIES: CategoryDef<DatadogCategoryId>[] = [
  { id: 'all', name: 'All', icon: Settings },
  { id: 'logs', name: 'Logs', icon: BarChart3 },
  { id: 'apm', name: 'APM / Traces', icon: Activity },
  { id: 'rum', name: 'RUM', icon: Users },
  { id: 'errors', name: 'Errors', icon: AlertCircle },
  { id: 'deployments', name: 'Deployments', icon: Zap },
  { id: 'metrics', name: 'Metrics', icon: Gauge },
  { id: 'monitors', name: 'Monitors', icon: Bell },
  { id: 'dashboards', name: 'Dashboards', icon: LayoutDashboard },
  { id: 'slos', name: 'SLOs', icon: Target },
  { id: 'services', name: 'Services', icon: Server },
  { id: 'teams', name: 'Teams', icon: Users },
  { id: 'hosts', name: 'Hosts', icon: Server },
  { id: 'downtimes', name: 'Downtimes', icon: Calendar },
  { id: 'watchdog', name: 'Watchdog', icon: Zap },
  { id: 'synthetics', name: 'Synthetics', icon: FlaskConical },
  { id: 'incidents', name: 'Incidents', icon: AlertCircle },
  { id: 'notebooks', name: 'Notebooks', icon: File },
  { id: 'audit', name: 'Audit', icon: Search },
  { id: 'usage', name: 'Usage', icon: BarChart3 },
];

const SQLPAD_CATEGORIES: CategoryDef<SqlpadCategoryId>[] = [
  { id: 'all', name: 'All', icon: Settings },
  { id: 'connections', name: 'Connections', icon: Link2 },
  { id: 'queries', name: 'Queries', icon: Search },
  { id: 'schema', name: 'Schema', icon: Database },
];

const LOGROCKET_CATEGORIES: CategoryDef<LogrocketCategoryId>[] = [
  { id: 'all', name: 'All', icon: Settings },
  { id: 'organization', name: 'Organization', icon: Server },
  { id: 'sessions', name: 'Sessions', icon: Activity },
  { id: 'issues', name: 'Issues', icon: AlertCircle },
  { id: 'galileo', name: 'Galileo AI', icon: Sparkles },
  { id: 'charts', name: 'Charts', icon: BarChart3 },
  { id: 'segments', name: 'Segments', icon: Users },
  { id: 'integrations', name: 'Integrations', icon: Link2 },
];

const RETOOL_CATEGORIES: CategoryDef<RetoolCategoryId>[] = [
  { id: 'all', name: 'All', icon: Settings },
  { id: 'organization', name: 'Organization', icon: Server },
  { id: 'apps', name: 'Apps', icon: LayoutDashboard },
  { id: 'workflows', name: 'Workflows', icon: Zap },
  { id: 'resources', name: 'Resources', icon: Database },
  { id: 'queries', name: 'Queries', icon: Search },
  { id: 'scm', name: 'SCM & Misc', icon: File },
];

const SNOWFLAKE_CATEGORIES: CategoryDef<SnowflakeCategoryId>[] = [
  { id: 'all', name: 'All', icon: Settings },
  { id: 'queries', name: 'Queries', icon: Search },
  { id: 'data', name: 'Data Catalog', icon: Database },
  { id: 'worksheets', name: 'Worksheets', icon: File },
  { id: 'account', name: 'Account', icon: Users },
];

/** Flat array of all tools across all services */
const ALL_TOOLS: readonly Tool[] = [
  ...SLACK_TOOLS,
  ...DATADOG_TOOLS,
  ...SQLPAD_TOOLS,
  ...LOGROCKET_TOOLS,
  ...RETOOL_TOOLS,
  ...SNOWFLAKE_TOOLS,
];

// =============================================================================
// Exports
// =============================================================================

export {
  ALL_TOOLS,
  DATADOG_CATEGORIES,
  DATADOG_TOOLS,
  LOGROCKET_CATEGORIES,
  LOGROCKET_TOOLS,
  RETOOL_CATEGORIES,
  RETOOL_TOOLS,
  SERVICE_TABS,
  SLACK_CATEGORIES,
  SLACK_TOOLS,
  SNOWFLAKE_CATEGORIES,
  SNOWFLAKE_TOOLS,
  SQLPAD_CATEGORIES,
  SQLPAD_TOOLS,
};

export type {
  CategoryDef,
  DatadogCategoryId,
  DatadogTool,
  LogrocketCategoryId,
  LogrocketTool,
  RetoolCategoryId,
  RetoolTool,
  SlackCategoryId,
  SlackTool,
  SnowflakeCategoryId,
  SnowflakeTool,
  SqlpadCategoryId,
  SqlpadTool,
  Tool,
  ToolPermissions,
};

import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './datadog-api.js';

// Monitors
import { listMonitors } from './tools/list-monitors.js';
import { getMonitor } from './tools/get-monitor.js';
import { searchMonitors } from './tools/search-monitors.js';
import { muteMonitor } from './tools/mute-monitor.js';
import { unmuteMonitor } from './tools/unmute-monitor.js';
import { deleteMonitor } from './tools/delete-monitor.js';
import { listMonitorTags } from './tools/list-monitor-tags.js';
import { getMonitorGroups } from './tools/get-monitor-groups.js';
import { getMonitorStateHistory } from './tools/get-monitor-state-history.js';
import { createMonitor } from './tools/create-monitor.js';
import { updateMonitor } from './tools/update-monitor.js';
import { listMonitorDowntimes } from './tools/list-monitor-downtimes.js';
import { cloneMonitor } from './tools/clone-monitor.js';

// Dashboards
import { listDashboards } from './tools/list-dashboards.js';
import { getDashboard } from './tools/get-dashboard.js';
import { searchDashboards } from './tools/search-dashboards.js';
import { searchDashboardsAdvanced } from './tools/search-dashboards-advanced.js';
import { deleteDashboard } from './tools/delete-dashboard.js';
import { cloneDashboard } from './tools/clone-dashboard.js';

// SLOs
import { listSlos } from './tools/list-slos.js';
import { getSlo } from './tools/get-slo.js';
import { getSloHistory } from './tools/get-slo-history.js';
import { searchSlos } from './tools/search-slos.js';
import { listSloCorrections } from './tools/list-slo-corrections.js';

// Logs
import { searchLogs } from './tools/search-logs.js';

// APM
import { searchSpans } from './tools/search-spans.js';
import { getTrace } from './tools/get-trace.js';
import { aggregateSpans } from './tools/aggregate-spans.js';
import { getServiceDependencies } from './tools/get-service-dependencies.js';

// Metrics
import { queryMetrics } from './tools/query-metrics.js';
import { listMetrics } from './tools/list-metrics.js';
import { getMetricMetadata } from './tools/get-metric-metadata.js';
import { queryTimeseries } from './tools/query-timeseries.js';
import { listMetricTags } from './tools/list-metric-tags.js';

// Infrastructure
import { listHosts } from './tools/list-hosts.js';
import { muteHost } from './tools/mute-host.js';
import { unmuteHost } from './tools/unmute-host.js';
import { getHostTotals } from './tools/get-host-totals.js';
import { listHostTags } from './tools/list-host-tags.js';
import { getHostInfo } from './tools/get-host-info.js';

// Services
import { listServices } from './tools/list-services.js';
import { getServiceDefinition } from './tools/get-service-definition.js';
import { searchServices } from './tools/search-services.js';

// Notebooks
import { listNotebooks } from './tools/list-notebooks.js';
import { getNotebook } from './tools/get-notebook.js';
import { searchNotebooks } from './tools/search-notebooks.js';
import { createNotebook } from './tools/create-notebook.js';
import { updateNotebook } from './tools/update-notebook.js';
import { deleteNotebook } from './tools/delete-notebook.js';

// Synthetics
import { listSyntheticsTests } from './tools/list-synthetics-tests.js';
import { getSyntheticsTest } from './tools/get-synthetics-test.js';
import { getSyntheticsResults } from './tools/get-synthetics-results.js';
import { triggerSyntheticsTest } from './tools/trigger-synthetics-test.js';
import { pauseSyntheticsTest } from './tools/pause-synthetics-test.js';

// Downtimes
import { listDowntimes } from './tools/list-downtimes.js';
import { getDowntime } from './tools/get-downtime.js';
import { cancelDowntime } from './tools/cancel-downtime.js';
import { createDowntime } from './tools/create-downtime.js';

// Users
import { getCurrentUser } from './tools/get-current-user.js';
import { listUsers } from './tools/list-users.js';
import { getUser } from './tools/get-user.js';

// RUM
import { searchRumEvents } from './tools/search-rum-events.js';
import { aggregateRumEvents } from './tools/aggregate-rum-events.js';

// Incidents
import { listIncidents } from './tools/list-incidents.js';
import { getIncident } from './tools/get-incident.js';

// Teams
import { listTeams } from './tools/list-teams.js';

// Security
import { searchSecuritySignals } from './tools/search-security-signals.js';

// Admin
import { getPermissions } from './tools/get-permissions.js';
import { getOrgConfig } from './tools/get-org-config.js';
import { listApiKeys } from './tools/list-api-keys.js';
import { getUsageSummary } from './tools/get-usage-summary.js';

class DatadogPlugin extends OpenTabsPlugin {
  readonly name = 'datadog';
  readonly description =
    'OpenTabs plugin for Datadog — monitors, dashboards, logs, APM, metrics, SLOs, incidents, synthetics, and more';
  override readonly displayName = 'Datadog';
  readonly urlPatterns = ['*://*.datadoghq.com/*'];
  override readonly homepage = 'https://app.datadoghq.com';

  readonly tools: ToolDefinition[] = [
    // Monitors (12)
    listMonitors,
    getMonitor,
    searchMonitors,
    muteMonitor,
    unmuteMonitor,
    deleteMonitor,
    listMonitorTags,
    getMonitorGroups,
    getMonitorStateHistory,
    createMonitor,
    updateMonitor,
    listMonitorDowntimes,
    cloneMonitor,
    // Dashboards (7)
    listDashboards,
    getDashboard,
    searchDashboards,
    searchDashboardsAdvanced,
    deleteDashboard,
    cloneDashboard,
    // SLOs (5)
    listSlos,
    getSlo,
    getSloHistory,
    searchSlos,
    listSloCorrections,
    // Logs (1)
    searchLogs,
    // APM (4)
    searchSpans,
    getTrace,
    aggregateSpans,
    getServiceDependencies,
    // Metrics (5)
    queryMetrics,
    listMetrics,
    getMetricMetadata,
    queryTimeseries,
    listMetricTags,
    // Infrastructure (6)
    listHosts,
    muteHost,
    unmuteHost,
    getHostTotals,
    listHostTags,
    getHostInfo,
    // Services (3)
    listServices,
    getServiceDefinition,
    searchServices,
    // Notebooks (6)
    listNotebooks,
    getNotebook,
    searchNotebooks,
    createNotebook,
    updateNotebook,
    deleteNotebook,
    // Synthetics (5)
    listSyntheticsTests,
    getSyntheticsTest,
    getSyntheticsResults,
    triggerSyntheticsTest,
    pauseSyntheticsTest,
    // Downtimes (4)
    listDowntimes,
    getDowntime,
    cancelDowntime,
    createDowntime,
    // Users (3)
    getCurrentUser,
    listUsers,
    getUser,
    // RUM (2)
    searchRumEvents,
    aggregateRumEvents,
    // Incidents (2)
    listIncidents,
    getIncident,
    // Teams (1)
    listTeams,
    // Security (1)
    searchSecuritySignals,
    // Admin (4)
    getPermissions,
    getOrgConfig,
    listApiKeys,
    getUsageSummary,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new DatadogPlugin();

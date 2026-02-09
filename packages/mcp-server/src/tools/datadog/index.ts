import { registerDatadogApmTools } from './apm.js';
import { registerDatadogAuditTools } from './audit.js';
import { registerDatadogDashboardsTools } from './dashboards.js';
import { registerDatadogDeploymentsTools } from './deployments.js';
import { registerDatadogDowntimesTools } from './downtimes.js';
import { registerDatadogErrorTrackingTools } from './error-tracking.js';
import { registerDatadogEventsTools } from './events.js';
import { registerDatadogHostsTools } from './hosts.js';
import { registerDatadogIncidentsTools } from './incidents.js';
import { registerDatadogLogsTools } from './logs.js';
import { registerDatadogMetricsTools } from './metrics.js';
import { registerDatadogMonitorsTools } from './monitors.js';
import { registerDatadogNotebooksTools } from './notebooks.js';
import { registerDatadogRumTools } from './rum.js';
import { registerDatadogServicesTools } from './services.js';
import { registerDatadogSLOTools } from './slos.js';
import { registerDatadogSyntheticsTools } from './synthetics.js';
import { registerDatadogTeamsTools } from './teams.js';
import { registerDatadogUsageTools } from './usage.js';
import { registerDatadogWatchdogTools } from './watchdog.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

type ToolRegistrationFn = (server: McpServer) => Map<string, RegisteredTool>;

export const registerTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  const registrations: ToolRegistrationFn[] = [
    // Core observability
    registerDatadogLogsTools,
    registerDatadogApmTools,
    registerDatadogMetricsTools,
    registerDatadogMonitorsTools,
    registerDatadogDashboardsTools,
    registerDatadogSLOTools,

    // Service & Infrastructure
    registerDatadogServicesTools,
    registerDatadogHostsTools,
    registerDatadogTeamsTools,

    // Incidents & Events
    registerDatadogIncidentsTools,
    registerDatadogEventsTools,
    registerDatadogDowntimesTools,

    // Frontend & User Experience
    registerDatadogRumTools,
    registerDatadogErrorTrackingTools,

    // CI/CD & Deployments
    registerDatadogDeploymentsTools,

    // AI & Anomaly Detection
    registerDatadogWatchdogTools,

    // Synthetic Monitoring
    registerDatadogSyntheticsTools,

    // Documentation & Collaboration
    registerDatadogNotebooksTools,

    // Admin & Compliance
    registerDatadogAuditTools,
    registerDatadogUsageTools,
  ];

  for (const register of registrations) {
    for (const [name, tool] of register(server)) {
      tools.set(name, tool);
    }
  }

  return tools;
};

export {
  registerDatadogLogsTools,
  registerDatadogApmTools,
  registerDatadogMetricsTools,
  registerDatadogMonitorsTools,
  registerDatadogDashboardsTools,
  registerDatadogEventsTools,
  registerDatadogIncidentsTools,
  registerDatadogSLOTools,
  registerDatadogServicesTools,
  registerDatadogWatchdogTools,
  registerDatadogTeamsTools,
  registerDatadogDowntimesTools,
  registerDatadogRumTools,
  registerDatadogErrorTrackingTools,
  registerDatadogDeploymentsTools,
  registerDatadogHostsTools,
  registerDatadogNotebooksTools,
  registerDatadogAuditTools,
  registerDatadogUsageTools,
  registerDatadogSyntheticsTools,
};

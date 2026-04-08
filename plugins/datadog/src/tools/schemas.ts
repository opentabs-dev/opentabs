import { z } from 'zod';

// --- Monitors ---

export const monitorSchema = z.object({
  id: z.number().describe('Monitor ID'),
  name: z.string().describe('Monitor name'),
  type: z.string().describe('Monitor type (e.g., query alert, service check, metric alert)'),
  query: z.string().describe('Monitor query'),
  message: z.string().describe('Notification message'),
  tags: z.array(z.string()).describe('Monitor tags'),
  overall_state: z.string().describe('Current state (OK, Alert, Warn, No Data)'),
  priority: z.number().nullable().describe('Monitor priority (1-5, null if unset)'),
  created: z.string().describe('Creation timestamp'),
  modified: z.string().describe('Last modification timestamp'),
  creator: z.object({
    name: z.string().nullable().describe('Creator name'),
    handle: z.string().describe('Creator email handle'),
  }),
});

interface RawMonitor {
  id?: number;
  name?: string;
  type?: string;
  query?: string;
  message?: string;
  tags?: string[];
  overall_state?: string;
  priority?: number | null;
  created?: string;
  modified?: string;
  creator?: { name?: string | null; handle?: string };
}

export const mapMonitor = (m: RawMonitor) => ({
  id: m.id ?? 0,
  name: m.name ?? '',
  type: m.type ?? '',
  query: m.query ?? '',
  message: m.message ?? '',
  tags: m.tags ?? [],
  overall_state: m.overall_state ?? 'Unknown',
  priority: m.priority ?? null,
  created: m.created ?? '',
  modified: m.modified ?? '',
  creator: {
    name: m.creator?.name ?? null,
    handle: m.creator?.handle ?? '',
  },
});

// --- Monitor Search ---

export const monitorSearchResultSchema = z.object({
  id: z.number().describe('Monitor ID'),
  name: z.string().describe('Monitor name'),
  type: z.string().describe('Monitor type'),
  overall_state: z.string().describe('Current state'),
  tags: z.array(z.string()).describe('Monitor tags'),
});

export const mapMonitorSearchResult = (m: RawMonitor) => ({
  id: m.id ?? 0,
  name: m.name ?? '',
  type: m.type ?? '',
  overall_state: m.overall_state ?? 'Unknown',
  tags: m.tags ?? [],
});

// --- Dashboards ---

export const dashboardSummarySchema = z.object({
  id: z.string().describe('Dashboard ID'),
  title: z.string().describe('Dashboard title'),
  description: z.string().describe('Dashboard description'),
  author_handle: z.string().describe('Author email handle'),
  created_at: z.string().describe('Creation timestamp'),
  modified_at: z.string().describe('Last modification timestamp'),
  url: z.string().describe('Dashboard URL path'),
  is_read_only: z.boolean().describe('Whether dashboard is read-only'),
});

interface RawDashboardSummary {
  id?: string;
  title?: string;
  description?: string | null;
  author_handle?: string;
  created_at?: string;
  modified_at?: string;
  url?: string;
  is_read_only?: boolean;
}

export const mapDashboardSummary = (d: RawDashboardSummary) => ({
  id: d.id ?? '',
  title: d.title ?? '',
  description: d.description ?? '',
  author_handle: d.author_handle ?? '',
  created_at: d.created_at ?? '',
  modified_at: d.modified_at ?? '',
  url: d.url ?? '',
  is_read_only: d.is_read_only ?? false,
});

// --- SLOs ---

export const sloSchema = z.object({
  id: z.string().describe('SLO ID'),
  name: z.string().describe('SLO name'),
  description: z.string().describe('SLO description'),
  type: z.string().describe('SLO type (metric or monitor)'),
  tags: z.array(z.string()).describe('SLO tags'),
  overall_status: z.array(
    z.object({
      timeframe: z.string().describe('Timeframe (7d, 30d, 90d)'),
      sli_value: z.number().nullable().describe('Current SLI value'),
      target: z.number().describe('Target percentage'),
      status: z.string().describe('Status (OK, warning, breached)'),
    }),
  ),
  created_at: z.number().describe('Creation timestamp (epoch seconds)'),
  modified_at: z.number().describe('Last modification timestamp (epoch seconds)'),
  creator: z.object({
    name: z.string().nullable().describe('Creator name'),
    handle: z.string().describe('Creator email handle'),
  }),
});

interface RawSloStatus {
  timeframe?: string;
  sli_value?: number | null;
  target?: number;
  status?: string;
}

interface RawSlo {
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  tags?: string[];
  overall_status?: RawSloStatus[];
  created_at?: number;
  modified_at?: number;
  creator?: { name?: string | null; handle?: string };
}

export const mapSlo = (s: RawSlo) => ({
  id: s.id ?? '',
  name: s.name ?? '',
  description: s.description ?? '',
  type: s.type ?? '',
  tags: s.tags ?? [],
  overall_status: (s.overall_status ?? []).map(os => ({
    timeframe: os.timeframe ?? '',
    sli_value: os.sli_value ?? null,
    target: os.target ?? 0,
    status: os.status ?? '',
  })),
  created_at: s.created_at ?? 0,
  modified_at: s.modified_at ?? 0,
  creator: {
    name: s.creator?.name ?? null,
    handle: s.creator?.handle ?? '',
  },
});

// --- Hosts ---

export const hostSchema = z.object({
  name: z.string().describe('Host name'),
  id: z.number().describe('Host ID'),
  aliases: z.array(z.string()).describe('Host aliases'),
  apps: z.array(z.string()).describe('Running integrations'),
  is_muted: z.boolean().describe('Whether host is muted'),
  last_reported_time: z.number().describe('Last reported time (epoch seconds)'),
  tags_by_source: z.record(z.string(), z.array(z.string())).describe('Tags organized by source'),
  meta: z.object({
    platform: z.string().describe('Platform (e.g., linux, windows)'),
    agent_version: z.string().describe('Datadog agent version'),
  }),
});

interface RawHost {
  name?: string;
  id?: number;
  aliases?: string[];
  apps?: string[];
  is_muted?: boolean;
  last_reported_time?: number;
  tags_by_source?: Record<string, string[]>;
  meta?: { platform?: string; agent_version?: string };
}

export const mapHost = (h: RawHost) => ({
  name: h.name ?? '',
  id: h.id ?? 0,
  aliases: h.aliases ?? [],
  apps: h.apps ?? [],
  is_muted: h.is_muted ?? false,
  last_reported_time: h.last_reported_time ?? 0,
  tags_by_source: h.tags_by_source ?? {},
  meta: {
    platform: h.meta?.platform ?? '',
    agent_version: h.meta?.agent_version ?? '',
  },
});

// --- Services ---

export const serviceSchema = z.object({
  name: z.string().describe('Service name'),
  schema_version: z.string().describe('Schema version'),
  team: z.string().describe('Owning team'),
  contacts: z.array(
    z.object({
      type: z.string().describe('Contact type (slack, email, etc.)'),
      contact: z.string().describe('Contact value'),
    }),
  ),
  links: z.array(
    z.object({
      name: z.string().describe('Link name'),
      type: z.string().describe('Link type (repo, doc, runbook, etc.)'),
      url: z.string().describe('Link URL'),
    }),
  ),
  tags: z.array(z.string()).describe('Service tags'),
});

interface RawServiceContact {
  type?: string;
  contact?: string;
}

interface RawServiceLink {
  name?: string;
  type?: string;
  url?: string;
}

interface RawService {
  attributes?: {
    schema?: {
      'dd-service'?: string;
      'schema-version'?: string;
      team?: string;
      contacts?: RawServiceContact[];
      links?: RawServiceLink[];
      tags?: string[];
    };
  };
}

export const mapService = (s: RawService) => {
  const schema = s.attributes?.schema;
  return {
    name: schema?.['dd-service'] ?? '',
    schema_version: schema?.['schema-version'] ?? '',
    team: schema?.team ?? '',
    contacts: (schema?.contacts ?? []).map(c => ({
      type: c.type ?? '',
      contact: c.contact ?? '',
    })),
    links: (schema?.links ?? []).map(l => ({
      name: l.name ?? '',
      type: l.type ?? '',
      url: l.url ?? '',
    })),
    tags: schema?.tags ?? [],
  };
};

// --- Notebooks ---

export const notebookSchema = z.object({
  id: z.number().describe('Notebook ID'),
  name: z.string().describe('Notebook name'),
  author: z.object({
    handle: z.string().describe('Author email handle'),
    name: z.string().nullable().describe('Author name'),
  }),
  status: z.string().describe('Notebook status'),
  created: z.string().describe('Creation timestamp'),
  modified: z.string().describe('Last modification timestamp'),
});

interface RawNotebook {
  id?: number;
  attributes?: {
    name?: string;
    author?: { handle?: string; name?: string | null };
    status?: string;
    created?: string;
    modified?: string;
  };
}

export const mapNotebook = (n: RawNotebook) => ({
  id: n.id ?? 0,
  name: n.attributes?.name ?? '',
  author: {
    handle: n.attributes?.author?.handle ?? '',
    name: n.attributes?.author?.name ?? null,
  },
  status: n.attributes?.status ?? '',
  created: n.attributes?.created ?? '',
  modified: n.attributes?.modified ?? '',
});

// --- Synthetics ---

export const syntheticTestSchema = z.object({
  public_id: z.string().describe('Test public ID'),
  name: z.string().describe('Test name'),
  type: z.string().describe('Test type (api, browser, mobile)'),
  subtype: z.string().describe('Test subtype (http, ssl, tcp, dns, etc.)'),
  status: z.string().describe('Test status (live, paused)'),
  tags: z.array(z.string()).describe('Test tags'),
  locations: z.array(z.string()).describe('Test locations'),
  message: z.string().describe('Notification message'),
  created_at: z.string().describe('Creation timestamp'),
  modified_at: z.string().describe('Last modification timestamp'),
});

interface RawSyntheticTest {
  public_id?: string;
  name?: string;
  type?: string;
  subtype?: string;
  status?: string;
  tags?: string[];
  locations?: string[];
  message?: string;
  created_at?: string;
  modified_at?: string;
}

export const mapSyntheticTest = (t: RawSyntheticTest) => ({
  public_id: t.public_id ?? '',
  name: t.name ?? '',
  type: t.type ?? '',
  subtype: t.subtype ?? '',
  status: t.status ?? '',
  tags: t.tags ?? [],
  locations: t.locations ?? [],
  message: t.message ?? '',
  created_at: t.created_at ?? '',
  modified_at: t.modified_at ?? '',
});

// --- Downtimes ---

export const downtimeSchema = z.object({
  id: z.string().describe('Downtime ID'),
  display_timezone: z.string().describe('Display timezone'),
  message: z.string().describe('Downtime message'),
  scope: z.string().describe('Downtime scope'),
  status: z.string().describe('Downtime status'),
  schedule: z.object({
    start: z.string().describe('Start time'),
    end: z.string().nullable().describe('End time (null if indefinite)'),
  }),
  monitor_identifier: z.object({
    monitor_id: z.number().nullable().describe('Specific monitor ID'),
    monitor_tags: z.array(z.string()).describe('Monitor tags to match'),
  }),
  created: z.string().describe('Creation timestamp'),
});

interface RawDowntime {
  id?: string;
  attributes?: {
    display_timezone?: string;
    message?: string;
    scope?: string;
    status?: string;
    schedule?: { start?: string; end?: string | null };
    monitor_identifier?: { monitor_id?: number | null; monitor_tags?: string[] };
    created?: string;
  };
}

export const mapDowntime = (d: RawDowntime) => ({
  id: d.id ?? '',
  display_timezone: d.attributes?.display_timezone ?? '',
  message: d.attributes?.message ?? '',
  scope: d.attributes?.scope ?? '',
  status: d.attributes?.status ?? '',
  schedule: {
    start: d.attributes?.schedule?.start ?? '',
    end: d.attributes?.schedule?.end ?? null,
  },
  monitor_identifier: {
    monitor_id: d.attributes?.monitor_identifier?.monitor_id ?? null,
    monitor_tags: d.attributes?.monitor_identifier?.monitor_tags ?? [],
  },
  created: d.attributes?.created ?? '',
});

// --- Spans ---

export const spanSchema = z.object({
  span_id: z.string().describe('Span ID'),
  trace_id: z.string().describe('Trace ID'),
  service: z.string().describe('Service name'),
  resource: z.string().describe('Resource name'),
  operation_name: z.string().describe('Operation name'),
  duration: z.number().describe('Duration in nanoseconds'),
  start: z.string().describe('Start timestamp'),
  status: z.string().describe('Span status (ok, error, info)'),
  tags: z.record(z.string(), z.string()).describe('Span tags'),
});

interface RawSpanAttributes {
  span_id?: string;
  trace_id?: string;
  service?: string;
  resource_name?: string;
  operation_name?: string;
  start_timestamp?: string;
  end_timestamp?: string;
  status?: string;
  tags?: string[];
  custom?: { duration?: number; env?: string };
  resource_hash?: string;
  ingestion_reason?: string;
}

interface RawSpan {
  id?: string;
  type?: string;
  attributes?: RawSpanAttributes;
}

export const mapSpan = (s: RawSpan) => {
  const attrs = s.attributes ?? {};
  return {
    span_id: attrs.span_id ?? s.id ?? '',
    trace_id: attrs.trace_id ?? '',
    service: attrs.service ?? '',
    resource: attrs.resource_name ?? '',
    operation_name: attrs.operation_name ?? '',
    duration: attrs.custom?.duration ?? 0,
    start: attrs.start_timestamp ?? '',
    status: attrs.status ?? '',
    tags: tagsArrayToRecord(attrs.tags),
  };
};

/** Convert tags from ["key:value", ...] array to { key: value } record. */
const tagsArrayToRecord = (tags?: string[]): Record<string, string> => {
  if (!tags) return {};
  const record: Record<string, string> = {};
  for (const tag of tags) {
    const idx = tag.indexOf(':');
    if (idx > 0) {
      record[tag.slice(0, idx)] = tag.slice(idx + 1);
    } else {
      record[tag] = '';
    }
  }
  return record;
};

// --- Log Entry ---

export const logEntrySchema = z.object({
  id: z.string().describe('Log entry ID'),
  timestamp: z.string().describe('Log timestamp'),
  status: z.string().describe('Log status (info, warn, error, etc.)'),
  service: z.string().describe('Service name'),
  host: z.string().describe('Host name'),
  message: z.string().describe('Log message'),
  tags: z.array(z.string()).describe('Log tags'),
});

// --- Metrics ---

export const metricSeriesSchema = z.object({
  metric: z.string().describe('Metric name'),
  scope: z.string().describe('Scope/tag set'),
  pointlist: z.array(z.tuple([z.number(), z.number()])).describe('Array of [timestamp_ms, value] pairs'),
  unit: z
    .array(z.object({ name: z.string() }))
    .nullable()
    .describe('Unit info'),
});

export const metricMetadataSchema = z.object({
  type: z.string().describe('Metric type (gauge, rate, count)'),
  description: z.string().describe('Metric description'),
  short_name: z.string().describe('Short name'),
  unit: z.string().describe('Metric unit'),
  per_unit: z.string().describe('Per unit'),
  integration: z.string().describe('Integration name'),
});

interface RawMetricMetadata {
  type?: string;
  description?: string;
  short_name?: string;
  unit?: string;
  per_unit?: string;
  integration?: string;
}

export const mapMetricMetadata = (m: RawMetricMetadata) => ({
  type: m.type ?? '',
  description: m.description ?? '',
  short_name: m.short_name ?? '',
  unit: m.unit ?? '',
  per_unit: m.per_unit ?? '',
  integration: m.integration ?? '',
});

// --- User ---

export const userSchema = z.object({
  uuid: z.string().describe('User UUID'),
  name: z.string().describe('User display name'),
  handle: z.string().describe('User email handle'),
  email: z.string().describe('User email'),
  title: z.string().describe('User title'),
  status: z.string().describe('User status'),
  verified: z.boolean().describe('Whether email is verified'),
  disabled: z.boolean().describe('Whether account is disabled'),
  icon: z.string().describe('User avatar URL'),
});

interface RawUserAttributes {
  uuid?: string;
  name?: string;
  handle?: string;
  email?: string;
  title?: string;
  status?: string;
  verified?: boolean;
  disabled?: boolean;
  icon?: string;
}

interface RawUser {
  id?: string;
  attributes?: RawUserAttributes;
}

export const mapUser = (u: RawUser) => ({
  uuid: u.id ?? u.attributes?.uuid ?? '',
  name: u.attributes?.name ?? '',
  handle: u.attributes?.handle ?? '',
  email: u.attributes?.email ?? '',
  title: u.attributes?.title ?? '',
  status: u.attributes?.status ?? '',
  verified: u.attributes?.verified ?? false,
  disabled: u.attributes?.disabled ?? false,
  icon: u.attributes?.icon ?? '',
});

// --- Incidents ---

export const incidentSchema = z.object({
  id: z.string().describe('Incident ID'),
  title: z.string().describe('Incident title'),
  status: z.string().describe('Incident status (active, stable, resolved)'),
  severity: z.string().describe('Incident severity (SEV-1 through SEV-5)'),
  created: z.string().describe('Creation timestamp'),
  modified: z.string().describe('Last modification timestamp'),
  commander: z.string().describe('Incident commander handle'),
  customer_impacted: z.boolean().describe('Whether customers are impacted'),
});

interface RawIncident {
  id?: string;
  attributes?: {
    title?: string;
    status?: string;
    severity?: string;
    created?: string;
    modified?: string;
    commander?: { data?: { attributes?: { handle?: string } } };
    fields?: {
      severity?: { value?: string };
      customer_impact_scope?: { value?: string };
    };
    customer_impacted?: boolean;
  };
}

export const mapIncident = (i: RawIncident) => ({
  id: i.id ?? '',
  title: i.attributes?.title ?? '',
  status: i.attributes?.status ?? '',
  severity: i.attributes?.fields?.severity?.value ?? i.attributes?.severity ?? '',
  created: i.attributes?.created ?? '',
  modified: i.attributes?.modified ?? '',
  commander: i.attributes?.commander?.data?.attributes?.handle ?? '',
  customer_impacted: i.attributes?.customer_impacted ?? false,
});

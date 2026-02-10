/** Environments a service can operate in */
type ServiceEnvironment = 'webapp' | 'native';

/** Sources a service definition can originate from */
type ServiceSource = 'platform' | 'plugin';

interface ServiceDefinition {
  /** Unique service type identifier (e.g., "slack", "browser") */
  readonly type: string;
  /** Human-readable display name */
  readonly displayName: string;
  /** Environments this service runs in */
  readonly environments: readonly ServiceEnvironment[];
  /** Domains the service operates on (e.g., ["app.slack.com"]) */
  readonly domains: readonly string[];
  /** Chrome match patterns for URL matching */
  readonly urlPatterns: readonly string[];
  /** Extension icon name */
  readonly iconName: string;
  /** Request timeout in milliseconds */
  readonly timeout: number;
  /** Default URL to open when no matching tab is found */
  readonly defaultUrl: string;
  /** Chrome host permissions required */
  readonly hostPermissions: readonly string[];
  /** Where this definition came from */
  readonly source: ServiceSource;
  /** npm package name if from a plugin */
  readonly packageName?: string;
}

/** Tab connection states */
type ConnectionStatus = 'authed' | 'not-authed' | 'closed';

/** Per-service connection status with tab tracking */
interface ServiceConnectionStatus {
  readonly service: string;
  readonly status: ConnectionStatus;
  readonly tabIds: readonly number[];
}

// ---------------------------------------------------------------------------
// Service Registry — runtime-mutable with change listeners and derived lookups
// ---------------------------------------------------------------------------

type RegistryChangeType = 'add' | 'remove';

interface RegistryChange {
  readonly changeType: RegistryChangeType;
  readonly definitions: readonly ServiceDefinition[];
}

type RegistryChangeListener = (change: RegistryChange) => void;

/** Derived lookup tables recomputed on each mutation */
interface DerivedLookups {
  readonly byType: ReadonlyMap<string, ServiceDefinition>;
  readonly byUrlPattern: ReadonlyMap<string, ServiceDefinition>;
}

let definitions: ServiceDefinition[] = [];
let derived: DerivedLookups = { byType: new Map(), byUrlPattern: new Map() };
const listeners: Set<RegistryChangeListener> = new Set();

const recomputeLookups = (): void => {
  const byType = new Map<string, ServiceDefinition>();
  const byUrlPattern = new Map<string, ServiceDefinition>();

  for (const def of definitions) {
    byType.set(def.type, def);
    for (const pattern of def.urlPatterns) {
      byUrlPattern.set(pattern, def);
    }
  }

  derived = { byType, byUrlPattern };
};

const notifyListeners = (change: RegistryChange): void => {
  for (const listener of listeners) {
    listener(change);
  }
};

/** Replace the entire registry contents. Used for initial population. */
const setServiceRegistry = (newDefinitions: readonly ServiceDefinition[]): void => {
  const removed = definitions.slice();
  definitions = [...newDefinitions];
  recomputeLookups();

  if (removed.length > 0) {
    notifyListeners({ changeType: 'remove', definitions: removed });
  }
  if (definitions.length > 0) {
    notifyListeners({ changeType: 'add', definitions });
  }
};

/** Add service definitions to the registry. */
const addServiceDefinitions = (newDefinitions: readonly ServiceDefinition[]): void => {
  if (newDefinitions.length === 0) return;
  definitions = [...definitions, ...newDefinitions];
  recomputeLookups();
  notifyListeners({ changeType: 'add', definitions: newDefinitions });
};

/** Remove service definitions by type. */
const removeServiceDefinitions = (types: readonly string[]): void => {
  if (types.length === 0) return;
  const typeSet = new Set(types);
  const removed = definitions.filter(d => typeSet.has(d.type));
  if (removed.length === 0) return;
  definitions = definitions.filter(d => !typeSet.has(d.type));
  recomputeLookups();
  notifyListeners({ changeType: 'remove', definitions: removed });
};

/** Get all service definitions. */
const getServiceDefinitions = (): readonly ServiceDefinition[] => definitions;

/** Look up a service definition by type. */
const getServiceByType = (type: string): ServiceDefinition | undefined => derived.byType.get(type);

/** Look up a service definition by URL pattern. */
const getServiceByUrlPattern = (pattern: string): ServiceDefinition | undefined => derived.byUrlPattern.get(pattern);

/** Get the byType lookup table. */
const getServicesByType = (): ReadonlyMap<string, ServiceDefinition> => derived.byType;

/** Get the byUrlPattern lookup table. */
const getServicesByUrlPattern = (): ReadonlyMap<string, ServiceDefinition> => derived.byUrlPattern;

/** Subscribe to registry changes. Returns an unsubscribe function. */
const onRegistryChange = (listener: RegistryChangeListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export {
  setServiceRegistry,
  addServiceDefinitions,
  removeServiceDefinitions,
  getServiceDefinitions,
  getServiceByType,
  getServiceByUrlPattern,
  getServicesByType,
  getServicesByUrlPattern,
  onRegistryChange,
  type ServiceEnvironment,
  type ServiceSource,
  type ServiceDefinition,
  type ConnectionStatus,
  type ServiceConnectionStatus,
  type RegistryChangeType,
  type RegistryChange,
  type RegistryChangeListener,
};

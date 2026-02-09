// Service controllers — generic controller + declarative configs
export { WebappServiceController, type WebappServiceConfig } from './webapp-service-controller';
export {
  SLACK_CONFIG,
  LOGROCKET_CONFIG,
  SNOWFLAKE_CONFIG,
  createDatadogConfig,
  createSqlpadConfig,
  createRetoolConfig,
} from './service-configs';

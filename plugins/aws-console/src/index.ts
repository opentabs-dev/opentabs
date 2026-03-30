import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth, disconnectCredentialObserver } from './aws-api.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { listRegions } from './tools/list-regions.js';
import { listInstances } from './tools/list-instances.js';
import { describeInstance } from './tools/describe-instance.js';
import { startInstance } from './tools/start-instance.js';
import { stopInstance } from './tools/stop-instance.js';
import { listSecurityGroups } from './tools/list-security-groups.js';
import { listVpcs } from './tools/list-vpcs.js';
import { listSubnets } from './tools/list-subnets.js';
import { listFunctions } from './tools/list-functions.js';
import { getFunction } from './tools/get-function.js';
import { invokeFunction } from './tools/invoke-function.js';
import { listIamUsers } from './tools/list-iam-users.js';
import { listIamRoles } from './tools/list-iam-roles.js';
import { listAlarms } from './tools/list-alarms.js';
import { listLogGroups } from './tools/list-log-groups.js';

class AwsConsolePlugin extends OpenTabsPlugin {
  readonly name = 'aws-console';
  readonly description = 'OpenTabs plugin for AWS Console — manage EC2, Lambda, IAM, and CloudWatch resources';
  override readonly displayName = 'AWS Console';
  readonly urlPatterns = ['*://*.console.aws.amazon.com/*'];
  override readonly homepage = 'https://console.aws.amazon.com';
  readonly tools: ToolDefinition[] = [
    getCurrentUser,
    listRegions,
    listInstances,
    describeInstance,
    startInstance,
    stopInstance,
    listSecurityGroups,
    listVpcs,
    listSubnets,
    listFunctions,
    getFunction,
    invokeFunction,
    listIamUsers,
    listIamRoles,
    listAlarms,
    listLogGroups,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }

  override teardown(): void {
    disconnectCredentialObserver();
  }
}

export default new AwsConsolePlugin();

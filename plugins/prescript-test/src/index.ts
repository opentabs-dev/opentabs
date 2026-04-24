import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { echoAuth } from './tools/echo-auth.js';

class PreScriptTestPlugin extends OpenTabsPlugin {
  readonly name = 'prescript-test';
  readonly description = 'POC plugin — verifies pre-script auth capture';
  override readonly displayName = 'PreScript POC';
  readonly urlPatterns = ['http://localhost/*', 'http://127.0.0.1/*'];
  readonly tools: ToolDefinition[] = [echoAuth];

  async isReady(): Promise<boolean> {
    return true;
  }
}

export default new PreScriptTestPlugin();

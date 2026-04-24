import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { echoAuth } from './tools/echo-auth.js';

class PreScriptTestPlugin extends OpenTabsPlugin {
  readonly name = 'prescript-test';
  readonly description =
    'Test plugin for the pre-script feature — captures bearer tokens at document_start before the page can overwrite window.fetch';
  override readonly displayName = 'Pre-Script Test';
  readonly urlPatterns = ['http://localhost/*', 'http://127.0.0.1/*'];
  readonly tools: ToolDefinition[] = [echoAuth];

  override async isReady(): Promise<boolean> {
    return true;
  }
}

export default new PreScriptTestPlugin();

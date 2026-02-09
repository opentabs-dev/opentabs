import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { clearAllMocks, trackMock } from '../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Create mock functions before module mock
const mockSendServiceRequest = trackMock(mock(() => {}));
// Mock the websocket relay for all tool modules
mock.module('../websocket-relay', () => ({
  relay: {
    sendServiceRequest: mockSendServiceRequest,
    sendSlackEdgeRequest: mockSendServiceRequest,
    sendBrowserRequest: mockSendServiceRequest,
    reloadExtension: mockSendServiceRequest,
  },
}));

// Import after mock.module
import { registerAllTools } from './index.js';

describe('registerAllTools', () => {
  let mockServer: {
    registerTool: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    clearAllMocks();
    mockServer = {
      // registerTool must return a RegisteredTool-like object since the tool
      // registration functions store the return value in a Map<string, RegisteredTool>.
      registerTool: trackMock(
        mock((name: string) => ({
          name,
          description: `mock-${name}`,
          inputSchema: undefined,
          handler: () => {},
          enabled: true,
          update: () => {},
          remove: () => {},
          enable: () => {},
          disable: () => {},
        })),
      ),
    };
  });

  it('should register all tool categories', () => {
    registerAllTools(mockServer as unknown as McpServer);

    // Get all registered tool names
    const registeredToolNames = mockServer.registerTool.mock.calls.map(call => call[0]);

    // Message tools
    expect(registeredToolNames).toContain('slack_send_message');
    expect(registeredToolNames).toContain('slack_read_messages');
    expect(registeredToolNames).toContain('slack_read_thread');
    expect(registeredToolNames).toContain('slack_reply_to_thread');
    expect(registeredToolNames).toContain('slack_react_to_message');
    expect(registeredToolNames).toContain('slack_update_message');
    expect(registeredToolNames).toContain('slack_delete_message');

    // Search tools
    expect(registeredToolNames).toContain('slack_search_messages');
    expect(registeredToolNames).toContain('slack_search_files');
    expect(registeredToolNames).toContain('slack_search_users');

    // Channel tools
    expect(registeredToolNames).toContain('slack_get_channel_info');
    expect(registeredToolNames).toContain('slack_list_channel_members');

    // Conversation tools
    expect(registeredToolNames).toContain('slack_open_dm');
    expect(registeredToolNames).toContain('slack_create_channel');
    expect(registeredToolNames).toContain('slack_archive_channel');
    expect(registeredToolNames).toContain('slack_unarchive_channel');
    expect(registeredToolNames).toContain('slack_set_channel_topic');
    expect(registeredToolNames).toContain('slack_set_channel_purpose');
    expect(registeredToolNames).toContain('slack_invite_to_channel');
    expect(registeredToolNames).toContain('slack_kick_from_channel');
    expect(registeredToolNames).toContain('slack_rename_channel');
    expect(registeredToolNames).toContain('slack_join_channel');
    expect(registeredToolNames).toContain('slack_leave_channel');
    expect(registeredToolNames).toContain('slack_list_channels');

    // User tools
    expect(registeredToolNames).toContain('slack_get_user_info');
    expect(registeredToolNames).toContain('slack_list_users');
    expect(registeredToolNames).toContain('slack_get_my_profile');

    // File tools
    expect(registeredToolNames).toContain('slack_get_file_info');
    expect(registeredToolNames).toContain('slack_list_files');

    // Pin tools
    expect(registeredToolNames).toContain('slack_pin_message');
    expect(registeredToolNames).toContain('slack_unpin_message');
    expect(registeredToolNames).toContain('slack_list_pins');

    // Star tools
    expect(registeredToolNames).toContain('slack_star_message');
    expect(registeredToolNames).toContain('slack_star_file');
    expect(registeredToolNames).toContain('slack_unstar_message');
    expect(registeredToolNames).toContain('slack_unstar_file');
    expect(registeredToolNames).toContain('slack_list_stars');

    // Reaction tools
    expect(registeredToolNames).toContain('slack_remove_reaction');
    expect(registeredToolNames).toContain('slack_get_reactions');

    // Datadog tools
    expect(registeredToolNames).toContain('datadog_list_monitors');
    expect(registeredToolNames).toContain('datadog_get_monitor');
    expect(registeredToolNames).toContain('datadog_search_monitors');
    expect(registeredToolNames).toContain('datadog_get_monitor_status');
    expect(registeredToolNames).toContain('datadog_search_logs');
    expect(registeredToolNames).toContain('datadog_query_metrics');
    expect(registeredToolNames).toContain('datadog_list_metrics');
    expect(registeredToolNames).toContain('datadog_get_metric_metadata');
    expect(registeredToolNames).toContain('datadog_list_dashboards');
    expect(registeredToolNames).toContain('datadog_get_dashboard');
    expect(registeredToolNames).toContain('datadog_search_dashboards');
    expect(registeredToolNames).toContain('datadog_search_traces');
    expect(registeredToolNames).toContain('datadog_get_trace');
    expect(registeredToolNames).toContain('datadog_get_service_summary');
    expect(registeredToolNames).toContain('datadog_list_incident_services');
  });

  it('should register at least 55 tools', () => {
    registerAllTools(mockServer as unknown as McpServer);

    // 40 Slack tools + 15+ Datadog tools (including new SLO tools) = 55+ total
    // Use >= to allow for new tools being added
    expect(mockServer.registerTool.mock.calls.length).toBeGreaterThanOrEqual(55);
  });

  it('should register tools with descriptions', () => {
    registerAllTools(mockServer as unknown as McpServer);

    // Each tool should have a config object with description (second argument)
    mockServer.registerTool.mock.calls.forEach(call => {
      const config = call[1] as { description?: string };
      expect(typeof config.description).toBe('string');
      expect(config.description!.length).toBeGreaterThan(0);
    });
  });

  it('should register tools with schema objects', () => {
    registerAllTools(mockServer as unknown as McpServer);

    // Each tool should have a config object (second argument)
    mockServer.registerTool.mock.calls.forEach(call => {
      expect(typeof call[1]).toBe('object');
    });
  });

  it('should register tools with handler functions', () => {
    registerAllTools(mockServer as unknown as McpServer);

    // Each tool should have a handler function (third argument)
    mockServer.registerTool.mock.calls.forEach(call => {
      expect(typeof call[2]).toBe('function');
    });
  });
});

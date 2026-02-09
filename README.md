# OpenTabs

Turns tabs into tools. A Chrome extension and MCP server that gives AI agents access to your browser tabs.

## Setup

### Prerequisites

- Bun 1.3.3+ (see `package.json` packageManager field)
- Chrome browser

### 1. Build

```bash
bun install
bun run build
```

### 2. Load Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist` folder

### 3. Start MCP Server

```bash
bun packages/mcp-server/dist/index.js
```

Default ports: 3000 (HTTP) and 8765 (WebSocket).

### 4. Configure Claude Code

Add to `~/.claude/settings/mcp.json`:

```json
{
  "mcpServers": {
    "opentabs": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

### 5. Connect

1. Open [app.slack.com](https://app.slack.com) in Chrome and sign in
2. Click the extension icon - both indicators should show "Connected" (green)
3. Use Slack tools in Claude Code

## Available Tools

| Tool | Description |
|------|-------------|
| `slack_send_message` | Send a message to a channel or DM |
| `slack_read_messages` | Read recent messages from a channel |
| `slack_read_thread` | Read all replies in a thread |
| `slack_reply_to_thread` | Reply to a specific thread |
| `slack_react_to_message` | Add an emoji reaction |
| `slack_search_messages` | Search messages across workspace |
| `slack_search_files` | Search for files |
| `slack_search_users` | Search for users by name or email |
| `slack_get_channel_info` | Get channel details |
| `slack_list_channel_members` | List members in a channel |
| `slack_get_user_info` | Get user profile |
| `slack_list_users` | List workspace users |
| `slack_get_my_profile` | Get your own profile |
| `slack_get_file_info` | Get file information |
| `slack_list_files` | List files in workspace |

## Troubleshooting

### Extension shows "Disconnected"

**MCP Server disconnected:**
- Ensure the MCP server is running: `bun packages/mcp-server/dist/index.js`
- Check port availability: `lsof -i :3000` and `lsof -i :8765`
- Verify the WebSocket port in the extension settings matches the server (default: 8765)

**Slack Tab disconnected:**
- Open [app.slack.com](https://app.slack.com) in Chrome (not the desktop app)
- Make sure you're signed into Slack
- Try refreshing the Slack tab
- Check that the extension has permission to run on slack.com

### Common Errors

**"Chrome extension not connected":**
1. Check that both indicators in the extension popup are green
2. If MCP Server is red: start the server with `bun packages/mcp-server/dist/index.js`
3. If Slack Tab is red: open app.slack.com and sign in

**"Channel not found":**
- For public channels, use `#channel-name` or the channel ID
- For private channels, you must use the channel ID (starts with `C`)
- Find channel IDs by right-clicking a channel → Copy → Copy link

**"Authentication failed":**
- Refresh your Slack tab
- If the issue persists, sign out of Slack and sign back in

**"Request timed out":**
- The Slack API may be slow; try again
- Check that your Slack tab is still open and responsive

### Port Conflicts

**"Port already in use":**
```bash
# Find what's using the port
lsof -i :3000
lsof -i :8765

# Kill existing instances
pkill -f opentabs-mcp

# Or use different ports
bun packages/mcp-server/dist/index.js --port 3001 --ws-port 8766
```

When using custom ports, update the extension settings (click gear icon in popup) and Claude Code config to match.

### Debug Tips

1. **Check server logs:** The MCP server logs to stderr. Watch for connection/disconnection messages.
2. **Check extension console:** Right-click extension icon → Inspect popup → Console tab
3. **Check Slack tab console:** Open DevTools on the Slack tab and filter for "[OpenTabs]"
4. **Health check:** Visit `http://127.0.0.1:3000/health` to see server status

## How It Works

Slack does not provide an official MCP server. Existing third-party Slack MCPs require bot tokens or OAuth apps, which need workspace admin approval and create audit trails as a "bot" rather than your user.

This extension connects directly through your existing Slack web session. All API calls use the same authentication as your browser - exactly as if you were interacting with Slack in the web app.

```
┌─────────────┐  HTTP/SSE       ┌─────────────┐   WebSocket   ┌──────────────────┐
│ Claude Code │ ←─────────────→ │ MCP Server  │ ←───────────→ │ Chrome Extension │
│             │  /mcp or /sse   │ (localhost) │               │   (Background)   │
└─────────────┘                 └─────────────┘               └────────┬─────────┘
                                                                       │
                                                              ┌────────▼─────────┐
                                                              │  Content Script  │
                                                              │  (Slack Tab)     │
                                                              └────────┬─────────┘
                                                                       │ Same-origin
                                                              ┌────────▼─────────┐
                                                              │   Slack Web API  │
                                                              │ (your session)   │
                                                              └──────────────────┘
```

The content script runs in the Slack tab and makes API calls using your session cookies. Both the HTTP server and WebSocket bind to `127.0.0.1` only - not accessible from the network.

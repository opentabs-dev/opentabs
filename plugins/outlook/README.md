# Microsoft Outlook

OpenTabs plugin for Microsoft Outlook — gives AI agents access to Microsoft Outlook through your authenticated browser session.

## Install

```bash
opentabs plugin install outlook
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-outlook
```

## Setup

1. Open [outlook.cloud.microsoft](https://outlook.cloud.microsoft) in Chrome and log in
2. Open the OpenTabs side panel — the Microsoft Outlook plugin should appear as **ready**

## Tools (14)

### Account (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the current user profile | Read |

### Messages (11)

| Tool | Description | Type |
|---|---|---|
| `list_messages` | List messages in a mail folder | Read |
| `get_message` | Get full message details | Read |
| `search_messages` | Search emails using KQL | Read |
| `send_message` | Send a new email | Write |
| `reply_to_message` | Reply or reply-all to a message | Write |
| `forward_message` | Forward a message | Write |
| `create_draft` | Create a draft email | Write |
| `update_message` | Update message properties (read, flag, importance, categories) | Write |
| `move_message` | Move a message to another folder | Write |
| `delete_message` | Delete a message | Write |
| `list_attachments` | List attachments on a message | Read |
| `get_attachment_content` | Download and read attachment content | Read |

### Folders (1)

| Tool | Description | Type |
|---|---|---|
| `list_folders` | List mail folders | Read |

## How It Works

This plugin runs inside your Microsoft Outlook tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT

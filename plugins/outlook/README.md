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

## Tools (24)

### Account (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the current user profile | Read |

### Messages (13)

| Tool | Description | Type |
|---|---|---|
| `list_messages` | List emails in a folder | Read |
| `get_message` | Get full email content | Read |
| `search_messages` | Search emails by keyword | Read |
| `send_message` | Send an email | Write |
| `reply_to_message` | Reply to an email | Write |
| `forward_message` | Forward an email | Write |
| `create_draft` | Create a draft email | Write |
| `update_message` | Update email properties | Write |
| `move_message` | Move email to folder | Write |
| `delete_message` | Delete an email | Write |
| `list_attachments` | List email attachments | Read |
| `get_attachment_content` | Get attachment content | Read |
| `download_attachment` | Save attachment to Downloads folder | Write |

### Folders (1)

| Tool | Description | Type |
|---|---|---|
| `list_folders` | List mail folders | Read |

### Calendar (9)

| Tool | Description | Type |
|---|---|---|
| `list_calendars` | List calendars, including shared ones | Read |
| `list_events` | List events in a calendar | Read |
| `get_calendar_view` | View events in a date range (expands recurrences) | Read |
| `get_event` | Get full event details | Read |
| `get_schedule` | View others' free/busy availability | Read |
| `create_event` | Create an event or meeting | Write |
| `update_event` | Update an event | Write |
| `delete_event` | Delete or cancel an event | Write |
| `respond_to_event` | Accept, decline, or tentatively accept an invitation | Write |

## How It Works

This plugin runs inside your Microsoft Outlook tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT

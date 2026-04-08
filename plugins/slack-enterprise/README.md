# Slack Enterprise

OpenTabs plugin for Slack Enterprise Grid — gives AI agents access to Slack Enterprise through your authenticated browser session.

## Install

```bash
opentabs plugin install slack-enterprise
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-slack-enterprise
```

## Setup

1. Open [app.slack.com](https://app.slack.com) in Chrome and log in
2. Open the OpenTabs side panel — the Slack Enterprise plugin should appear as **ready**

## Tools (54)

### Messages (6)

| Tool | Description | Type |
|---|---|---|
| `send_message` | Send a message to a channel or DM | Write |
| `read_messages` | Read messages from a channel | Read |
| `read_thread` | Read thread replies | Read |
| `reply_to_thread` | Reply to a thread | Write |
| `update_message` | Edit an existing message | Write |
| `delete_message` | Delete a message | Write |

### Reactions (3)

| Tool | Description | Type |
|---|---|---|
| `react_to_message` | Add emoji reaction to a message | Write |
| `remove_reaction` | Remove emoji reaction | Write |
| `get_reactions` | Get reactions on a message | Read |

### Search (4)

| Tool | Description | Type |
|---|---|---|
| `search_messages` | Search messages across channels | Read |
| `search_files` | Search files in Slack | Read |
| `search_users` | Search users by name or email | Read |
| `search_channels` | Search channels by name | Read |

### Channels (3)

| Tool | Description | Type |
|---|---|---|
| `list_channels` | List workspace channels | Read |
| `get_channel_info` | Get channel details | Read |
| `list_channel_members` | List channel members | Read |

### Direct Messages (1)

| Tool | Description | Type |
|---|---|---|
| `open_dm` | Open a direct message | Write |

### Conversations (10)

| Tool | Description | Type |
|---|---|---|
| `create_channel` | Create a new channel | Write |
| `archive_channel` | Archive a channel | Write |
| `unarchive_channel` | Unarchive a channel | Write |
| `set_channel_topic` | Set channel topic | Write |
| `set_channel_purpose` | Set channel purpose | Write |
| `invite_to_channel` | Add users to a channel | Write |
| `kick_from_channel` | Remove a user from a channel | Write |
| `rename_channel` | Rename a channel | Write |
| `join_channel` | Join a public channel | Write |
| `leave_channel` | Leave a channel | Write |

### Users (3)

| Tool | Description | Type |
|---|---|---|
| `get_user_info` | Get user profile | Read |
| `list_users` | List workspace users | Read |
| `get_my_profile` | Get your own profile | Read |

### Files (3)

| Tool | Description | Type |
|---|---|---|
| `get_file_info` | Get file details | Read |
| `list_files` | List workspace files | Read |
| `upload_file` | Upload a file to a channel | Write |

### Pins (3)

| Tool | Description | Type |
|---|---|---|
| `pin_message` | Pin a message | Write |
| `unpin_message` | Unpin a message | Write |
| `list_pins` | List pinned items | Read |

### Stars (5)

| Tool | Description | Type |
|---|---|---|
| `star_message` | Star a message | Write |
| `star_file` | Star a file | Write |
| `unstar_message` | Unstar a message | Write |
| `unstar_file` | Unstar a file | Write |
| `list_stars` | List starred/saved items | Read |

### Bookmarks (3)

| Tool | Description | Type |
|---|---|---|
| `list_bookmarks` | List channel bookmarks | Read |
| `add_bookmark` | Add a bookmark to a channel | Write |
| `remove_bookmark` | Remove a channel bookmark | Write |

### User Groups (2)

| Tool | Description | Type |
|---|---|---|
| `list_user_groups` | List workspace user groups | Read |
| `list_user_group_members` | List members of a user group | Read |

### Profile (1)

| Tool | Description | Type |
|---|---|---|
| `set_status` | Set user status | Write |

### Reminders (4)

| Tool | Description | Type |
|---|---|---|
| `add_reminder` | Create a reminder | Write |
| `list_reminders` | List user reminders | Read |
| `delete_reminder` | Delete a reminder | Write |
| `complete_reminder` | Complete a reminder | Write |

### Do Not Disturb (3)

| Tool | Description | Type |
|---|---|---|
| `set_snooze` | Snooze notifications | Write |
| `end_snooze` | End snooze and resume notifications | Write |
| `get_dnd_status` | Get Do Not Disturb status | Read |

## How It Works

This plugin runs inside your Slack Enterprise tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT

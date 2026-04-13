# Lucid

OpenTabs plugin for Lucid (Lucidchart, Lucidspark) — gives AI agents access to Lucid through your authenticated browser session.

## Install

```bash
opentabs plugin install lucid
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-lucid
```

## Setup

1. Open [lucid.app](https://lucid.app) in Chrome and log in
2. Open the OpenTabs side panel — the Lucid plugin should appear as **ready**

## Tools (20)

### Account (5)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get your Lucid profile | Read |
| `get_account` | Get account details | Read |
| `list_account_users` | List users in the account | Read |
| `get_user_permissions` | Get your account permissions | Read |
| `list_groups` | List your teams and groups | Read |

### Documents (9)

| Tool | Description | Type |
|---|---|---|
| `list_documents` | List your documents | Read |
| `get_document` | Get document details | Read |
| `search_documents` | Search documents by keyword | Read |
| `create_document` | Create a new document | Write |
| `trash_document` | Move a document to trash | Write |
| `get_document_pages` | List pages in a document | Read |
| `get_document_role` | Get your role on a document | Read |
| `get_document_status` | Get document workflow status | Read |
| `get_document_count` | Count your documents | Read |

### Folders (6)

| Tool | Description | Type |
|---|---|---|
| `list_folder_entries` | List folders and document entries | Read |
| `get_folder_entry` | Get folder entry details | Read |
| `create_folder` | Create a new folder | Write |
| `rename_folder` | Rename a folder | Write |
| `delete_folder` | Delete a folder | Write |
| `move_document_to_folder` | Move a document into a folder | Write |

## How It Works

This plugin runs inside your Lucid tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT

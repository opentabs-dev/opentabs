# GitHub

OpenTabs plugin for GitHub — gives AI agents access to GitHub through your authenticated browser session.

## Install

```bash
opentabs plugin install github
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-github
```

## Setup

1. Open [github.com](https://github.com) in Chrome and log in
2. Open the OpenTabs side panel — the GitHub plugin should appear as **ready**

## Tools (41)

### Repositories (11)

| Tool | Description | Type |
|---|---|---|
| `list_repos` | List repositories for a user or organization | Read |
| `get_repo` | Get details of a specific repository | Read |
| `create_repo` | Create a new repository | Write |
| `list_commits` | List commits for a repository | Read |
| `compare_commits` | Compare two commits or branches | Write |
| `list_releases` | List releases for a repository | Read |
| `create_release` | Create a release in a repository | Write |
| `list_branches` | List branches for a repository | Read |
| `get_file_content` | Read a file from a repository | Read |
| `create_or_update_file` | Create or update a file in a repository | Write |
| `delete_file` | Delete a file from a repository | Write |

### Issues (13)

| Tool | Description | Type |
|---|---|---|
| `list_issues` | List issues for a repository | Read |
| `get_issue` | Get details of a specific issue | Read |
| `create_issue` | Create a new issue in a repository | Write |
| `update_issue` | Update an existing issue | Write |
| `search_issues` | Search issues and pull requests | Read |
| `list_labels` | List labels for a repository | Read |
| `create_label` | Create a label in a repository | Write |
| `list_related_issues` | List native Relates to issue relationships | Read |
| `add_related_issue` | Add a native Relates to issue relationship | Write |
| `remove_related_issue` | Remove a native Relates to issue relationship | Write |
| `list_development_pull_requests` | List native Development pull request links | Read |
| `link_development_pull_request` | Link a native Development pull request | Write |
| `unlink_development_pull_request` | Unlink a native Development pull request | Write |

### Pull Requests (8)

| Tool | Description | Type |
|---|---|---|
| `list_pull_requests` | List pull requests for a repository | Read |
| `get_pull_request` | Get details of a specific pull request | Read |
| `create_pull_request` | Create a new pull request | Write |
| `update_pull_request` | Update a pull request | Write |
| `merge_pull_request` | Merge a pull request | Write |
| `get_pull_request_diff` | Get the raw diff of a pull request | Read |
| `list_pull_request_files` | List files changed in a pull request | Read |
| `request_pull_request_review` | Request reviewers for a pull request | Write |

### Comments (2)

| Tool | Description | Type |
|---|---|---|
| `list_comments` | List comments on an issue or pull request | Read |
| `create_comment` | Add a comment to an issue or pull request | Write |

### Users (3)

| Tool | Description | Type |
|---|---|---|
| `get_user_profile` | Get a user's profile information | Read |
| `list_org_members` | List members of an organization | Read |
| `list_notifications` | List notifications for the authenticated user | Read |

### Actions (2)

| Tool | Description | Type |
|---|---|---|
| `list_workflow_runs` | List GitHub Actions workflow runs | Read |
| `get_workflow_run` | Get a workflow run by ID | Read |

### Search (1)

| Tool | Description | Type |
|---|---|---|
| `search_repos` | Search repositories on GitHub | Read |

### Reactions (1)

| Tool | Description | Type |
|---|---|---|
| `add_reaction` | Add a reaction to an issue or comment | Write |

## How It Works

This plugin runs inside your GitHub tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT

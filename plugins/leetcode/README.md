# LeetCode

OpenTabs plugin for LeetCode — gives AI agents access to LeetCode through your authenticated browser session.

## Install

```bash
opentabs plugin install leetcode
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-leetcode
```

## Setup

1. Open [leetcode.com](https://leetcode.com) in Chrome and log in
2. Open the OpenTabs side panel — the LeetCode plugin should appear as **ready**

## Tools (26)

### Account (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get your LeetCode profile | Read |

### Users (7)

| Tool | Description | Type |
|---|---|---|
| `get_user_profile` | Get a user profile by username | Read |
| `get_user_progress` | Get solving progress by difficulty | Read |
| `get_user_calendar` | Get submission calendar and streaks | Read |
| `get_user_submit_stats` | Get submission stats by difficulty | Read |
| `get_user_badges` | Get a user earned badges | Read |
| `get_user_language_stats` | Get language usage stats | Read |
| `get_user_skill_stats` | Get topic-based solving stats | Read |

### Problems (8)

| Tool | Description | Type |
|---|---|---|
| `list_problems` | Browse the problem set | Read |
| `get_problem` | Get a problem by slug | Read |
| `get_daily_challenge` | Get today's daily challenge | Read |
| `get_problem_hints` | Get hints for a problem | Read |
| `get_problem_solution` | Get the official solution article | Read |
| `get_problem_stats` | Get problem acceptance stats | Read |
| `get_similar_problems` | Find similar problems | Read |
| `list_topic_tags` | List all topic tags | Read |

### Code (3)

| Tool | Description | Type |
|---|---|---|
| `get_code_snippets` | Get starter code for all languages | Read |
| `run_code` | Run code against test cases | Write |
| `submit_code` | Submit a solution for judging | Write |

### Submissions (3)

| Tool | Description | Type |
|---|---|---|
| `list_submissions` | List your submissions | Read |
| `list_recent_submissions` | List recent accepted submissions | Read |
| `get_submission` | Get submission details by ID | Read |

### Discussions (1)

| Tool | Description | Type |
|---|---|---|
| `list_discussions` | List discussion topics for a problem | Read |

### Contests (2)

| Tool | Description | Type |
|---|---|---|
| `get_contest_ranking` | Get contest ranking for a user | Read |
| `get_contest_history` | Get contest participation history | Read |

### Favorites (1)

| Tool | Description | Type |
|---|---|---|
| `list_favorites` | List your favorite problem lists | Read |

## How It Works

This plugin runs inside your LeetCode tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT

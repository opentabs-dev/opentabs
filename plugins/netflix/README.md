# Netflix

OpenTabs plugin for Netflix — gives AI agents access to Netflix through your authenticated browser session.

## Install

```bash
opentabs plugin install netflix
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-netflix
```

## Setup

1. Open [netflix.com](https://www.netflix.com/browse) in Chrome and log in
2. Open the OpenTabs side panel — the Netflix plugin should appear as **ready**

## Tools (18)

### Account (2)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get current Netflix user info | Read |
| `list_profiles` | List all Netflix profiles | Read |

### Browse (9)

| Tool | Description | Type |
|---|---|---|
| `search_titles` | Search Netflix movies and shows | Read |
| `get_title` | Get details for a movie or show | Read |
| `get_title_details` | Get full details including cast and crew | Read |
| `get_seasons` | Get seasons and episodes for a show | Read |
| `list_trending` | Get trending titles on Netflix | Read |
| `list_top_10` | Get Netflix Top 10 titles | Read |
| `list_genre_titles` | Browse titles in a genre category | Read |
| `navigate_to_title` | Open a title page in the browser | Write |
| `navigate_to_genre` | Open a genre page in the browser | Write |

### Library (6)

| Tool | Description | Type |
|---|---|---|
| `list_my_list` | Get titles in My List | Read |
| `add_to_my_list` | Save a title to My List | Write |
| `remove_from_my_list` | Remove a title from My List | Write |
| `list_continue_watching` | Get in-progress titles | Read |
| `get_watch_history` | Get recent viewing history | Read |
| `rate_title` | Rate a movie or show | Write |

### Playback (1)

| Tool | Description | Type |
|---|---|---|
| `play_title` | Start playing a title | Write |

## How It Works

This plugin runs inside your Netflix tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT

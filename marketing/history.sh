#!/usr/bin/env bash
#
# history.sh — tiny helper for reddit-outreach.sh dedup
#
# Claude calls this instead of loading the whole state.json into context.
#
# Usage:
#   history.sh exists <post_id>
#     exits 0 if post_id already in state.json, 1 otherwise
#
#   history.sh add <comment_id> <post_id> <subreddit> <post_title> <comment_text>
#     appends an entry to state.json atomically
#     comment_text is truncated to 200 chars for the preview field
#
# post_id is the Reddit fullname, e.g. "t3_abc123".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/state.json"

usage() {
  echo "usage: history.sh exists <post_id>" >&2
  echo "       history.sh add <comment_id> <post_id> <subreddit> <post_title> <comment_text>" >&2
  exit 2
}

ensure_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo '{"comments_posted":[]}' > "$STATE_FILE"
  fi
}

cmd_exists() {
  local post_id="${1:-}"
  [[ -z "$post_id" ]] && usage
  ensure_state
  if jq -e --arg id "$post_id" '.comments_posted | any(.post_id == $id)' "$STATE_FILE" >/dev/null; then
    exit 0
  else
    exit 1
  fi
}

cmd_add() {
  local comment_id="${1:-}"
  local post_id="${2:-}"
  local subreddit="${3:-}"
  local post_title="${4:-}"
  local comment_text="${5:-}"
  if [[ -z "$comment_id" || -z "$post_id" || -z "$subreddit" || -z "$post_title" || -z "$comment_text" ]]; then
    usage
  fi
  ensure_state

  local posted_at
  posted_at=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

  local tmp
  tmp=$(mktemp "${STATE_FILE}.XXXXXX")
  trap 'rm -f "$tmp"' EXIT

  jq \
    --arg comment_id "$comment_id" \
    --arg post_id "$post_id" \
    --arg subreddit "$subreddit" \
    --arg post_title "$post_title" \
    --arg comment_text "$comment_text" \
    --arg posted_at "$posted_at" \
    '.comments_posted += [{
      comment_id: $comment_id,
      post_id: $post_id,
      subreddit: $subreddit,
      post_title: $post_title,
      comment_preview: ($comment_text | .[0:200]),
      posted_at: $posted_at
    }]' "$STATE_FILE" > "$tmp"

  mv "$tmp" "$STATE_FILE"
  trap - EXIT

  echo "recorded $post_id"
}

case "${1:-}" in
  exists) shift; cmd_exists "$@" ;;
  add)    shift; cmd_add "$@" ;;
  *)      usage ;;
esac

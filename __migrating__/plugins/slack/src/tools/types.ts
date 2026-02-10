// =============================================================================
// Slack Plugin — Shared Tool Types
//
// Type definitions for Slack API responses used across tool modules.
// These types represent the subset of Slack's data model that the plugin
// exposes to AI agents. They are intentionally simplified — only the fields
// that tools actually read are typed; the rest is captured by index signatures
// or left as `unknown`.
// =============================================================================

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

/** A reaction on a Slack message. */
export interface SlackReaction {
  readonly name: string;
  readonly count: number;
  readonly users: readonly string[];
}

/** A file attachment on a Slack message. */
export interface SlackFileAttachment {
  readonly id: string;
  readonly name?: string;
  readonly title?: string;
  readonly mimetype?: string;
  readonly filetype?: string;
  readonly size?: number;
  readonly url_private?: string;
  readonly permalink?: string;
}

/** A Slack message as returned by conversations.history / conversations.replies. */
export interface SlackMessage {
  readonly user?: string;
  readonly text?: string;
  readonly ts: string;
  readonly thread_ts?: string;
  readonly reply_count?: number;
  readonly reactions?: readonly SlackReaction[];
  readonly files?: readonly SlackFileAttachment[];
  readonly subtype?: string;
  readonly bot_id?: string;
  readonly username?: string;
  readonly edited?: { readonly user: string; readonly ts: string };
  readonly attachments?: readonly Record<string, unknown>[];
  readonly blocks?: readonly Record<string, unknown>[];
}

// -----------------------------------------------------------------------------
// Channels
// -----------------------------------------------------------------------------

/** Channel purpose or topic metadata. */
export interface SlackTopicOrPurpose {
  readonly value: string;
  readonly creator: string;
  readonly last_set: number;
}

/** A Slack channel (public or private). */
export interface SlackChannel {
  readonly id: string;
  readonly name: string;
  readonly is_channel?: boolean;
  readonly is_group?: boolean;
  readonly is_im?: boolean;
  readonly is_mpim?: boolean;
  readonly is_private?: boolean;
  readonly is_archived?: boolean;
  readonly is_member?: boolean;
  readonly num_members?: number;
  readonly topic?: SlackTopicOrPurpose;
  readonly purpose?: SlackTopicOrPurpose;
  readonly creator?: string;
  readonly created?: number;
}

// -----------------------------------------------------------------------------
// Users
// -----------------------------------------------------------------------------

/** A Slack user's profile. */
export interface SlackUserProfile {
  readonly real_name?: string;
  readonly display_name?: string;
  readonly email?: string;
  readonly image_72?: string;
  readonly title?: string;
  readonly status_text?: string;
  readonly status_emoji?: string;
  readonly team?: string;
}

/** A Slack user. */
export interface SlackUser {
  readonly id: string;
  readonly name: string;
  readonly real_name?: string;
  readonly deleted?: boolean;
  readonly is_admin?: boolean;
  readonly is_owner?: boolean;
  readonly is_bot?: boolean;
  readonly is_app_user?: boolean;
  readonly profile?: SlackUserProfile;
  readonly tz?: string;
  readonly tz_label?: string;
  readonly updated?: number;
}

// -----------------------------------------------------------------------------
// Files
// -----------------------------------------------------------------------------

/** A Slack file (uploaded or shared). */
export interface SlackFile {
  readonly id: string;
  readonly name: string;
  readonly title?: string;
  readonly mimetype?: string;
  readonly filetype?: string;
  readonly size?: number;
  readonly url_private?: string;
  readonly permalink?: string;
  readonly user?: string;
  readonly created?: number;
  readonly channels?: readonly string[];
  readonly groups?: readonly string[];
  readonly ims?: readonly string[];
  readonly shares?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Search Results
// -----------------------------------------------------------------------------

/** A single search result match from search.messages. */
export interface SlackSearchMatch {
  readonly iid: string;
  readonly text: string;
  readonly ts: string;
  readonly username: string;
  readonly user?: string;
  readonly channel: {
    readonly id: string;
    readonly name: string;
  };
  readonly permalink: string;
  readonly previous?: SlackSearchMatch;
  readonly next?: SlackSearchMatch;
}

/** Paging metadata from Slack search responses. */
export interface SlackSearchPaging {
  readonly count: number;
  readonly total: number;
  readonly page: number;
  readonly pages: number;
}

// -----------------------------------------------------------------------------
// Pins
// -----------------------------------------------------------------------------

/** A pinned item in a Slack channel. */
export interface SlackPinnedItem {
  readonly type: string;
  readonly created: number;
  readonly created_by: string;
  readonly message?: SlackMessage;
  readonly channel?: string;
}

// -----------------------------------------------------------------------------
// Stars
// -----------------------------------------------------------------------------

/** A starred item. */
export interface SlackStarredItem {
  readonly type: string;
  readonly date_create: number;
  readonly message?: SlackMessage;
  readonly file?: SlackFile;
  readonly channel?: string;
}

// -----------------------------------------------------------------------------
// API Response Wrappers
//
// Slack wraps all API responses in an { ok, error?, ...data } envelope.
// These types capture the common response shapes.
// -----------------------------------------------------------------------------

/** Base Slack API response with ok flag and optional error. */
export interface SlackApiResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly warning?: string;
  readonly response_metadata?: {
    readonly next_cursor?: string;
    readonly scopes?: readonly string[];
    readonly warnings?: readonly string[];
  };
}

/** Response from conversations.history / conversations.replies. */
export interface SlackMessagesResponse extends SlackApiResponse {
  readonly messages: readonly SlackMessage[];
  readonly has_more?: boolean;
}

/** Response from conversations.list. */
export interface SlackChannelsResponse extends SlackApiResponse {
  readonly channels: readonly SlackChannel[];
}

/** Response from users.list. */
export interface SlackUsersResponse extends SlackApiResponse {
  readonly members: readonly SlackUser[];
}

/** Response from search.messages. */
export interface SlackSearchResponse extends SlackApiResponse {
  readonly messages: {
    readonly matches: readonly SlackSearchMatch[];
    readonly paging: SlackSearchPaging;
    readonly total: number;
  };
}

/** Response from files.list. */
export interface SlackFilesResponse extends SlackApiResponse {
  readonly files: readonly SlackFile[];
  readonly paging: SlackSearchPaging;
}

/** Response from pins.list. */
export interface SlackPinsResponse extends SlackApiResponse {
  readonly items: readonly SlackPinnedItem[];
}

/** Response from stars.list. */
export interface SlackStarsResponse extends SlackApiResponse {
  readonly items: readonly SlackStarredItem[];
  readonly paging?: SlackSearchPaging;
}

/** Response from reactions.get. */
export interface SlackReactionsResponse extends SlackApiResponse {
  readonly message?: SlackMessage & {
    readonly reactions?: readonly SlackReaction[];
  };
  readonly file?: SlackFile;
}

/** Response from conversations.open (DM). */
export interface SlackOpenDmResponse extends SlackApiResponse {
  readonly channel?: {
    readonly id: string;
  };
}

/** Response from chat.postMessage / chat.update / chat.delete. */
export interface SlackChatResponse extends SlackApiResponse {
  readonly channel?: string;
  readonly ts?: string;
  readonly text?: string;
  readonly message?: SlackMessage;
}

/** Response from conversations.info. */
export interface SlackChannelInfoResponse extends SlackApiResponse {
  readonly channel?: SlackChannel;
}

/** Response from users.info. */
export interface SlackUserInfoResponse extends SlackApiResponse {
  readonly user?: SlackUser;
}

/** Response from users.getPresence. */
export interface SlackPresenceResponse extends SlackApiResponse {
  readonly presence?: string;
  readonly online?: boolean;
  readonly auto_away?: boolean;
  readonly manual_away?: boolean;
  readonly connection_count?: number;
  readonly last_activity?: number;
}

/** Response from files.info. */
export interface SlackFileInfoResponse extends SlackApiResponse {
  readonly file?: SlackFile;
}

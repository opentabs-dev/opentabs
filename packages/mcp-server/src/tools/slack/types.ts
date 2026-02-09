// Slack API response types (shapes returned by Slack Web API)

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  display_name?: string;
  email?: string;
  is_bot?: boolean;
  is_admin?: boolean;
  profile?: {
    display_name?: string;
    real_name?: string;
    email?: string;
    image_48?: string;
    image_72?: string;
  };
}

export interface SlackChannel {
  id: string;
  name: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
  is_member?: boolean;
  topic?: {
    value: string;
  };
  purpose?: {
    value: string;
  };
  num_members?: number;
}

export interface SlackMessage {
  type: string;
  user?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{
    name: string;
    count: number;
    users: string[];
  }>;
  files?: SlackFile[];
}

export interface SlackFile {
  id: string;
  name: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
  permalink?: string;
}

export interface SlackSearchResult {
  messages?: {
    matches: Array<{
      iid: string;
      team: string;
      channel: {
        id: string;
        name: string;
      };
      type: string;
      user: string;
      username: string;
      ts: string;
      text: string;
      permalink: string;
    }>;
    total: number;
  };
  files?: {
    matches: SlackFile[];
    total: number;
  };
}

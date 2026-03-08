import { z } from 'zod';

// --- Shared Helpers ---

interface ImageArtifact {
  width?: number;
  fileIdentifyingUrlPathSegment?: string;
}

/** Build the highest-resolution picture URL from a LinkedIn vector image. */
const buildPictureUrl = (rootUrl?: string, artifacts?: ImageArtifact[]): string => {
  const largest = artifacts?.filter(a => a.width !== undefined).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return rootUrl && largest?.fileIdentifyingUrlPathSegment ? `${rootUrl}${largest.fileIdentifyingUrlPathSegment}` : '';
};

/** Join first and last name into a full name. */
const fullName = (first?: string, last?: string): string => `${first ?? ''} ${last ?? ''}`.trim();

// --- Current User (from /voyager/api/me) ---

export const currentUserSchema = z.object({
  plain_id: z.number().describe('Numeric LinkedIn member ID'),
  first_name: z.string().describe('First name'),
  last_name: z.string().describe('Last name'),
  occupation: z.string().describe('Current headline or occupation'),
  public_identifier: z.string().describe('Public profile slug (e.g., "williamhgates")'),
  profile_urn: z.string().describe('Profile URN (e.g., "urn:li:fsd_profile:...")'),
  profile_picture_url: z.string().describe('Profile picture URL'),
  is_premium: z.boolean().describe('Whether the user has a Premium subscription'),
});

export interface RawMeResponse {
  plainId?: number;
  miniProfile?: {
    firstName?: string;
    lastName?: string;
    occupation?: string;
    publicIdentifier?: string;
    dashEntityUrn?: string;
    entityUrn?: string;
    picture?: {
      'com.linkedin.common.VectorImage'?: {
        rootUrl?: string;
        artifacts?: Array<{
          width?: number;
          fileIdentifyingUrlPathSegment?: string;
        }>;
      };
    };
  };
  premiumSubscriber?: boolean;
}

export const mapCurrentUser = (data: RawMeResponse) => {
  const mini = data.miniProfile;
  const picture = mini?.picture?.['com.linkedin.common.VectorImage'];

  return {
    plain_id: data.plainId ?? 0,
    first_name: mini?.firstName ?? '',
    last_name: mini?.lastName ?? '',
    occupation: mini?.occupation ?? '',
    public_identifier: mini?.publicIdentifier ?? '',
    profile_urn: mini?.dashEntityUrn ?? mini?.entityUrn ?? '',
    profile_picture_url: buildPictureUrl(picture?.rootUrl, picture?.artifacts),
    is_premium: data.premiumSubscriber ?? false,
  };
};

// --- Profile (from /voyager/api/identity/dash/profiles) ---

export const profileSchema = z.object({
  first_name: z.string().describe('First name'),
  last_name: z.string().describe('Last name'),
  headline: z.string().describe('Professional headline'),
  public_identifier: z.string().describe('Public profile slug'),
  profile_urn: z.string().describe('Profile URN'),
  profile_picture_url: z.string().describe('Profile picture URL'),
  location: z.string().describe('Geographic location'),
  country: z.string().describe('Country name'),
  is_premium: z.boolean().describe('Whether the user has a Premium subscription'),
  is_influencer: z.boolean().describe('Whether the user is a LinkedIn influencer'),
  is_creator: z.boolean().describe('Whether the user is a LinkedIn creator'),
});

interface RawProfileElement {
  firstName?: string;
  lastName?: string;
  headline?: string;
  publicIdentifier?: string;
  entityUrn?: string;
  profilePicture?: {
    displayImageReference?: {
      vectorImage?: {
        rootUrl?: string;
        artifacts?: ImageArtifact[];
      };
    };
  };
  geoLocation?: {
    geo?: {
      defaultLocalizedNameWithoutCountryName?: string;
      country?: {
        defaultLocalizedName?: string;
      };
    };
  };
  premium?: boolean;
  influencer?: boolean;
  creator?: boolean;
}

export const mapProfile = (el: RawProfileElement) => {
  const pic = el.profilePicture?.displayImageReference?.vectorImage;

  return {
    first_name: el.firstName ?? '',
    last_name: el.lastName ?? '',
    headline: el.headline ?? '',
    public_identifier: el.publicIdentifier ?? '',
    profile_urn: el.entityUrn ?? '',
    profile_picture_url: buildPictureUrl(pic?.rootUrl, pic?.artifacts),
    location: el.geoLocation?.geo?.defaultLocalizedNameWithoutCountryName ?? '',
    country: el.geoLocation?.geo?.country?.defaultLocalizedName ?? '',
    is_premium: el.premium ?? false,
    is_influencer: el.influencer ?? false,
    is_creator: el.creator ?? false,
  };
};

// --- Messaging: Conversation ---

export const conversationSchema = z.object({
  conversation_urn: z.string().describe('Conversation URN identifier'),
  title: z.string().describe('Conversation title or participant name'),
  last_message_text: z.string().describe('Text of the most recent message'),
  last_message_at: z.number().describe('Timestamp of the last message in milliseconds'),
  is_read: z.boolean().describe('Whether the conversation is read'),
  notification_status: z.string().describe('Notification status (ACTIVE, MUTED, etc.)'),
  participants: z
    .array(
      z.object({
        name: z.string().describe('Participant full name'),
        profile_urn: z.string().describe('Participant profile URN'),
        profile_picture_url: z.string().describe('Participant profile picture URL'),
      }),
    )
    .describe('List of conversation participants'),
});

interface RawParticipant {
  hostIdentityUrn?: string;
  entityUrn?: string;
  participantType?: {
    member?: {
      firstName?: { text?: string };
      lastName?: { text?: string };
      profilePicture?: {
        rootUrl?: string;
        artifacts?: Array<{
          width?: number;
          fileIdentifyingUrlPathSegment?: string;
        }>;
      };
    };
  };
}

interface RawConversation {
  entityUrn?: string;
  conversationTitle?: { text?: string };
  lastMessage?: {
    body?: { text?: string };
    deliveredAt?: number;
  };
  read?: boolean;
  notificationStatus?: string;
  conversationParticipants?: RawParticipant[];
}

const mapParticipant = (p: RawParticipant) => {
  const member = p.participantType?.member;
  const pic = member?.profilePicture;

  return {
    name: fullName(member?.firstName?.text, member?.lastName?.text),
    profile_urn: p.hostIdentityUrn ?? '',
    profile_picture_url: buildPictureUrl(pic?.rootUrl, pic?.artifacts),
  };
};

export const mapConversation = (c: RawConversation) => ({
  conversation_urn: c.entityUrn ?? '',
  title:
    c.conversationTitle?.text ??
    (c.conversationParticipants ?? [])
      .map(p => fullName(p.participantType?.member?.firstName?.text, p.participantType?.member?.lastName?.text))
      .filter(Boolean)
      .join(', '),
  last_message_text: c.lastMessage?.body?.text ?? '',
  last_message_at: c.lastMessage?.deliveredAt ?? 0,
  is_read: c.read ?? false,
  notification_status: c.notificationStatus ?? '',
  participants: (c.conversationParticipants ?? []).map(mapParticipant),
});

// --- Messaging: Message ---

export const messageSchema = z.object({
  message_urn: z.string().describe('Message URN identifier'),
  text: z.string().describe('Message text content'),
  sender_name: z.string().describe('Sender full name'),
  sender_profile_urn: z.string().describe('Sender profile URN'),
  delivered_at: z.number().describe('Delivery timestamp in milliseconds'),
  subject: z.string().describe('Message subject (if any)'),
});

interface RawMessage {
  entityUrn?: string;
  body?: { text?: string };
  sender?: {
    participantType?: {
      member?: {
        firstName?: { text?: string };
        lastName?: { text?: string };
      };
    };
    hostIdentityUrn?: string;
  };
  deliveredAt?: number;
  subject?: { text?: string };
}

export const mapMessage = (m: RawMessage) => ({
  message_urn: m.entityUrn ?? '',
  text: m.body?.text ?? '',
  sender_name: fullName(
    m.sender?.participantType?.member?.firstName?.text,
    m.sender?.participantType?.member?.lastName?.text,
  ),
  sender_profile_urn: m.sender?.hostIdentityUrn ?? '',
  delivered_at: m.deliveredAt ?? 0,
  subject: m.subject?.text ?? '',
});

// --- Mailbox Counts ---

export const mailboxCountSchema = z.object({
  category: z.string().describe('Mailbox category (INBOX, SECONDARY_INBOX, ARCHIVE, SPAM, MESSAGE_REQUEST_PENDING)'),
  unread_count: z.number().describe('Number of unread conversations in this category'),
});

interface RawMailboxCount {
  category?: string;
  unreadConversationCount?: number;
}

export const mapMailboxCount = (c: RawMailboxCount) => ({
  category: c.category ?? '',
  unread_count: c.unreadConversationCount ?? 0,
});

# Slack API Endpoints Reference

This document contains all API methods discovered from the Slack web application JavaScript files. Slack uses a method-based API style where endpoints are called via `/api/{method.name}` pattern.

**Total API Methods Found:** 350+

**API Pattern:** Slack APIs are called via `https://slack.com/api/{method}` or `https://{workspace}.slack.com/api/{method}`

**Note:** All methods are called via POST with form-encoded or JSON body parameters.

---

## Table of Contents

1. [Activity](#activity)
2. [Admin](#admin)
3. [Analytics](#analytics)
4. [API](#api)
5. [Apps](#apps)
6. [Audit](#audit)
7. [Auth](#auth)
8. [Avatars](#avatars)
9. [Blocks](#blocks)
10. [Bookmarks](#bookmarks)
11. [Bots](#bots)
12. [Calendar](#calendar)
13. [Calls](#calls)
14. [Canvases](#canvases)
15. [Channels](#channels)
16. [Chat](#chat)
17. [Client](#client)
18. [Contacts](#contacts)
19. [Conversations](#conversations)
20. [Debug](#debug)
21. [Dialog](#dialog)
22. [Directory](#directory)
23. [DND (Do Not Disturb)](#dnd-do-not-disturb)
24. [Drafts](#drafts)
25. [Email](#email)
26. [Emoji](#emoji)
27. [Enterprise](#enterprise)
28. [Experiments](#experiments)
29. [Feedback](#feedback)
30. [Files](#files)
31. [Functions](#functions)
32. [GIF](#gif)
33. [GraphQL](#graphql)
34. [Groups](#groups)
35. [Help Center](#help-center)
36. [Highlights](#highlights)
37. [Huddles](#huddles)
38. [Icons](#icons)
39. [IM (Direct Messages)](#im-direct-messages)
40. [In-Product Surveys](#in-product-surveys)
41. [Insights](#insights)
42. [Lab](#lab)
43. [Links](#links)
44. [Lists](#lists)
45. [Meetings](#meetings)
46. [Megaphone](#megaphone)
47. [Messages](#messages)
48. [Model](#model)
49. [Moderation](#moderation)
50. [MPIM (Multi-Party IM)](#mpim-multi-party-im)
51. [OAuth](#oauth)
52. [Onboarding](#onboarding)
53. [Permissions](#permissions)
54. [Pins](#pins)
55. [Polls](#polls)
56. [Presence](#presence)
57. [Profiling](#profiling)
58. [Quip](#quip)
59. [Reactions](#reactions)
60. [Records](#records)
61. [Reminders](#reminders)
62. [Retail](#retail)
63. [Rooms](#rooms)
64. [RTM (Real Time Messaging)](#rtm-real-time-messaging)
65. [Saved Items](#saved-items)
66. [Schemaless](#schemaless)
67. [Search](#search)
68. [SFDC (Salesforce)](#sfdc-salesforce)
69. [Sign In](#sign-in)
70. [Sign Up](#sign-up)
71. [Solutions](#solutions)
72. [Stars](#stars)
73. [Subteams](#subteams)
74. [Team](#team)
75. [User Groups](#user-groups)
76. [Users](#users)
77. [Views](#views)
78. [Workflows](#workflows)

---

## Activity

Endpoints for managing activity feed and notifications.

| Method | Description |
|--------|-------------|
| `activity.archive` | Archive activity items |
| `activity.clearAll` | Clear all activity items |
| `activity.feed` | Get activity feed |
| `activity.mark` | Mark activity as read/unread |
| `activity.markAllRead` | Mark all activity as read |
| `activity.markRead` | Mark specific activity as read |
| `activity.markUnread` | Mark specific activity as unread |
| `activity.mentions` | Get @mentions activity |
| `activity.unarchive` | Unarchive activity items |
| `activity.views` | Get activity views |

---

## Admin

Administrative endpoints for workspace and enterprise management.

### Admin - Advisor

| Method | Description |
|--------|-------------|
| `admin.advisor.recommendations.list` | List admin advisor recommendations |

### Admin - Apps

| Method | Description |
|--------|-------------|
| `admin.apps.approve` | Approve an app |
| `admin.apps.approved.list` | List approved apps |
| `admin.apps.bulkApprove` | Bulk approve apps |
| `admin.apps.bulkRestrict` | Bulk restrict apps |
| `admin.apps.cancel` | Cancel app request |
| `admin.apps.certified.list` | List certified apps |
| `admin.apps.installed.list` | List installed apps |
| `admin.apps.requests.list` | List app requests |
| `admin.apps.restrict` | Restrict an app |
| `admin.apps.restricted.list` | List restricted apps |
| `admin.apps.search` | Search apps |
| `admin.apps.teamAccess.getConfig` | Get team app access config |
| `admin.apps.teamAccess.setConfig` | Set team app access config |

### Admin - Canvases

| Method | Description |
|--------|-------------|
| `admin.canvases.publishTemplate` | Publish canvas template |
| `admin.canvases.unpublishTemplate` | Unpublish canvas template |

### Admin - Conversations

| Method | Description |
|--------|-------------|
| `admin.conversations.archive` | Archive conversation (admin) |
| `admin.conversations.convertExternalLimited` | Convert to external limited |
| `admin.conversations.convertToPrivate` | Convert channel to private |
| `admin.conversations.convertToPublic` | Convert channel to public |
| `admin.conversations.delete` | Delete conversation (admin) |
| `admin.conversations.disconnectShared` | Disconnect shared channel |
| `admin.conversations.getConversationPrefs` | Get conversation preferences |
| `admin.conversations.getCustomRetention` | Get custom retention settings |
| `admin.conversations.getTeams` | Get teams for conversation |
| `admin.conversations.invite` | Invite users (admin) |
| `admin.conversations.removeCustomRetention` | Remove custom retention |
| `admin.conversations.search` | Search conversations (admin) |
| `admin.conversations.setConversationPrefs` | Set conversation preferences |
| `admin.conversations.setCustomRetention` | Set custom retention |
| `admin.conversations.setProperties` | Set conversation properties |
| `admin.conversations.setTeams` | Set teams for conversation |
| `admin.conversations.unarchive` | Unarchive conversation |

### Admin - Roles

| Method | Description |
|--------|-------------|
| `admin.roles.addMembers` | Add members to role |
| `admin.roles.entity.listAssignments` | List role entity assignments |
| `admin.roles.getMemberAssignments` | Get member role assignments |
| `admin.roles.getMembershipInfo` | Get role membership info |
| `admin.roles.list` | List roles |
| `admin.roles.listMembers` | List role members |
| `admin.roles.removeMembers` | Remove members from role |
| `admin.roles.removeUsergroup` | Remove usergroup from role |

### Admin - User Groups

| Method | Description |
|--------|-------------|
| `admin.usergroups.addChannels` | Add channels to usergroup |
| `admin.usergroups.listChannels` | List usergroup channels |
| `admin.usergroups.removeChannels` | Remove channels from usergroup |

### Admin - Users

| Method | Description |
|--------|-------------|
| `admin.users.sendEmailToPending` | Send email to pending users |

### Admin - Workflows

| Method | Description |
|--------|-------------|
| `admin.workflows.triggers.types.permissionsWithStepRestrictions.set` | Set workflow permissions |
| `admin.workflows.unpublish` | Unpublish workflow |

---

## Analytics

| Method | Description |
|--------|-------------|
| `analytics.clogData` | Log analytics data |

---

## API

Core API utilities and testing.

| Method | Description |
|--------|-------------|
| `api.benchmark` | API performance benchmark |
| `api.features` | Get API features |
| `api.getFlannelHttpUrl` | Get Flannel HTTP URL |
| `api.statusSite` | Get API status site URL |
| `api.test` | Test API connectivity |

---

## Apps

| Method | Description |
|--------|-------------|
| `apps.limit` | Get apps limit |

---

## Audit

| Method | Description |
|--------|-------------|
| `audit.logs` | Get audit logs |

---

## Auth

Authentication and session management.

| Method | Description |
|--------|-------------|
| `auth.emailToken` | Get email token |
| `auth.enterpriseSignout` | Sign out from enterprise |
| `auth.findTeam` | Find team by domain |
| `auth.loginMagic` | Magic link login |
| `auth.removePendingTeam` | Remove pending team |
| `auth.signin` | Sign in to workspace |
| `auth.signout` | Sign out of workspace |
| `auth.test` | Test authentication |

---

## Avatars

| Method | Description |
|--------|-------------|
| `avatars.crop` | Crop avatar image |
| `avatars.upload` | Upload avatar image |

---

## Blocks

Block Kit interaction endpoints.

| Method | Description |
|--------|-------------|
| `blocks.actions` | Handle block actions |
| `blocks.suggestions` | Get block suggestions |

---

## Bookmarks

Channel bookmarks management.

| Method | Description |
|--------|-------------|
| `bookmarks.add` | Add bookmark to channel |
| `bookmarks.edit` | Edit existing bookmark |
| `bookmarks.list` | List channel bookmarks |
| `bookmarks.preview` | Preview bookmark URL |
| `bookmarks.remove` | Remove bookmark |
| `bookmarks.reorder` | Reorder bookmarks |

---

## Bots

| Method | Description |
|--------|-------------|
| `bots.info` | Get bot information |

---

## Calendar

Calendar integration endpoints.

| Method | Description |
|--------|-------------|
| `calendar.disconnect` | Disconnect calendar |
| `calendar.freebusy` | Get free/busy status |
| `calendar.getConnectedCalendars` | Get connected calendars |
| `calendar.getInstalledCalendars` | Get installed calendar apps |
| `calendar.getNotificationPrefs` | Get calendar notification preferences |
| `calendar.setNotificationPrefs` | Set calendar notification preferences |

---

## Calls

Slack calls and huddles management.

| Method | Description |
|--------|-------------|
| `calls.reject` | Reject incoming call |
| `calls.request` | Request call |

---

## Canvases

Slack Canvases (documents) management.

| Method | Description |
|--------|-------------|
| `canvases.getCannedTemplates` | Get canned canvas templates |
| `canvases.getEmbedToken` | Get canvas embed token |
| `canvases.getTemplates` | Get canvas templates |
| `canvases.listHeaders` | List canvas headers |
| `canvases.notificationSections` | Get notification sections |

---

## Channels

Legacy channel endpoints (use conversations.* for new code).

| Method | Description |
|--------|-------------|
| `channels.insights` | Get channel insights |
| `channels.view` | View channel |

---

## Chat

Message posting and management.

| Method | Description |
|--------|-------------|
| `chat.action` | Perform chat action |
| `chat.attachmentAction` | Handle attachment action |
| `chat.attachmentSuggestion` | Get attachment suggestions |
| `chat.command` | Execute slash command |
| `chat.delete` | Delete message |
| `chat.deleteAttachment` | Delete message attachment |
| `chat.deleteBulkJoinLeave` | Bulk delete join/leave messages |
| `chat.postMessage` | Post message to channel |
| `chat.refreshUnfurl` | Refresh URL unfurl |
| `chat.removeFile` | Remove file from message |
| `chat.removeUnfurlLink` | Remove unfurl link |
| `chat.shareMessage` | Share message to another channel |
| `chat.slugifyUrl` | Create URL slug |
| `chat.unfurlContact` | Unfurl contact in message |
| `chat.unfurlLink` | Unfurl link in message |
| `chat.update` | Update existing message |

---

## Client

Client-specific endpoints for desktop/web app.

| Method | Description |
|--------|-------------|
| `client.appCommands` | Get app commands |
| `client.channels` | Get client channels |
| `client.checkVersion` | Check client version |
| `client.counts` | Get unread counts |
| `client.dms` | Get direct messages |
| `client.extras` | Get client extras |
| `client.gantryBoot` | Client boot sequence |
| `client.getWebSocketURL` | Get WebSocket connection URL |
| `client.init` | Initialize client |
| `client.shouldReload` | Check if client should reload |
| `client.userBoot` | User boot sequence |

---

## Contacts

| Method | Description |
|--------|-------------|
| `contacts.add` | Add contact |
| `contacts.csv` | Export contacts to CSV |

---

## Conversations

Unified channel/DM/group management (replaces channels.*, groups.*, im.*, mpim.*).

| Method | Description |
|--------|-------------|
| `conversations.acceptSharedInvite` | Accept Slack Connect invite |
| `conversations.addTab` | Add tab to conversation |
| `conversations.archive` | Archive conversation |
| `conversations.badgeCount` | Get badge count |
| `conversations.bulkFetchMetadata` | Bulk fetch conversation metadata |
| `conversations.bulkLeave` | Leave multiple conversations |
| `conversations.bulkReacjiTriggers` | Get bulk reacji triggers |
| `conversations.bulkRejoin` | Rejoin multiple conversations |
| `conversations.canCreateSharedInvite` | Check if can create Slack Connect invite |
| `conversations.close` | Close conversation |
| `conversations.convertExternalLimited` | Convert to external limited |
| `conversations.convertToPrivate` | Convert channel to private |
| `conversations.convertToPublic` | Convert channel to public |
| `conversations.coreProdAIPrototype` | AI prototype features |
| `conversations.create` | Create new conversation |
| `conversations.createChild` | Create child conversation |
| `conversations.delete` | Delete conversation |
| `conversations.disconnectShared` | Disconnect shared channel |
| `conversations.export` | Export conversation |
| `conversations.findEligibleWorkspaces` | Find eligible workspaces |
| `conversations.genericInfo` | Get generic conversation info |
| `conversations.getGeneral` | Get #general channel |
| `conversations.getJoinedChannels` | Get joined channels |
| `conversations.getRetention` | Get retention settings |
| `conversations.history` | Get conversation history |
| `conversations.historyChanges` | Get history changes |
| `conversations.ignoreInvite` | Ignore conversation invite |
| `conversations.ignoreUser` | Ignore user in conversation |
| `conversations.info` | Get conversation info |
| `conversations.invite` | Invite users to conversation |
| `conversations.inviteShared` | Invite to Slack Connect channel |
| `conversations.join` | Join conversation |
| `conversations.joinConnectedShared` | Join connected shared channel |
| `conversations.joinContext` | Get join context |
| `conversations.joinPendingShared` | Join pending shared channel |
| `conversations.kick` | Remove user from conversation |
| `conversations.leave` | Leave conversation |
| `conversations.list` | List conversations |
| `conversations.listPrefs` | List conversation preferences |
| `conversations.mark` | Mark conversation as read |
| `conversations.moveTab` | Move conversation tab |
| `conversations.open` | Open/create DM or conversation |
| `conversations.recentSummary` | Get recent summary |
| `conversations.recommend` | Get recommended conversations |
| `conversations.removeSharedLegacyRestriction` | Remove shared legacy restriction |
| `conversations.removeTab` | Remove conversation tab |
| `conversations.rename` | Rename conversation |
| `conversations.replies` | Get thread replies |
| `conversations.revokeSharedInvite` | Revoke Slack Connect invite |
| `conversations.searchLinks` | Search links in conversation |
| `conversations.setInviterJoinerProperties` | Set inviter/joiner properties |
| `conversations.setProperties` | Set conversation properties |
| `conversations.setPurpose` | Set conversation purpose |
| `conversations.setRetention` | Set retention settings |
| `conversations.setTeams` | Set teams for conversation |
| `conversations.setTopic` | Set conversation topic |
| `conversations.sharedInviteAcceptanceEligibility` | Check invite acceptance eligibility |
| `conversations.sharedInviteInfo` | Get shared invite info |
| `conversations.sharedInviteLinkCopied` | Track shared invite link copied |
| `conversations.suggestions` | Get conversation suggestions |
| `conversations.teamConnections` | Get team connections |
| `conversations.unarchive` | Unarchive conversation |
| `conversations.updateDefaultState` | Update default state |
| `conversations.updateTab` | Update conversation tab |
| `conversations.validateName` | Validate conversation name |
| `conversations.view` | View conversation |

---

## Debug

| Method | Description |
|--------|-------------|
| `debug.flushBufferedLog` | Flush buffered logs |
| `debug.setKeepQueryParams` | Set keep query params |

---

## Dialog

Modal dialog interactions.

| Method | Description |
|--------|-------------|
| `dialog.get` | Get dialog |
| `dialog.notifyCancel` | Notify dialog cancelled |
| `dialog.selectSuggestion` | Select dialog suggestion |
| `dialog.submit` | Submit dialog |

---

## Directory

| Method | Description |
|--------|-------------|
| `directory.disconnect` | Disconnect directory |

---

## DND (Do Not Disturb)

| Method | Description |
|--------|-------------|
| `dnd.endDnd` | End do not disturb |
| `dnd.endSnooze` | End snooze |
| `dnd.info` | Get DND info |
| `dnd.setSnooze` | Set snooze |
| `dnd.teamInfo` | Get team DND info |

---

## Drafts

Message draft management.

| Method | Description |
|--------|-------------|
| `drafts.bulkDelete` | Bulk delete drafts |
| `drafts.create` | Create draft |
| `drafts.delete` | Delete draft |
| `drafts.list` | List drafts |
| `drafts.listActive` | List active drafts |
| `drafts.update` | Update draft |

---

## Email

| Method | Description |
|--------|-------------|
| `email.digest` | Email digest settings |

---

## Emoji

Custom emoji management.

| Method | Description |
|--------|-------------|
| `emoji.add` | Add custom emoji |
| `emoji.addCollection` | Add emoji collection |
| `emoji.adminList` | List emoji (admin) |
| `emoji.getInfo` | Get emoji info |
| `emoji.remove` | Remove custom emoji |
| `emoji.removeCollection` | Remove emoji collection |
| `emoji.rename` | Rename custom emoji |

---

## Enterprise

Enterprise Grid management.

| Method | Description |
|--------|-------------|
| `enterprise.info` | Get enterprise info |
| `enterprise.nameTaken` | Check if name is taken |

---

## Experiments

Feature flags and experiments.

| Method | Description |
|--------|-------------|
| `experiments.getByUser` | Get experiments for user |
| `experiments.getConfigById` | Get experiment config by ID |

---

## Feedback

| Method | Description |
|--------|-------------|
| `feedback.submitEnterpriseSearchFeedback` | Submit enterprise search feedback |
| `feedback.submitSalesforceFeedback` | Submit Salesforce feedback |
| `feedback.submitSlackWrappedFeedback` | Submit Slack Wrapped feedback |

---

## Files

File upload and management.

| Method | Description |
|--------|-------------|
| `files.acceptPermissionRequest` | Accept file permission request |
| `files.canSee` | Check if user can see file |
| `files.canShare` | Check if user can share file |
| `files.canUndelete` | Check if file can be undeleted |
| `files.close` | Close file |
| `files.completeUpload` | Complete file upload |
| `files.completeUploadForFileStore` | Complete upload for file store |
| `files.createExternal` | Create external file |
| `files.createSkillCanvas` | Create skill canvas |
| `files.delete` | Delete file |
| `files.disableCrossWorkspaceLinkSharing` | Disable cross-workspace link sharing |
| `files.disableRestrictedSharing` | Disable restricted sharing |
| `files.edit` | Edit file |
| `files.embedWithPermissions` | Embed file with permissions |
| `files.enableCrossWorkspaceLinkSharing` | Enable cross-workspace link sharing |
| `files.enableRestrictedSharing` | Enable restricted sharing |
| `files.generateProviderTokenForFileStore` | Generate provider token |
| `files.generateThumbnails` | Generate file thumbnails |
| `files.getMetadata` | Get file metadata |
| `files.getOverview` | Get file overview |
| `files.getProviderPreviewUrlForFileStore` | Get provider preview URL |
| `files.getShares` | Get file shares |
| `files.getUploadURL` | Get file upload URL |
| `files.getUploadURLForFileStore` | Get upload URL for file store |
| `files.hasShares` | Check if file has shares |
| `files.ignorePermissionRequest` | Ignore permission request |
| `files.importFromExternalURL` | Import from external URL |
| `files.info` | Get file info |
| `files.isAccessRequestedByUser` | Check if access requested |
| `files.list` | List files |
| `files.markRead` | Mark file as read |
| `files.open` | Open file |
| `files.ping` | Ping file |
| `files.readStatus` | Get file read status |
| `files.refresh` | Refresh file |
| `files.requestPermission` | Request file permission |
| `files.retranscribe` | Retranscribe file |
| `files.revokePermission` | Revoke file permission |
| `files.revokePublicURL` | Revoke public URL |
| `files.setExcludeFromSlackAi` | Exclude from Slack AI |
| `files.share` | Share file |
| `files.sharedPublicURL` | Create shared public URL |
| `files.undelete` | Undelete file |
| `files.unlock` | Unlock file |
| `files.unshare` | Unshare file |
| `files.updatePermission` | Update file permission |
| `files.uploadExternal` | Upload external file |

---

## Functions

Workflow functions.

| Method | Description |
|--------|-------------|
| `functions.get` | Get function |
| `functions.list` | List functions |

---

## GIF

| Method | Description |
|--------|-------------|
| `gif.featured` | Get featured GIFs |
| `gif.search` | Search GIFs |

---

## GraphQL

| Method | Description |
|--------|-------------|
| `graphql.resolve` | Resolve GraphQL query |

---

## Groups

Legacy private channel endpoints (use conversations.* for new code).

| Method | Description |
|--------|-------------|
| `groups.view` | View group |

---

## Help Center

| Method | Description |
|--------|-------------|
| `helpcenter.getWhatsNew` | Get what's new |
| `helpdesk.categories` | Get helpdesk categories |
| `helpdesk.get` | Get helpdesk article |
| `helpdesk.getSectionsAndArticlesByCategory` | Get sections and articles |

---

## Highlights

| Method | Description |
|--------|-------------|
| `highlights.list` | List highlights |

---

## Huddles

Audio/video huddles in channels.

| Method | Description |
|--------|-------------|
| `huddles.cancelKnock` | Cancel huddle knock |
| `huddles.get` | Get huddle info |
| `huddles.getIndirectHuddle` | Get indirect huddle |
| `huddles.getTrackUrls` | Get huddle track URLs |
| `huddles.history` | Get huddle history |
| `huddles.knock` | Knock on huddle |
| `huddles.knockResponse` | Respond to knock |
| `huddles.listBackgrounds` | List huddle backgrounds |
| `huddles.readiness` | Check huddle readiness |
| `huddles.update` | Update huddle |

---

## Icons

| Method | Description |
|--------|-------------|
| `icons.image` | Get icon image |

---

## IM (Direct Messages)

Legacy DM endpoints (use conversations.* for new code).

| Method | Description |
|--------|-------------|
| `im.list` | List DMs |
| `im.view` | View DM |

---

## In-Product Surveys

| Method | Description |
|--------|-------------|
| `inprodsurveys.get` | Get in-product survey |

---

## Insights

| Method | Description |
|--------|-------------|
| `insights.messageStats` | Get message statistics |

---

## Lab

Feature lab/experiments.

| Method | Description |
|--------|-------------|
| `lab.features` | Get lab features |

---

## Links

| Method | Description |
|--------|-------------|
| `links.disconnectApps` | Disconnect link apps |
| `links.getDomains` | Get link domains |
| `links.getInterstitialFields` | Get interstitial fields |
| `links.getTransferPayload` | Get transfer payload |

---

## Lists

Slack Lists feature.

| Method | Description |
|--------|-------------|
| `lists.addToList` | Add item to list |
| `lists.create` | Create list |
| `lists.duplicate` | Duplicate list |
| `lists.getOrCreateTaskList` | Get or create task list |
| `lists.import` | Import list |
| `lists.open` | Open list |
| `lists.setupTodos` | Setup todos |
| `lists.templates` | Get list templates |
| `lists.update` | Update list |
| `lists.upsertToTaskList` | Upsert to task list |

---

## Meetings

| Method | Description |
|--------|-------------|
| `meetings.list` | List meetings |
| `meetings.usersetdata` | Set user meeting data |

---

## Megaphone

Notification system.

| Method | Description |
|--------|-------------|
| `megaphone.executeEvent` | Execute megaphone event |
| `megaphone.setNotificationAsSeen` | Mark notification as seen |

---

## Messages

| Method | Description |
|--------|-------------|
| `messages.list` | List messages |

---

## Model

AI/ML model endpoints.

| Method | Description |
|--------|-------------|
| `model.autocomplete` | AI autocomplete |

---

## Moderation

| Method | Description |
|--------|-------------|
| `moderation.removeMessage` | Remove message (moderation) |

---

## MPIM (Multi-Party IM)

Legacy group DM endpoints (use conversations.* for new code).

| Method | Description |
|--------|-------------|
| `mpim.list` | List group DMs |
| `mpim.view` | View group DM |

---

## OAuth

| Method | Description |
|--------|-------------|
| `oauth.access` | OAuth access token |

---

## Onboarding

| Method | Description |
|--------|-------------|
| `onboarding.fetch` | Fetch onboarding data |
| `onboarding.updateTeam` | Update team onboarding |
| `onboarding.updateUser` | Update user onboarding |

---

## Permissions

| Method | Description |
|--------|-------------|
| `permissions.edit` | Edit permissions |

---

## Pins

Pinned messages.

| Method | Description |
|--------|-------------|
| `pins.add` | Pin message |
| `pins.list` | List pinned messages |
| `pins.remove` | Unpin message |

---

## Polls

| Method | Description |
|--------|-------------|
| `polls.create` | Create poll |
| `polls.vote` | Vote on poll |

---

## Presence

User presence status.

| Method | Description |
|--------|-------------|
| `presence.set` | Set presence status |

---

## Profiling

Performance profiling.

| Method | Description |
|--------|-------------|
| `profiling.addJSTrace` | Add JavaScript trace |
| `profiling.addLogging` | Add logging |

---

## Quip

Quip/Canvas integration.

| Method | Description |
|--------|-------------|
| `quip.cloneCanvas` | Clone canvas |
| `quip.codes` | Get Quip codes |
| `quip.getCanvasBulkSectionIdsData` | Get canvas bulk section IDs |
| `quip.getMentions` | Get Quip mentions |
| `quip.lookupFileId` | Lookup file ID |
| `quip.lookupThreadIds` | Lookup thread IDs |
| `quip.unfurl` | Unfurl Quip link |
| `quip.updateRootComment` | Update root comment |

---

## Reactions

Emoji reactions on messages.

| Method | Description |
|--------|-------------|
| `reactions.add` | Add reaction |
| `reactions.get` | Get reactions |
| `reactions.remove` | Remove reaction |

---

## Records

| Method | Description |
|--------|-------------|
| `records.getTeamMembers` | Get team members |
| `records.previewShare` | Preview share |
| `records.share` | Share record |

---

## Reminders

| Method | Description |
|--------|-------------|
| `reminders.addFromMessage` | Add reminder from message |

---

## Retail

Billing and plans.

| Method | Description |
|--------|-------------|
| `retail.cost` | Get cost |
| `retail.getAvailablePlans` | Get available plans |
| `retail.plans` | Get plans |

---

## Rooms

Meeting rooms.

| Method | Description |
|--------|-------------|
| `rooms.getLink` | Get room link |
| `rooms.inviteResponse` | Room invite response |
| `rooms.join` | Join room |
| `rooms.notifyMember` | Notify room member |
| `rooms.request` | Request room |
| `rooms.startTranscription` | Start room transcription |
| `rooms.stopTranscription` | Stop room transcription |

---

## RTM (Real Time Messaging)

WebSocket connection management.

| Method | Description |
|--------|-------------|
| `rtm.shouldReload` | Check if RTM should reload |
| `rtm.start` | Start RTM connection |

---

## Saved Items

| Method | Description |
|--------|-------------|
| `saved.add` | Add saved item |
| `saved.clearCompleted` | Clear completed saved items |
| `saved.delete` | Delete saved item |
| `saved.get` | Get saved item |
| `saved.list` | List saved items |
| `saved.update` | Update saved item |

---

## Schemaless

| Method | Description |
|--------|-------------|
| `schemaless.getClientLock` | Get client lock |

---

## Search

| Method | Description |
|--------|-------------|
| `search.autocomplete` | Search autocomplete |
| `search.delete` | Delete search |
| `search.enterprise` | Enterprise search |
| `search.feedback` | Search feedback |
| `search.inline` | Inline search |
| `search.precache` | Precache search |
| `search.save` | Save search |
| `search.team` | Team search |

---

## SFDC (Salesforce)

Salesforce integration endpoints.

| Method | Description |
|--------|-------------|
| `sfdc.checkUiApiCompatibility` | Check UI API compatibility |
| `sfdc.getContactAvailableFields` | Get contact available fields |
| `sfdc.getContactCSVSample` | Get contact CSV sample |
| `sfdc.getContactDetails` | Get contact details |
| `sfdc.getContactListInfo` | Get contact list info |
| `sfdc.getFrontdoorUrl` | Get frontdoor URL |
| `sfdc.getListViewsV2` | Get list views v2 |
| `sfdc.getObjectFields` | Get object fields |
| `sfdc.getObjectsOfType` | Get objects of type |
| `sfdc.getOwnerChangeOptions` | Get owner change options |
| `sfdc.getPicklistValuesV2` | Get picklist values v2 |
| `sfdc.getRecordLayoutDetails` | Get record layout details |
| `sfdc.getRelatedListRecords` | Get related list records |
| `sfdc.getRelatedLists` | Get related lists |
| `sfdc.getReportAggregates` | Get report aggregates |
| `sfdc.getReportAggregatesMetadata` | Get report aggregates metadata |
| `sfdc.orgInfo` | Get org info |
| `sfdc.searchObjects` | Search objects |
| `sfdc.startCSVImport` | Start CSV import |
| `sfdc.updateRecord` | Update record |
| `sfdc.uploadCSVFile` | Upload CSV file |
| `sfdc.userInfo` | Get user info |

---

## Sign In

| Method | Description |
|--------|-------------|
| `signin.confirmCode` | Confirm sign in code |
| `signin.findWorkspaces` | Find workspaces |

---

## Sign Up

| Method | Description |
|--------|-------------|
| `signup.addLead` | Add signup lead |
| `signup.checkSignupDomains` | Check signup domains |
| `signup.confirmEmail` | Confirm signup email |

---

## Solutions

| Method | Description |
|--------|-------------|
| `solutions.create` | Create solution |
| `solutions.delete` | Delete solution |
| `solutions.get` | Get solution |
| `solutions.getTemplates` | Get solution templates |
| `solutions.list` | List solutions |
| `solutions.update` | Update solution |

---

## Stars

Starred items (legacy, use saved.* for new code).

| Method | Description |
|--------|-------------|
| `stars.add` | Star item |
| `stars.list` | List starred items |
| `stars.remove` | Unstar item |

---

## Subteams

User groups/subteams.

| Method | Description |
|--------|-------------|
| `subteams.info` | Get subteam info |
| `subteams.validateHandle` | Validate subteam handle |
| `subteams.validateName` | Validate subteam name |

---

## Team

Workspace/team management.

| Method | Description |
|--------|-------------|
| `team.changeInfo` | Change team info |
| `team.checkEmailDomains` | Check email domains |
| `team.counts` | Get team counts |
| `team.info` | Get team info |
| `team.listExternal` | List external teams |
| `team.newHires` | Get new hires |
| `team.targetingCriteria` | Get targeting criteria |

---

## User Groups

| Method | Description |
|--------|-------------|
| `usergroups.create` | Create user group |
| `usergroups.membership` | Get user group membership |
| `usergroups.search` | Search user groups |
| `usergroups.update` | Update user group |

---

## Users

User management.

| Method | Description |
|--------|-------------|
| `users.deletePhoto` | Delete user photo |
| `users.getDefaultWorkspace` | Get default workspace |
| `users.getInviter` | Get user inviter |
| `users.info` | Get user info |
| `users.isEarlyJoiner` | Check if early joiner |
| `users.list` | List users |
| `users.listIgnoredUsers` | List ignored users |
| `users.markAllRead` | Mark all as read |
| `users.preparePhoto` | Prepare photo upload |
| `users.recommend` | Get user recommendations |
| `users.removeUserBlock` | Remove user block |
| `users.setPhoto` | Set user photo |
| `users.stateMachine` | User state machine |

---

## Views

Modal/view interactions.

| Method | Description |
|--------|-------------|
| `views.close` | Close view |
| `views.get` | Get view |
| `views.submit` | Submit view |

---

## Workflows

Workflow Builder automation.

| Method | Description |
|--------|-------------|
| `workflows.createFromTemplate` | Create workflow from template |
| `workflows.import` | Import workflow |
| `workflows.info` | Get workflow info |

---

## HTTP Endpoints

In addition to the method-based API, these traditional REST endpoints are also used:

| Endpoint | Description |
|----------|-------------|
| `/api/` | API root |
| `/api/api.test` | Test API connectivity |
| `/api/chat.postMessage` | Post message |
| `/api/client.checkVersion` | Check client version |
| `/api/desktop.latestRelease` | Get latest desktop release |
| `/api/v1/chat` | Chat v1 API |
| `/api/v1/downloadchatfile/` | Download chat file |
| `/api/v1/images` | Images API |
| `/api/v1/voice/websocket-proxy` | Voice WebSocket proxy |

---

## Notes

1. **API Pattern**: Slack uses a method-based API where all calls go to `/api/{method.name}`. For example, `conversations.list` is called via `POST /api/conversations.list`.

2. **Authentication**: All API calls require authentication via:
   - OAuth tokens (for apps)
   - Session cookies (for web client)
   - `xoxc-` tokens with `xoxd-` cookies

3. **Request Format**: Most endpoints accept:
   - `application/x-www-form-urlencoded`
   - `application/json`
   - `multipart/form-data` (for file uploads)

4. **Response Format**: All responses are JSON with an `ok` boolean field indicating success.

5. **Rate Limiting**: Slack applies rate limits per method and per workspace. Check response headers for rate limit info.

6. **Legacy Methods**: Methods prefixed with `channels.*`, `groups.*`, `im.*`, and `mpim.*` are legacy. Use `conversations.*` for new implementations.

7. **Admin Methods**: Methods prefixed with `admin.*` require admin or owner permissions.

8. **Enterprise Grid**: Some methods are only available on Enterprise Grid plans.

---

*Document generated from Slack web application JavaScript analysis*
*Total API methods: 350+*

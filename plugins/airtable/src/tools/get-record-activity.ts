import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../airtable-api.js';

interface RawActivityInfo {
  createdTime?: string;
  originatingUserId?: string;
  diffRowHtml?: string;
  groupType?: string;
}

interface RawUser {
  id?: string;
  name?: string;
  email?: string;
}

interface RawComment {
  id?: string;
  userId?: string;
  text?: string;
  createdTime?: string;
}

interface ActivityResult {
  orderedActivityAndCommentIds?: string[];
  rowActivityInfoById?: { [key: string]: RawActivityInfo };
  rowActivityOrCommentUserObjById?: { [key: string]: RawUser };
  commentsById?: { [key: string]: RawComment };
}

const stripHtml = (html: string): string => {
  let result = html;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/<[^>]+>/g, '');
  } while (result !== prev);
  return result.trim();
};

const activitySchema = z.object({
  id: z.string().describe('Activity ID'),
  type: z.string().describe('Activity type (e.g., cellUpdate, rowCreated)'),
  user_id: z.string().describe('User ID who performed the action'),
  user_name: z.string().describe('User display name'),
  timestamp: z.string().describe('ISO 8601 timestamp'),
  description: z.string().describe('Human-readable description of the change'),
});

export const getRecordActivity = defineTool({
  name: 'get_record_activity',
  displayName: 'Get Record Activity',
  description:
    'Get the activity history and comments for a record. Returns a chronological list of changes (cell updates, record creation, comments, etc.) with user attribution.',
  summary: 'Get activity history and comments for a record',
  icon: 'history',
  group: 'Records',
  input: z.object({
    base_id: z.string().describe('Base ID (app prefix)'),
    table_id: z.string().describe('Table ID (tbl prefix)'),
    record_id: z.string().describe('Record ID (rec prefix)'),
  }),
  output: z.object({
    activities: z.array(activitySchema).describe('Activity history for the record'),
    comments: z
      .array(
        z.object({
          id: z.string().describe('Comment ID'),
          author_name: z.string().describe('Comment author name'),
          text: z.string().describe('Comment text'),
          created_time: z.string().describe('ISO 8601 creation timestamp'),
        }),
      )
      .describe('Comments on the record'),
  }),
  handle: async params => {
    const data = await apiGet<ActivityResult>(
      `row/${params.record_id}/readRowActivitiesAndComments`,
      { tableId: params.table_id },
      { appId: params.base_id },
    );

    const users = data.rowActivityOrCommentUserObjById ?? {};
    const activityInfos = data.rowActivityInfoById ?? {};
    const orderedIds = data.orderedActivityAndCommentIds ?? [];

    const activities = orderedIds
      .filter(id => activityInfos[id] !== undefined)
      .map(id => {
        const info = activityInfos[id] as RawActivityInfo;
        const userId = info.originatingUserId ?? '';
        const user = (users[userId] as RawUser | undefined) ?? {};
        return {
          id,
          type: info.groupType ?? '',
          user_id: userId,
          user_name: user.name ?? '',
          timestamp: info.createdTime ?? '',
          description: stripHtml(info.diffRowHtml ?? ''),
        };
      });

    const commentRecords = data.commentsById ?? {};
    const comments = orderedIds
      .filter(id => commentRecords[id] !== undefined)
      .map(id => {
        const c = commentRecords[id] as RawComment;
        const commentUserId = c.userId ?? '';
        const commentUser = (users[commentUserId] as RawUser | undefined) ?? {};
        return {
          id,
          author_name: commentUser.name ?? '',
          text: c.text ?? '',
          created_time: c.createdTime ?? '',
        };
      });

    return { activities, comments };
  },
});

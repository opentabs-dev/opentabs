import { ToolError, retry } from '@opentabs-dev/plugin-sdk';
import { getOperationId, graphql } from './github-api.js';
import type { RawRelatedIssue } from './tools/schemas.js';

const SECONDARY_VIEW_OPERATION = 'IssueViewerSecondaryViewQuery';
const RELATIONSHIPS_OPERATION = 'DependenciesPickerRelationshipsQuery';
const ADD_RELATION_OPERATION = 'addRelatesToMutation';
const REMOVE_RELATION_OPERATION = 'removeRelatesToMutation';

export interface IssueLocator {
  owner: string;
  repo: string;
  issueNumber: number;
}

interface IssueRelationQueryResult {
  repository?: {
    issue?: {
      id?: string;
      topRelatesTo?: {
        totalCount?: number;
        nodes?: RawRelatedIssue[];
        pageInfo?: { hasNextPage?: boolean };
      };
    } | null;
  } | null;
}

interface RelationshipIdsResult {
  node?: {
    id?: string;
    relatesTo?: { nodes?: Array<{ id?: string }> };
  } | null;
}

export interface IssueRelationState {
  issueId: string;
  relatedIssues: RawRelatedIssue[];
  totalCount: number;
  hasMore: boolean;
}

const issuePath = (issue: IssueLocator): string => `/${issue.owner}/${issue.repo}/issues/${issue.issueNumber}`;

const issueLabel = (issue: IssueLocator): string => `${issue.owner}/${issue.repo}#${issue.issueNumber}`;

export const getIssueRelationState = async (issue: IssueLocator): Promise<IssueRelationState> => {
  const path = issuePath(issue);
  const queryId = await getOperationId(SECONDARY_VIEW_OPERATION, path);
  const data = await graphql<IssueRelationQueryResult>(
    queryId,
    {
      markAsRead: false,
      number: issue.issueNumber,
      owner: issue.owner,
      repo: issue.repo,
    },
    SECONDARY_VIEW_OPERATION,
  );

  const result = data?.repository?.issue;
  if (!result?.id) throw ToolError.notFound(`Issue ${issueLabel(issue)} was not found`);

  const relatedIssues = result.topRelatesTo?.nodes ?? [];
  const totalCount = result.topRelatesTo?.totalCount ?? relatedIssues.length;

  return {
    issueId: result.id,
    relatedIssues,
    totalCount,
    hasMore: result.topRelatesTo?.pageInfo?.hasNextPage ?? totalCount > relatedIssues.length,
  };
};

const getRelatedIssueIds = async (issueId: string, discoveryPath: string): Promise<Set<string>> => {
  const queryId = await getOperationId(RELATIONSHIPS_OPERATION, discoveryPath);
  const data = await graphql<RelationshipIdsResult>(queryId, { id: issueId }, RELATIONSHIPS_OPERATION);

  if (!data?.node?.id) throw ToolError.notFound(`Issue node ${issueId} was not found`);

  return new Set(
    (data.node.relatesTo?.nodes ?? []).map(related => related.id ?? '').filter((id): id is string => id.length > 0),
  );
};

const mutateRelatedIssue = async (source: IssueLocator, related: IssueLocator, shouldExist: boolean): Promise<void> => {
  const sourceState = await getIssueRelationState(source);
  const relatedState = await getIssueRelationState(related);
  if (sourceState.issueId === relatedState.issueId) {
    throw ToolError.validation('An issue cannot relate to itself');
  }

  const discoveryPath = issuePath(source);
  const before = await getRelatedIssueIds(sourceState.issueId, discoveryPath);
  if (before.has(relatedState.issueId) === shouldExist) return;

  const operationName = shouldExist ? ADD_RELATION_OPERATION : REMOVE_RELATION_OPERATION;
  const mutationId = await getOperationId(operationName, discoveryPath);
  await graphql(
    mutationId,
    {
      input: {
        issueId: sourceState.issueId,
        relatedIssueId: relatedState.issueId,
      },
    },
    operationName,
  );

  await retry(
    async () => {
      const after = await getRelatedIssueIds(sourceState.issueId, discoveryPath);
      if (after.has(relatedState.issueId) !== shouldExist) {
        throw ToolError.internal(
          `GitHub accepted the ${shouldExist ? 'add' : 'remove'} relation mutation but the change is not visible yet`,
        );
      }
    },
    { maxAttempts: 3, delay: 250 },
  );
};

export const addRelatedIssue = (source: IssueLocator, related: IssueLocator): Promise<void> =>
  mutateRelatedIssue(source, related, true);

export const removeRelatedIssue = (source: IssueLocator, related: IssueLocator): Promise<void> =>
  mutateRelatedIssue(source, related, false);

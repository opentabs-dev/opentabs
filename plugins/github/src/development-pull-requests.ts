import { ToolError, retry } from '@opentabs-dev/plugin-sdk';
import { getEndpointQueryId, getOperationId, graphql, pageJson } from './github-api.js';
import { getIssueRelationState, type IssueLocator } from './issue-relations.js';

const DEVELOPMENT_QUERY = 'ClosedByPullRequestsReferencesQuery';
const LINK_PULL_REQUESTS_MUTATION = 'linkPullRequestsMutation';
const PICKER_SEARCH_ENDPOINT = 'pull_request_and_branch_picker_search';
const DEVELOPMENT_QUERY_LIMIT = 10;

export interface PullRequestLocator {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface RawDevelopmentPullRequest {
  __typename?: string;
  id?: string;
  title?: string;
  number?: number;
  merged?: boolean;
  closed?: boolean;
  isDraft?: boolean;
  state?: string;
  repository?: {
    name?: string;
    nameWithOwner?: string;
    owner?: { login?: string };
  };
  url?: string;
}

interface DevelopmentQueryResult {
  node?: {
    id?: string;
    closedByPullRequestsReferences?: {
      edges?: Array<{ node?: RawDevelopmentPullRequest | null } | null>;
    };
  } | null;
}

interface PullRequestPickerSearchResult {
  data?: {
    resource?: RawDevelopmentPullRequest | null;
  };
  errors?: Array<{ message?: string }>;
}

export interface DevelopmentPullRequestState {
  issueId: string;
  pullRequests: RawDevelopmentPullRequest[];
}

const issuePath = (issue: IssueLocator): string => `/${issue.owner}/${issue.repo}/issues/${issue.issueNumber}`;

const issueLabel = (issue: IssueLocator): string => `${issue.owner}/${issue.repo}#${issue.issueNumber}`;

const pullRequestLabel = (pullRequest: PullRequestLocator): string =>
  `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.pullNumber}`;

const isPullRequest = (value: RawDevelopmentPullRequest | null | undefined): value is RawDevelopmentPullRequest =>
  typeof value?.id === 'string' && value.id.length > 0 && typeof value.number === 'number';

const isActivePullRequest = (pullRequest: RawDevelopmentPullRequest): boolean =>
  !pullRequest.closed && !pullRequest.merged && pullRequest.state !== 'CLOSED' && pullRequest.state !== 'MERGED';

export const getDevelopmentPullRequestState = async (issue: IssueLocator): Promise<DevelopmentPullRequestState> => {
  const issueState = await getIssueRelationState(issue);
  const path = issuePath(issue);
  const queryId = await getOperationId(DEVELOPMENT_QUERY, path);
  const data = await graphql<DevelopmentQueryResult>(queryId, { id: issueState.issueId }, DEVELOPMENT_QUERY);

  if (!data?.node?.id) throw ToolError.notFound(`Issue ${issueLabel(issue)} was not found`);

  return {
    issueId: data.node.id,
    pullRequests: (data.node.closedByPullRequestsReferences?.edges ?? []).map(edge => edge?.node).filter(isPullRequest),
  };
};

const resolvePullRequest = async (
  issue: IssueLocator,
  pullRequest: PullRequestLocator,
): Promise<RawDevelopmentPullRequest> => {
  const path = issuePath(issue);
  const queryId = await getEndpointQueryId(PICKER_SEARCH_ENDPOINT, path);
  const pullRequestUrl = `https://github.com/${pullRequest.owner}/${pullRequest.repo}/pull/${pullRequest.pullNumber}`;
  const searchBase = `is:pr repo:${pullRequest.owner}/${pullRequest.repo}`;
  const searchSuffix = `${pullRequestUrl} sort:created-desc`;
  const result = await pageJson<PullRequestPickerSearchResult>(`${path}/${PICKER_SEARCH_ENDPOINT}`, {
    commenters: `${searchBase} commenter:@me ${searchSuffix}`,
    mentions: `${searchBase} mentions:@me ${searchSuffix}`,
    assignee: `${searchBase} assignee:@me ${searchSuffix}`,
    author: `${searchBase} author:@me ${searchSuffix}`,
    open: `${searchBase} state:open ${searchSuffix}`,
    resource: pullRequestUrl,
    queryIsUrl: true,
    queryId,
  });

  if (result.errors?.length) {
    throw ToolError.internal(
      `GitHub Development picker error: ${result.errors[0]?.message ?? JSON.stringify(result.errors)}`,
    );
  }

  const resolved = result.data?.resource;
  const resolvedOwner = resolved?.repository?.owner?.login;
  const resolvedRepo = resolved?.repository?.name;
  if (
    !isPullRequest(resolved) ||
    resolved.__typename !== 'PullRequest' ||
    resolved.number !== pullRequest.pullNumber ||
    resolvedOwner?.toLowerCase() !== pullRequest.owner.toLowerCase() ||
    resolvedRepo?.toLowerCase() !== pullRequest.repo.toLowerCase()
  ) {
    throw ToolError.notFound(`Pull request ${pullRequestLabel(pullRequest)} was not found`);
  }

  return resolved;
};

const mutateDevelopmentPullRequest = async (
  issue: IssueLocator,
  pullRequest: PullRequestLocator,
  shouldExist: boolean,
): Promise<void> => {
  const target = await resolvePullRequest(issue, pullRequest);
  const before = await getDevelopmentPullRequestState(issue);
  const exists = before.pullRequests.some(current => current.id === target.id);
  if (exists === shouldExist) return;

  if (before.pullRequests.length >= DEVELOPMENT_QUERY_LIMIT) {
    throw ToolError.validation(
      `GitHub returned ${DEVELOPMENT_QUERY_LIMIT} Development pull requests; refusing to replace a potentially truncated selection`,
    );
  }

  const activeIds = before.pullRequests.filter(isActivePullRequest).map(current => current.id as string);
  const linkingIds = shouldExist ? [...activeIds, target.id as string] : activeIds.filter(id => id !== target.id);
  const path = issuePath(issue);
  const mutationId = await getOperationId(LINK_PULL_REQUESTS_MUTATION, path);

  await graphql(
    mutationId,
    {
      baseIssueOrPullRequestId: before.issueId,
      linkingIds,
    },
    LINK_PULL_REQUESTS_MUTATION,
  );

  await retry(
    async () => {
      const after = await getDevelopmentPullRequestState(issue);
      const persisted = after.pullRequests.some(current => current.id === target.id);
      if (persisted !== shouldExist) {
        throw ToolError.internal(
          `GitHub accepted the Development update but pull request ${pullRequestLabel(pullRequest)} is not ${
            shouldExist ? 'linked' : 'unlinked'
          } yet`,
        );
      }
    },
    { maxAttempts: 3, delay: 250 },
  );
};

export const linkDevelopmentPullRequest = (issue: IssueLocator, pullRequest: PullRequestLocator): Promise<void> =>
  mutateDevelopmentPullRequest(issue, pullRequest, true);

export const unlinkDevelopmentPullRequest = (issue: IssueLocator, pullRequest: PullRequestLocator): Promise<void> =>
  mutateDevelopmentPullRequest(issue, pullRequest, false);

# Retool API Endpoints Reference

This document contains all API endpoints discovered from the Retool web application JavaScript files. These endpoints are used by the Retool frontend to communicate with the backend during user sessions.

**Total Endpoints Found:** 233+ static endpoints + dynamic template patterns

**Note:** Path parameters are indicated with `:paramName` syntax (e.g., `:pageUuid`) following Express.js conventions, or `${variable}` for template literals.

---

## Table of Contents

1. [Agents (AI Agents)](#agents-ai-agents)
2. [App Observability](#app-observability)
3. [Authentication](#authentication)
4. [Branches & Source Control](#branches--source-control)
5. [Blueprints](#blueprints)
6. [Configuration Variables](#configuration-variables)
7. [Custom Components](#custom-components)
8. [Embedded Apps](#embedded-apps)
9. [Environments](#environments)
10. [Experiments](#experiments)
11. [Files & Blobs](#files--blobs)
12. [Folders](#folders)
13. [Grid (Retool Database)](#grid-retool-database)
14. [Language Configuration](#language-configuration)
15. [Onboarding & Tours](#onboarding--tours)
16. [Organization & Admin](#organization--admin)
17. [Pages (Apps)](#pages-apps)
18. [Permissions](#permissions)
19. [Playground](#playground)
20. [Public Apps](#public-apps)
21. [Releases](#releases)
22. [Resources (Data Sources)](#resources-data-sources)
23. [Secrets Manager](#secrets-manager)
24. [Templates](#templates)
25. [User Management](#user-management)
26. [User Tasks (HITL)](#user-tasks-hitl)
27. [Vectors (AI/RAG)](#vectors-airag)
28. [Workflows](#workflows)
29. [Workflow Runs](#workflow-runs)
30. [Workflow Triggers](#workflow-triggers)

---

## Agents (AI Agents)

Endpoints for managing Retool AI Agents, including agent configuration, threads, datasets, and runs.

| Endpoint | Description |
|----------|-------------|
| `/api/agents` | List all AI agents |
| `/api/agents/:agentId` | Get/update/delete specific agent |
| `/api/agents/:agentId/:branchId/getCurrentAndLastCommitSave` | Get current and last commit save for agent |
| `/api/agents/:agentId/datasets` | List agent datasets for evaluation |
| `/api/agents/:agentId/datasets/:datasetId` | Get specific agent dataset |
| `/api/agents/:agentId/datasets/:datasetId/runs` | Get dataset evaluation runs |
| `/api/agents/:agentId/datasets/:datasetId/testCases` | List test cases in dataset |
| `/api/agents/:agentId/datasets/:datasetId/testCases/:testCaseLogicalId` | Get specific test case |
| `/api/agents/:agentId/logs` | Get agent execution logs |
| `/api/agents/:agentId/logs/:runId` | Get logs for specific run |
| `/api/agents/:agentId/runs` | List agent runs |
| `/api/agents/:agentId/runs/:runId` | Get specific agent run |
| `/api/agents/:agentId/threads` | List agent conversation threads |
| `/api/agents/:agentId/threads/:threadId` | Get specific thread |
| `/api/agents/:agentId/threads/:threadId/getMessagesCodeExecutor` | Get code executor messages |
| `/api/agents/:agentId/threads/:threadId/messages` | Get/send thread messages |
| `/api/agents/:agentId/threads/:threadId/messages/setAgentMessageResult` | Set agent message result |
| `/api/agents/:agentId/threads/:threadId/publish` | Publish thread |
| `/api/agents/:agentId/threads/:threadId/retry` | Retry thread execution |
| `/api/agents/:agentId/threads/:threadId/unpublish` | Unpublish thread |
| `/api/agents/agentsMetadata` | Get metadata for all agents |
| `/api/agents/bulkUnpublishThreads` | Bulk unpublish multiple threads |
| `/api/agents/submitApproval` | Submit approval for agent action |
| `/api/agents/submitAuth` | Submit authentication for agent |
| `/api/agents/templates/createFromTemplate` | Create agent from template |
| `/api/agents/templates/metadata` | Get agent template metadata |
| `/api/agents/terminate` | Terminate running agent |

---

## App Observability

Endpoints for application performance monitoring, analytics, and error tracking.

| Endpoint | Description |
|----------|-------------|
| `/api/appObservability/analytics/config` | Get/set analytics configuration |
| `/api/appObservability/analytics/config/:configId` | Manage specific analytics config |
| `/api/appObservability/analytics/provider/:provider/config` | Provider-specific analytics config |
| `/api/appObservability/checkEnabled` | Check if observability is enabled |
| `/api/appObservability/errors` | Get application errors |
| `/api/appObservability/performanceMonitoring/config` | Performance monitoring configuration |
| `/api/appObservability/performanceMonitoring/config/:configId` | Specific performance config |
| `/api/appObservability/performanceMonitoring/provider/:provider/config` | Provider-specific performance config |
| `/api/appObservability/performanceMonitoring/traces` | Get performance traces |

---

## Authentication

Endpoints for user authentication, session management, and SSO.

| Endpoint | Description |
|----------|-------------|
| `/api/auth/signin` | Sign in to Retool |
| `/api/claimInvitation` | Claim user invitation |
| `/api/logout` | Log out current user |
| `/api/obtainAuthorizationToken` | Obtain authorization token |
| `/api/refreshtoken` | Refresh authentication token |
| `/api/saml/login` | SAML SSO login |

---

## Branches & Source Control

Endpoints for Git-like branching and source control features.

| Endpoint | Description |
|----------|-------------|
| `/api/branches` | List all branches |
| `/api/branches/:branchId` | Get specific branch |
| `/api/branches/:branchId/rename` | Rename branch |
| `/api/branches/getCommitsOnBranch` | Get commits on a branch |
| `/api/branches/getCommitsOnBranch?branchName=:name` | Get commits by branch name |
| `/api/branches/hotfix` | Create hotfix branch |
| `/api/commits/withBranchInfo` | Get commits with branch information |
| `/api/sourceControl/fetchDependencies` | Fetch source control dependencies |
| `/api/sourceControl/providerConfig/` | Source control provider configuration |
| `/api/sourceControl/pushProtectQuery` | Push protect query to remote |
| `/api/sourceControl/pushUnprotectQuery` | Push unprotect query to remote |
| `/api/sourceControl/remoteBranchContainsElements` | Check if remote branch contains elements |
| `/api/sourceControl/settings` | Source control settings |
| `/api/sourceControl/:scId/checkPRMerged` | Check if PR is merged |
| `/api/sourceControl/:scId/getPullRequest` | Get pull request details |

---

## Blueprints

Endpoints for Retool Blueprints (pre-built app templates).

| Endpoint | Description |
|----------|-------------|
| `/api/blueprints/:blueprintId/install` | Install a blueprint |

---

## Configuration Variables

Endpoints for managing environment configuration variables.

| Endpoint | Description |
|----------|-------------|
| `/api/configVars` | List all configuration variables |
| `/api/configVars/:configVarUuid` | Get/update specific config variable |
| `/api/configVars/apps` | Get config vars used by apps |

---

## Custom Components

Endpoints for managing custom component libraries.

| Endpoint | Description |
|----------|-------------|
| `/api/customComponentCollections/:collectionId/revisions/:revisionId/files` | Get custom component files |
| `/api/internal/customComponentCollections` | Internal custom component collections |
| `/api/internal/customComponentCollections/:customComponentLibraryUuid` | Specific custom component library |
| `/api/public/:appId/customComponentCollections/` | Public app custom components |
| `/api/public/:appId/customComponentCollections/:collectionId/revisions/:revisionId/files` | Public app component files |

---

## Embedded Apps

Endpoints for embedded Retool applications.

| Endpoint | Description |
|----------|-------------|
| `/api/embedded/:appId/query` | Execute query in embedded app |
| `/api/embedded/:appId/runWorkflowFromRetoolApp` | Run workflow from embedded app |

---

## Environments

Endpoints for managing deployment environments.

| Endpoint | Description |
|----------|-------------|
| `/api/environments` | List all environments |

---

## Experiments

Endpoints for feature flags and experiments.

| Endpoint | Description |
|----------|-------------|
| `/api/experiments` | Get all experiments/feature flags |
| `/api/user/experiments` | Get user-specific experiments |
| `/api/organization/admin/experiments` | Admin experiments management |
| `/api/organization/admin/experiments/` | Admin experiments list |
| `/api/organization/admin/experiments/:experimentId` | Toggle specific experiment |
| `/api/organization/admin/experiments/retoolAI` | Retool AI experiment settings |

---

## Files & Blobs

Endpoints for file upload and blob storage.

| Endpoint | Description |
|----------|-------------|
| `/api/file/:fileId` | Get specific file |
| `/api/files` | List/upload files |
| `/api/imageProxy` | Proxy external images |
| `/api/organization/blobs` | List organization blobs |
| `/api/organization/blobs/:blobId` | Get/delete specific blob |
| `/api/organization/themeImages` | Theme image management |
| `/api/public/:appId/files/:fileId` | Get file from public app |
| `/api/public/:appId/files/upload` | Upload file to public app |

---

## Folders

Endpoints for organizing apps and workflows into folders.

| Endpoint | Description |
|----------|-------------|
| `/api/folders/:folderId/contents` | Get folder contents |
| `/api/folders/bulkDeleteWorkflows` | Bulk delete workflows from folder |
| `/api/folders/bulkMoveWorkflows` | Bulk move workflows between folders |
| `/api/folders/createFolder` | Create new folder |
| `/api/folders/deleteFolder` | Delete folder |
| `/api/folders/favorite/:folderId` | Favorite/unfavorite folder |
| `/api/folders/moveWorkflow` | Move single workflow to folder |
| `/api/folders/renameFolder` | Rename folder |
| `/api/folders/trash` | View trashed items |
| `/api/folders/trash/bulkDelete` | Permanently delete trashed items |

---

## Grid (Retool Database)

Endpoints for Retool Database operations.

| Endpoint | Description |
|----------|-------------|
| `/api/grid` | Grid operations |
| `/api/grid/:gridId/import` | Import data into grid |
| `/api/grid/:gridId/table/:tableName/data?includeJSON` | Get table data with JSON |

---

## Language Configuration

Endpoints for Python/JavaScript runtime configuration.

| Endpoint | Description |
|----------|-------------|
| `/api/languageConfig` | Get language configuration |
| `/api/languageConfig/:languageId` | Get specific language config |
| `/api/languageConfig/buildEnvironmentAsync/:envId` | Build language environment async |
| `/api/languageConfig/queryEnvironmentStatus/:envId` | Query environment build status |
| `/api/languageConfig/typesheds/:languageId` | Get type hints/typesheds |

---

## Onboarding & Tours

Endpoints for user onboarding and guided tours.

| Endpoint | Description |
|----------|-------------|
| `/api/guidedTour/complete` | Mark guided tour as complete |
| `/api/hasViewed/:itemId` | Check if user has viewed item |
| `/api/hasViewed/:itemId/dismiss` | Dismiss viewed item notification |
| `/api/onboarding/dismissTutorialCTA` | Dismiss tutorial call-to-action |

---

## Organization & Admin

Endpoints for organization management and administration.

| Endpoint | Description |
|----------|-------------|
| `/api/organization/admin` | Organization admin settings |
| `/api/organization/admin/` | Organization admin dashboard |
| `/api/organization/admin/adminDomains` | Manage admin domains |
| `/api/organization/admin/bulkInviteUsers` | Bulk invite users |
| `/api/organization/admin/checkSubdomainAvailability?subdomain=:name` | Check subdomain availability |
| `/api/organization/admin/libraries` | Manage JavaScript libraries |
| `/api/organization/admin/optInExternal` | Opt in to external features |
| `/api/organization/admin/optOutExternal` | Opt out of external features |
| `/api/organization/admin/refreshLicense` | Refresh organization license |
| `/api/organization/admin/spaces/enable` | Enable Spaces feature |
| `/api/organization/admin/spaces/status` | Get Spaces status |
| `/api/organization/admin/updateOrganizationTheme` | Update organization theme |
| `/api/organization/admin/userInviteSuggestions/:groupId/:query` | Get user invite suggestions |
| `/api/organization/appTheme` | List app themes |
| `/api/organization/appTheme/:themeId` | Get specific app theme |
| `/api/organization/appTheme/default` | Set default app theme |
| `/api/organization/appTheme/protect` | Protect app theme |
| `/api/organization/appTheme/pushProtect` | Push protect theme to remote |
| `/api/organization/appTheme/pushUnprotect` | Push unprotect theme to remote |
| `/api/organization/appTheme/unprotect` | Unprotect app theme |
| `/api/organization/awsImportCredentials` | Import AWS credentials |
| `/api/organization/bulkSuggestUsers` | Bulk user suggestions |
| `/api/organization/getElementDependencies` | Get element dependencies |
| `/api/organization/instrumentation` | Get instrumentation settings |
| `/api/organization/instrumentation/test` | Test instrumentation |
| `/api/organization/preAuthData` | Get pre-authentication data |
| `/api/organization/resourceUsageCounts?propertyType=resource` | Resource usage counts |
| `/api/organization/resourceUsages?resourceName=:name` | Resource usages by name |
| `/api/organization/spaces/copyElements` | Copy elements between spaces |
| `/api/organization/spaces/validateElementsToCopy` | Validate elements to copy |
| `/api/organization/userSpaces` | Get user spaces |
| `/api/organization/v1/personalAccessTokens` | List personal access tokens |
| `/api/organization/v1/personalAccessTokens/createToken` | Create personal access token |
| `/api/organization/v1/personalAccessTokens/revokeToken` | Revoke personal access token |

---

## Pages (Apps)

Endpoints for managing Retool applications (pages).

| Endpoint | Description |
|----------|-------------|
| `/api/pages` | List all pages/apps |
| `/api/pages?mobileAppsOnly=:bool` | List mobile apps only |
| `/api/pages?mobileAppsOnly=:bool&includePublicPages=:bool` | List with filters |
| `/api/pages/:pageUuid/backfillScreens` | Backfill screens for page |
| `/api/pages/:pageUuid/favorite` | Favorite/unfavorite page |
| `/api/pages/:pageUuid/screens` | Get page screens |
| `/api/pages/clonePage` | Clone existing page |
| `/api/pages/cloneResourceTemplate` | Clone resource template |
| `/api/pages/cloneTemplate` | Clone app template |
| `/api/pages/cloneV2Template` | Clone v2 app template |
| `/api/pages/createDemoResource` | Create demo resource |
| `/api/pages/createPage` | Create new page |
| `/api/pages/generateHitlWorkflowInboxViewApp` | Generate HITL inbox view app |
| `/api/pages/globalWidgets` | Get global widgets |
| `/api/pages/lookupPage` | Lookup page by path |
| `/api/pages/lookupPageByUuid` | Lookup page by UUID |
| `/api/pages/protect` | Protect page from editing |
| `/api/pages/pushProtectBranch` | Push protect to branch |
| `/api/pages/screens` | List all screens |
| `/api/pages/translations/:languageId` | Get page translations |
| `/api/pages/unprotectPage` | Unprotect page |
| `/api/pages/uuids/:pageUuid` | Get page by UUID |
| `/api/pages/uuids/:pageUuid/:branchId/getCurrentAndLastCommitSave` | Get commit saves |
| `/api/pages/uuids/:pageUuid/checkOrgAndBranchForPagePath` | Check org and branch |
| `/api/pages/uuids/:pageUuid/checkQueryAuth` | Check query authentication |
| `/api/pages/uuids/:pageUuid/checkQueryAuthForPage` | Check page query auth |
| `/api/pages/uuids/:pageUuid/createTag` | Create version tag |
| `/api/pages/uuids/:pageUuid/documentation` | Get/update documentation |
| `/api/pages/uuids/:pageUuid/editPassword` | Edit page password |
| `/api/pages/uuids/:pageUuid/export` | Export page |
| `/api/pages/uuids/:pageUuid/importAppAsPage` | Import app as page |
| `/api/pages/uuids/:pageUuid/invalidateCache` | Invalidate page cache |
| `/api/pages/uuids/:pageUuid/preview` | Preview page |
| `/api/pages/uuids/:pageUuid/publish` | Publish page |
| `/api/pages/uuids/:pageUuid/pushBranchWithAppRemoved` | Push branch with app removed |
| `/api/pages/uuids/:pageUuid/pushBranchWithMovedPage` | Push branch with moved page |
| `/api/pages/uuids/:pageUuid/pushBranchWithRenamedPage` | Push branch with renamed page |
| `/api/pages/uuids/:pageUuid/query` | Execute query in page |
| `/api/pages/uuids/:pageUuid/releaseLatestTag` | Release latest tag |
| `/api/pages/uuids/:pageUuid/releases/:releaseId` | Get specific release |
| `/api/pages/uuids/:pageUuid/releases/:releaseId?yaml=true` | Get release as YAML |
| `/api/pages/uuids/:pageUuid/remoteBranchContainsPath` | Check remote branch contains path |
| `/api/pages/uuids/:pageUuid/runWorkflowFromRetoolApp` | Run workflow from app |
| `/api/pages/uuids/:pageUuid/save` | Save page |
| `/api/pages/uuids/:pageUuid/save/appTesting` | Save for app testing |
| `/api/pages/uuids/:pageUuid/saves` | List page saves |
| `/api/pages/uuids/:pageUuid/saves/:saveId` | Get specific save |
| `/api/pages/uuids/:pageUuid/subflows/execute` | Execute subflow |
| `/api/pages/uuids/:pageUuid/tags` | List page tags |
| `/api/pages/uuids/:pageUuid/tags/:tagId` | Get specific tag |
| `/api/pages/uuids/:pageUuid/unpublish` | Unpublish page |
| `/api/pages/uuids/:pageUuid/updateBlueprintMetadata` | Update blueprint metadata |
| `/api/pages/uuids/:pageUuid/updateUserHeartbeat` | Update user editing heartbeat |
| `/api/pages/uuids/testing/checkQueryAuth` | Check query auth for testing |
| `/api/editor/pageNames` | Get page names for editor |
| `/api/internal/pages` | Internal pages API |

---

## Permissions

Endpoints for access control and permissions management.

| Endpoint | Description |
|----------|-------------|
| `/api/organization/permissions` | Get organization permissions |
| `/api/organization/permissions/account/:accountId/setGroups` | Set account groups |
| `/api/organization/permissions/appUsers` | Get app users |
| `/api/organization/permissions/apps/:appId/deleteMembers` | Delete app members |
| `/api/organization/permissions/apps/:appId/members` | Get/set app members |
| `/api/organization/permissions/external` | External permissions |
| `/api/organization/permissions/groups` | List permission groups |
| `/api/organization/permissions/groups/` | Permission groups list |
| `/api/organization/permissions/groups/:groupId` | Get specific group |
| `/api/organization/permissions/groups/:groupId/setAdmins` | Set group admins |
| `/api/organization/permissions/groups/:groupId/setMembers` | Set group members |
| `/api/organization/permissions/groups/:groupId/update` | Update group |
| `/api/permissions/v1/:permissionId` | Get permission by ID |
| `/api/permissions/v1/accessList` | Get access list |

---

## Playground

Endpoints for Retool Query Playground feature.

| Endpoint | Description |
|----------|-------------|
| `/api/playground` | List playground queries |
| `/api/playground/:queryId/delete` | Delete playground query |
| `/api/playground/:queryId/duplicate` | Duplicate playground query |
| `/api/playground/:queryId/latestSave` | Get latest save |
| `/api/playground/:queryId/latestSave?branchName=:name` | Get latest save by branch |
| `/api/playground/:queryId/save` | Save playground query |
| `/api/playground/:queryId/saves` | List query saves |
| `/api/playground/:queryId/share` | Share playground query |
| `/api/playground/:queryId/unshare` | Unshare playground query |
| `/api/playground/:queryId/usages` | Get query usages |
| `/api/playground/createStarterQueries` | Create starter queries |
| `/api/playground/query` | Execute playground query |
| `/api/playground/uuid/:queryUuid/saves` | Get saves by UUID |
| `/api/playground/uuid/:queryUuid/saves?branchName=:name` | Get saves by UUID and branch |
| `/api/playground/uuid/:queryUuid/:branchId/getCurrentAndLastCommitSave` | Get commit saves |

---

## Public Apps

Endpoints for publicly shared Retool applications.

| Endpoint | Description |
|----------|-------------|
| `/api/pages/public?embed=:bool` | List public pages |
| `/api/pages/public/shortlink?shortlink=:code` | Get page by shortlink |
| `/api/public/:appId/documentation` | Public app documentation |
| `/api/public/:appId/instrumentation` | Public app instrumentation |
| `/api/public/:appId/invalidateCache` | Invalidate public app cache |
| `/api/public/:appId/query` | Execute query in public app |
| `/api/public/:appId/runWorkflowFromRetoolApp` | Run workflow from public app |
| `/api/publicAppReport` | Public app usage report |

---

## Releases

Endpoints for managing app releases and deployments.

| Endpoint | Description |
|----------|-------------|
| `/api/releases/manifests` | List release manifests |
| `/api/releases/manifests/element/:elementUuid` | Get manifest for element |
| `/api/releases/manifests/elements/versions` | Get element versions |
| `/api/releases/manifests/names` | Get manifest names |
| `/api/releases/:releaseId/createReleaseArtifact?elementType=:type` | Create release artifact |
| `/api/releases/:releaseId/delete?elementType=PAGE` | Delete release |
| `/api/releases/:releaseId/publish?elementType=PAGE` | Publish release |

---

## Resources (Data Sources)

Endpoints for managing data source connections.

| Endpoint | Description |
|----------|-------------|
| `/api/resources` | List all resources |
| `/api/resources/` | Resources list |
| `/api/resources/:resourceId/deleteToken` | Delete resource token |
| `/api/resources/autoConfigureAuth` | Auto-configure authentication |
| `/api/resources/checkOrgAndBranchForResource` | Check org and branch for resource |
| `/api/resources/duplicateResource` | Duplicate resource |
| `/api/resources/getGRPCServiceNames` | Get gRPC service names |
| `/api/resources/importFromAws?type=:type&region=:region` | Import resource from AWS |
| `/api/resources/names/:resourceName` | Get resource by name |
| `/api/resources/names/:resourceName/environments/:envId` | Get resource in environment |
| `/api/resources/protect` | Protect resource |
| `/api/resources/pushEditBranch` | Push edit to branch |
| `/api/resources/pushMovedResource` | Push moved resource |
| `/api/resources/pushProtectBranch` | Push protect to branch |
| `/api/resources/pushRenamedResource` | Push renamed resource |
| `/api/resources/pushUnprotectBranch` | Push unprotect to branch |
| `/api/resources/remoteBranchContainsResourcePaths` | Check remote branch paths |
| `/api/resources/remoteBranchContainsResources` | Check remote branch resources |
| `/api/resources/testConnection` | Test resource connection |
| `/api/resources/unprotect` | Unprotect resource |
| `/api/resourceAuth/processRefreshAuthStep` | Process refresh auth step |
| `/api/resourceAuth/processStep` | Process auth step |
| `/api/resourceFolders/createResourceFolder` | Create resource folder |
| `/api/resourceFolders/deleteResourceFolder` | Delete resource folder |
| `/api/resourceFolders/moveResourceToFolder` | Move resource to folder |
| `/api/resourceFolders/renameResourceFolder` | Rename resource folder |

---

## Secrets Manager

Endpoints for managing secrets and credentials.

| Endpoint | Description |
|----------|-------------|
| `/api/secretsManager/configs` | List secrets manager configs |
| `/api/secretsManager/configs/name/:configName` | Get config by name |
| `/api/secretsManager/configs/name/:configName/setDefault` | Set default config |
| `/api/secretsManager/secrets` | List secrets |
| `/api/secretsManager/secrets/name/:secretName` | Get secret by name |

---

## Templates

Endpoints for app and workflow templates.

| Endpoint | Description |
|----------|-------------|
| `/api/templates/marketingTemplates` | Get marketing templates |

---

## User Management

Endpoints for user profile and account management.

| Endpoint | Description |
|----------|-------------|
| `/api/user` | Get current user |
| `/api/user/changeEmail` | Change user email |
| `/api/user/changeName` | Change user display name |
| `/api/user/changePassword` | Change user password |
| `/api/user/confirm2FASetup` | Confirm 2FA setup |
| `/api/user/confirmFIDO2Setup` | Confirm FIDO2/WebAuthn setup |
| `/api/user/confirmResetPassword` | Confirm password reset |
| `/api/user/passwordlessLogin/request` | Request passwordless login |
| `/api/user/removeFIDO2Authenticator` | Remove FIDO2 authenticator |
| `/api/user/reset2FA` | Reset 2FA |
| `/api/user/resetPassword` | Request password reset |
| `/api/user/setup2FA` | Start 2FA setup |
| `/api/user/setupFIDO2` | Start FIDO2 setup |
| `/api/user/shouldPromptPasswordForResetting2FA` | Check if password required for 2FA reset |
| `/api/user/verify2FAChallenge` | Verify 2FA challenge |
| `/api/user/verifyFIDO2Challenge` | Verify FIDO2 challenge |

---

## User Tasks (HITL)

Endpoints for Human-in-the-Loop (HITL) user tasks.

| Endpoint | Description |
|----------|-------------|
| `/api/userTask/` | List user tasks |
| `/api/userTask/:taskId` | Get specific user task |
| `/api/userTask/:taskId/cancel` | Cancel user task |
| `/api/userTask/:taskId/complete` | Complete user task |
| `/api/userTask/:taskId/reassign` | Reassign user task |
| `/api/userTask/actions/:actionId` | Get task action |
| `/api/userTask/bulkSubmit` | Bulk submit user tasks |
| `/api/userTask/getAgentUserTasks` | Get agent user tasks |
| `/api/userTask/userTaskDefinitions` | Get task definitions |

---

## Vectors (AI/RAG)

Endpoints for vector embeddings and RAG (Retrieval-Augmented Generation).

| Endpoint | Description |
|----------|-------------|
| `/api/vectors/cancelFetch` | Cancel vector fetch operation |
| `/api/vectors/createVector` | Create new vector |
| `/api/vectors/deleteVector` | Delete vector |
| `/api/vectors/getVectors` | Get all vectors |
| `/api/vectors/saveAndRestartFetching` | Save and restart fetching |
| `/api/vectors/updateSource` | Update vector source |
| `/api/vectors/updateVector` | Update vector |

---

## Workflows

Endpoints for Retool Workflows automation.

| Endpoint | Description |
|----------|-------------|
| `/api/workflow` | List all workflows |
| `/api/workflow/` | Workflows list |
| `/api/workflow/:workflowId` | Get specific workflow |
| `/api/workflow/:workflowId?branchName=:name` | Get workflow by branch |
| `/api/workflow/:workflowId/:branchId/getCurrentAndLastCommitSave` | Get commit saves |
| `/api/workflow/:workflowId/checkQueryAuthForWorkflow` | Check query auth |
| `/api/workflow/:workflowId/childWorkflowDirtyStatuses` | Get child workflow statuses |
| `/api/workflow/:workflowId/protectWorkflow` | Protect workflow |
| `/api/workflow/:workflowId/pushProtectWorkflow` | Push protect to remote |
| `/api/workflow/:workflowId/pushWithWorkflowRemoved` | Push with workflow removed |
| `/api/workflow/:workflowId/releases` | Get workflow releases |
| `/api/workflow/:workflowId/remoteBranchContainsWorkflow` | Check if remote contains workflow |
| `/api/workflow/:workflowId/resumeWorkflowRun` | Resume workflow run |
| `/api/workflow/:workflowId/rotateApiKey` | Rotate workflow API key |
| `/api/workflow/:workflowId/runBlock?origin=frontend` | Run workflow block |
| `/api/workflow/:workflowId/unprotectWorkflow` | Unprotect workflow |
| `/api/workflow/canExecuteTestWorkflow` | Check if can execute test workflow |
| `/api/workflow/checkQueryAuthForAgent` | Check query auth for agent |
| `/api/workflow/clone` | Clone workflow |
| `/api/workflow/enrollInTemporalCloud` | Enroll in Temporal Cloud |
| `/api/workflow/export` | Export workflow |
| `/api/workflow/exportTemplate` | Export workflow as template |
| `/api/workflow/forceRotateTLSForTemporalCloud` | Force rotate TLS |
| `/api/workflow/hasEgressOpen` | Check if egress is open |
| `/api/workflow/hasEncryptionKeySet` | Check if encryption key is set |
| `/api/workflow/hasTemporalClient` | Check if Temporal client exists |
| `/api/workflow/import` | Import workflow |
| `/api/workflow/revert` | Revert workflow changes |
| `/api/workflow/run` | Run workflow |
| `/api/workflow/save/:workflowId` | Save workflow |
| `/api/workflow/template/:templateId` | Get workflow template |
| `/api/workflow/template/metadata` | Get template metadata |
| `/api/workflow/template/metadata/:templateId` | Get specific template metadata |
| `/api/workflow/unenrollFromTemporalCloud` | Unenroll from Temporal Cloud |
| `/api/workflow/unlockHoldingPage` | Unlock workflow holding page |
| `/api/workflow/workflowsConfiguration` | Get workflows configuration |
| `/api/workflow/workflowsDisplayMetadata` | Get workflows display metadata |
| `/api/workflows/observability/config` | Workflows observability config |
| `/api/workflows/observability/config/:configId` | Specific observability config |
| `/api/workflows/observability/provider/:provider/config` | Provider-specific config |
| `/api/workflows/temporal/checkTemporalConnectivity` | Check Temporal connectivity |
| `/api/workflows/temporal/checkTemporalNamespaceEgress` | Check Temporal namespace egress |
| `/api/workflowsPlayground/resources` | Workflows playground resources |
| `/api/workflowsPlayground/runBlock` | Run block in playground |

---

## Workflow Runs

Endpoints for workflow execution and run management.

| Endpoint | Description |
|----------|-------------|
| `/api/workflowRun/:runId` | Get workflow run |
| `/api/workflowRun/getCountByWorkflow` | Get run count by workflow |
| `/api/workflowRun/getLog?runId=:runId` | Get run logs |
| `/api/workflowRun/getRuns?workflowId=:id&limit=:limit&offset=:offset` | Get runs with pagination |
| `/api/workflowRun/getRunsForWorkflows` | Get runs for multiple workflows |
| `/api/eventWorkflow` | Event-driven workflow |
| `/api/eventWorkflow/workflow/:workflowId` | Event workflow by ID |

---

## Workflow Triggers

Endpoints for managing workflow triggers (webhooks, schedules, etc.).

| Endpoint | Description |
|----------|-------------|
| `/api/workflowTrigger/` | List workflow triggers |
| `/api/workflowTrigger?workflowId=:id` | Get triggers for workflow |
| `/api/workflowTrigger/:triggerId` | Get specific trigger |
| `/api/workflowTrigger/enabled` | Get enabled triggers |
| `/api/workflowCustomUrlPath/` | Custom URL paths |
| `/api/workflowCustomUrlPath/:pathId` | Specific custom URL path |
| `/api/workflowRelease` | Workflow releases |
| `/api/workflowRelease/:releaseId` | Specific workflow release |
| `/api/workflowRelease/redeploy` | Redeploy workflow |
| `/api/workflowUsage/` | Workflow usage statistics |

---

## Miscellaneous

Other endpoints that don't fit into the categories above.

| Endpoint | Description |
|----------|-------------|
| `/api/ddMetric` | Datadog metrics integration |
| `/api/getLatestOnPremVersion` | Get latest on-premise version |
| `/api/gpt/queryGPT?origin=frontend` | Query GPT AI |
| `/api/internal/app-testing/presigned-url` | Get presigned URL for app testing |
| `/api/queryTimeoutVariables` | Query timeout configuration |

---

## Notes

1. **Path Parameters**: Parameters with `:paramName` syntax are dynamic path parameters (Express.js style). Parameters with `${variable}` are template literal variables.

2. **Query Parameters**: Some endpoints include query parameters (e.g., `?branchName=:name`). Additional query parameters may be supported.

3. **HTTP Methods**: Based on usage analysis:
   - **POST**: 414 occurrences (most common for mutations)
   - **GET**: 306 occurrences (data retrieval)
   - **DELETE**: 54 occurrences (resource deletion)
   - **PUT**: 42 occurrences (full resource updates)
   - **PATCH**: 22 occurrences (partial updates)

4. **Authentication**: Most endpoints require authentication via session cookie or API token.

5. **Versioning**: Some endpoints use `/api/organization/v1/` or `/api/permissions/v1/` for versioned APIs.

6. **Internal APIs**: Endpoints under `/api/internal/` are for internal use and may change without notice.

---

## Related Frontend Routes

These are frontend URL routes (not API endpoints) discovered in the codebase:

| Route | Description |
|-------|-------------|
| `/resources/` | Resources list page |
| `/resources/data/` | Data resources |
| `/resources/data/new` | Create new data resource |
| `/resources/databases` | Database resources |
| `/resources/folders` | Resource folders |
| `/resources/new` | New resource page |
| `/resources/new/dbServer` | New database server |
| `/resources/new/retooldb` | New Retool Database |
| `/resources/retool_ai` | Retool AI resource |
| `/resources/retool_storage` | Retool Storage |
| `/workflows/folders/` | Workflows folders |
| `/workflows/new` | Create new workflow |
| `/embedded/` | Embedded apps |
| `/embedded/public/` | Public embedded apps |
| `/public/` | Public apps |

---

*Document generated from Retool web application JavaScript analysis*
*Total API endpoints: 233+ static + dynamic template patterns*

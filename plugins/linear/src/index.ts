import { isLinearAuthenticated, waitForLinearAuth } from './linear-api.js';
import { addIssueLabel } from './tools/add-issue-label.js';
import { addIssueSubscriber } from './tools/add-issue-subscriber.js';
import { archiveIssue } from './tools/archive-issue.js';
import { batchUpdateIssues } from './tools/batch-update-issues.js';
import { createAttachment } from './tools/create-attachment.js';
import { createComment } from './tools/create-comment.js';
import { createDocument } from './tools/create-document.js';
import { createInitiative } from './tools/create-initiative.js';
import { createIssue } from './tools/create-issue.js';
import { createIssueRelation } from './tools/create-issue-relation.js';
import { createLabel } from './tools/create-label.js';
import { createMilestone } from './tools/create-milestone.js';
import { createProject } from './tools/create-project.js';
import { createProjectUpdate } from './tools/create-project-update.js';
import { deleteAttachment } from './tools/delete-attachment.js';
import { deleteComment } from './tools/delete-comment.js';
import { deleteIssue } from './tools/delete-issue.js';
import { deleteIssueRelation } from './tools/delete-issue-relation.js';
import { deleteLabel } from './tools/delete-label.js';
import { deleteProjectUpdate } from './tools/delete-project-update.js';
import { getAttachment } from './tools/get-attachment.js';
import { getCycle } from './tools/get-cycle.js';
import { getDocument } from './tools/get-document.js';
import { getInitiative } from './tools/get-initiative.js';
import { getIssue } from './tools/get-issue.js';
import { getMilestone } from './tools/get-milestone.js';
import { getProject } from './tools/get-project.js';
import { getTeam } from './tools/get-team.js';
import { getUser } from './tools/get-user.js';
import { getViewer } from './tools/get-viewer.js';
import { listAttachments } from './tools/list-attachments.js';
import { listComments } from './tools/list-comments.js';
import { listCycles } from './tools/list-cycles.js';
import { listDocuments } from './tools/list-documents.js';
import { listInitiatives } from './tools/list-initiatives.js';
import { listIssueHistory } from './tools/list-issue-history.js';
import { listIssueRelations } from './tools/list-issue-relations.js';
import { listLabels } from './tools/list-labels.js';
import { listMilestones } from './tools/list-milestones.js';
import { listProjectLabels } from './tools/list-project-labels.js';
import { listProjectUpdates } from './tools/list-project-updates.js';
import { listProjects } from './tools/list-projects.js';
import { listSubIssues } from './tools/list-sub-issues.js';
import { listTeamMembers } from './tools/list-team-members.js';
import { listTeams } from './tools/list-teams.js';
import { listUsers } from './tools/list-users.js';
import { listWorkflowStates } from './tools/list-workflow-states.js';
import { moveIssueToProject } from './tools/move-issue-to-project.js';
import { removeIssueLabel } from './tools/remove-issue-label.js';
import { removeIssueSubscriber } from './tools/remove-issue-subscriber.js';
import { searchIssues } from './tools/search-issues.js';
import { setIssueCycle } from './tools/set-issue-cycle.js';
import { updateComment } from './tools/update-comment.js';
import { updateDocument } from './tools/update-document.js';
import { updateInitiative } from './tools/update-initiative.js';
import { updateIssue } from './tools/update-issue.js';
import { updateLabel } from './tools/update-label.js';
import { updateMilestone } from './tools/update-milestone.js';
import { updateProject } from './tools/update-project.js';
import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';

class LinearPlugin extends OpenTabsPlugin {
  readonly name = 'linear';
  readonly description = 'OpenTabs plugin for Linear';
  override readonly displayName = 'Linear';
  readonly urlPatterns = ['*://linear.app/*'];
  override readonly homepage = 'https://linear.app';
  readonly tools: ToolDefinition[] = [
    // Issues
    searchIssues,
    getIssue,
    createIssue,
    updateIssue,
    deleteIssue,
    archiveIssue,
    batchUpdateIssues,
    listSubIssues,
    listIssueHistory,
    // Issue relations
    listIssueRelations,
    createIssueRelation,
    deleteIssueRelation,
    // Issue labels (additive/subtractive)
    addIssueLabel,
    removeIssueLabel,
    // Issue subscribers
    addIssueSubscriber,
    removeIssueSubscriber,
    // Issue assignment
    setIssueCycle,
    moveIssueToProject,
    // Attachments
    listAttachments,
    getAttachment,
    createAttachment,
    deleteAttachment,
    // Comments
    createComment,
    updateComment,
    deleteComment,
    listComments,
    // Projects
    listProjects,
    getProject,
    createProject,
    updateProject,
    listProjectLabels,
    // Project updates (health reports)
    listProjectUpdates,
    createProjectUpdate,
    deleteProjectUpdate,
    // Milestones
    listMilestones,
    getMilestone,
    createMilestone,
    updateMilestone,
    // Initiatives
    listInitiatives,
    getInitiative,
    createInitiative,
    updateInitiative,
    // Documents
    listDocuments,
    getDocument,
    createDocument,
    updateDocument,
    // Teams & Users
    listTeams,
    getTeam,
    listTeamMembers,
    listUsers,
    getUser,
    getViewer,
    // Workflow
    listWorkflowStates,
    listLabels,
    createLabel,
    updateLabel,
    deleteLabel,
    listCycles,
    getCycle,
  ];

  async isReady(): Promise<boolean> {
    if (isLinearAuthenticated()) return true;
    return waitForLinearAuth();
  }
}

export default new LinearPlugin();

import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ConfigSchema, ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './posthog-api.js';

// Users & Organization
import { getCurrentUser } from './tools/get-current-user.js';
import { getOrganization } from './tools/get-organization.js';

// Projects
import { listProjects } from './tools/list-projects.js';
import { getProject } from './tools/get-project.js';

// Dashboards
import { listDashboards } from './tools/list-dashboards.js';
import { getDashboard } from './tools/get-dashboard.js';
import { createDashboard } from './tools/create-dashboard.js';
import { updateDashboard } from './tools/update-dashboard.js';
import { deleteDashboard } from './tools/delete-dashboard.js';

// Insights
import { listInsights } from './tools/list-insights.js';
import { getInsight } from './tools/get-insight.js';
import { updateInsight } from './tools/update-insight.js';
import { deleteInsight } from './tools/delete-insight.js';

// Feature Flags
import { listFeatureFlags } from './tools/list-feature-flags.js';
import { getFeatureFlag } from './tools/get-feature-flag.js';
import { createFeatureFlag } from './tools/create-feature-flag.js';
import { updateFeatureFlag } from './tools/update-feature-flag.js';
import { deleteFeatureFlag } from './tools/delete-feature-flag.js';

// Experiments
import { listExperiments } from './tools/list-experiments.js';
import { getExperiment } from './tools/get-experiment.js';
import { createExperiment } from './tools/create-experiment.js';

// Annotations
import { listAnnotations } from './tools/list-annotations.js';
import { createAnnotation } from './tools/create-annotation.js';
import { deleteAnnotation } from './tools/delete-annotation.js';

// Persons
import { listPersons } from './tools/list-persons.js';
import { getPerson } from './tools/get-person.js';

// Cohorts
import { listCohorts } from './tools/list-cohorts.js';
import { getCohort } from './tools/get-cohort.js';

// Surveys
import { listSurveys } from './tools/list-surveys.js';
import { getSurvey } from './tools/get-survey.js';

// Actions
import { listActions } from './tools/list-actions.js';
import { getAction } from './tools/get-action.js';

class PostHogPlugin extends OpenTabsPlugin {
  readonly name = 'posthog';
  readonly description = 'OpenTabs plugin for PostHog';
  override readonly displayName = 'PostHog';
  readonly urlPatterns = ['*://us.posthog.com/*', '*://eu.posthog.com/*'];
  override readonly homepage = 'https://us.posthog.com';

  override readonly configSchema: ConfigSchema = {
    instanceUrl: {
      type: 'url' as const,
      label: 'PostHog URL',
      description:
        'The URL of your self-hosted PostHog instance. Used to inject the adapter into your instance — leave empty to use PostHog Cloud.',
      required: false,
      placeholder: 'https://posthog.example.com',
    },
  };

  readonly tools: ToolDefinition[] = [
    // Users & Organization
    getCurrentUser,
    getOrganization,

    // Projects
    listProjects,
    getProject,

    // Dashboards
    listDashboards,
    getDashboard,
    createDashboard,
    updateDashboard,
    deleteDashboard,

    // Insights
    listInsights,
    getInsight,
    updateInsight,
    deleteInsight,

    // Feature Flags
    listFeatureFlags,
    getFeatureFlag,
    createFeatureFlag,
    updateFeatureFlag,
    deleteFeatureFlag,

    // Experiments
    listExperiments,
    getExperiment,
    createExperiment,

    // Annotations
    listAnnotations,
    createAnnotation,
    deleteAnnotation,

    // Persons
    listPersons,
    getPerson,

    // Cohorts
    listCohorts,
    getCohort,

    // Surveys
    listSurveys,
    getSurvey,

    // Actions
    listActions,
    getAction,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new PostHogPlugin();

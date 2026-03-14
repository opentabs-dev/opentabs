import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitPageForm } from '../github-api.js';
import { repositorySchema } from './schemas.js';

export const createRepo = defineTool({
  name: 'create_repo',
  displayName: 'Create Repository',
  description: 'Create a new repository for the authenticated user.',
  summary: 'Create a new repository',
  icon: 'plus-circle',
  group: 'Repositories',
  input: z.object({
    name: z.string().min(1).describe('Repository name'),
    description: z.string().optional().describe('Short description of the repository'),
    private: z.boolean().optional().describe('Whether the repository is private (default: false)'),
    auto_init: z.boolean().optional().describe('Initialize with a README (default: false)'),
    gitignore_template: z.string().optional().describe('Gitignore template name (e.g., "Node", "Python")'),
    license_template: z.string().optional().describe('License template (e.g., "mit", "apache-2.0")'),
  }),
  output: z.object({
    repository: repositorySchema.describe('The created repository'),
  }),
  handle: async params => {
    const fields: Record<string, string> = {
      'repository[name]': params.name,
    };
    if (params.description) fields['repository[description]'] = params.description;
    if (params.private) fields['repository[visibility]'] = 'private';
    if (params.auto_init) fields['repository[auto_init]'] = '1';
    if (params.gitignore_template) fields['repository[gitignore_template]'] = params.gitignore_template;
    if (params.license_template) fields['repository[license_template]'] = params.license_template;

    await submitPageForm('/new', 'form[action="/repositories"]', fields);

    return {
      repository: {
        id: 0,
        name: params.name,
        full_name: params.name,
        description: params.description ?? '',
        private: params.private ?? false,
        html_url: `https://github.com/${params.name}`,
        default_branch: 'main',
        language: '',
        stargazers_count: 0,
        forks_count: 0,
        open_issues_count: 0,
        archived: false,
        updated_at: new Date().toISOString(),
      },
    };
  },
});

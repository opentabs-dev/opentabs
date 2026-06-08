import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { mapOrganization, organizationSchema, type RawOrganization } from './schemas.js';

export const getOrganization = defineTool({
  name: 'get_organization',
  displayName: 'Get Organization',
  description:
    'Get detailed information about the current Retool organization, including name, subdomain, plan, and settings.',
  summary: 'Get the current organization details',
  icon: 'building-2',
  group: 'Organization',
  input: z.object({}),
  output: z.object({ organization: organizationSchema }),
  handle: async () => {
    const data = await api<{ org: RawOrganization }>('/api/organization');
    return { organization: mapOrganization(data.org ?? {}) };
  },
});

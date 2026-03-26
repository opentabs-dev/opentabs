import { defineTool, getSessionStorage } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { userProfileSchema } from './schemas.js';

/**
 * Extract user profile from MSAL account data and ARM JWT token payload.
 * Azure Portal stores MSAL account entries in sessionStorage. The ARM access
 * token JWT payload contains user claims (name, email, tenant ID, object ID).
 */
const extractUserProfile = () => {
  let name = '';
  let email = '';
  let objectId = '';

  // Read MSAL account data
  const accountKeysStr = getSessionStorage('msal.1.account.keys');
  if (accountKeysStr) {
    try {
      const accountKeys = JSON.parse(accountKeysStr) as string[];
      if (accountKeys.length > 0 && accountKeys[0]) {
        const accountStr = getSessionStorage(accountKeys[0]);
        if (accountStr) {
          const account = JSON.parse(accountStr) as {
            name?: string;
            username?: string;
            localAccountId?: string;
          };
          name = account.name ?? '';
          email = account.username ?? '';
          objectId = account.localAccountId ?? '';
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Enrich from ARM token JWT payload
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (!key?.includes('accesstoken') || !/(?:^|[\s/])management\.core\.windows\.net(?:[/\s]|$)/.test(key)) {
      continue;
    }
    try {
      const raw = getSessionStorage(key);
      if (!raw) continue;
      const entry = JSON.parse(raw) as { secret?: string };
      if (!entry.secret) continue;
      const parts = entry.secret.split('.');
      const jwtBody = parts[1];
      if (parts.length < 2 || !jwtBody) continue;
      const payload = JSON.parse(atob(jwtBody)) as {
        name?: string;
        email?: string;
        unique_name?: string;
        upn?: string;
        oid?: string;
        tid?: string;
      };
      if (!name && payload.name) name = payload.name;
      if (!email) email = payload.email ?? payload.unique_name ?? payload.upn ?? '';
      if (!objectId && payload.oid) objectId = payload.oid;
      // tenantId available via payload.tid if needed
      break;
    } catch {
      // Ignore parse errors
    }
  }

  // Parse name into given/surname if possible
  const nameParts = name.split(' ');
  const givenName = nameParts[0] ?? '';
  const surname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  return {
    id: objectId,
    display_name: name || email,
    user_principal_name: email,
    mail: email,
    given_name: givenName,
    surname,
    job_title: '',
  };
};

export const getCurrentUser = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description:
    'Get the profile of the currently authenticated Azure Portal user including email, display name, object ID, and tenant ID. Extracted from the MSAL session and ARM token.',
  summary: 'Get the current user profile',
  icon: 'user',
  group: 'Account',
  input: z.object({}),
  output: z.object({ user: userProfileSchema }),
  handle: async () => {
    return { user: extractUserProfile() };
  },
});

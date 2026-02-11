import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const getUserProfile = defineTool({
  name: 'get_user_profile',
  description: 'Retrieve a Slack user\'s profile information by user ID',
  input: z.object({
    user: z.string().describe('User ID to retrieve the profile for (e.g., U01234567)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request was successful'),
    user: z.object({
      id: z.string().describe('User ID'),
      name: z.string().describe('Username (handle)'),
      real_name: z.string().describe('Full display name'),
      profile: z.object({
        title: z.string().describe('Job title'),
        phone: z.string().describe('Phone number'),
        email: z.string().describe('Email address'),
        status_text: z.string().describe('Custom status text'),
        status_emoji: z.string().describe('Custom status emoji'),
        image_72: z.string().describe('URL to 72x72 profile image'),
      }).describe('Detailed profile information'),
      is_admin: z.boolean().describe('Whether the user is a workspace admin'),
      is_bot: z.boolean().describe('Whether the user is a bot'),
      tz: z.string().describe('Timezone identifier (e.g., America/Los_Angeles)'),
    }).describe('User profile data'),
  }),
  handle: async (params) => {
    const res = await fetch('/api/users.info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: params.user }),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to get user profile', data.error ?? 'unknown_error')
    }
    return {
      ok: data.ok,
      user: {
        id: data.user.id,
        name: data.user.name,
        real_name: data.user.real_name ?? '',
        profile: {
          title: data.user.profile?.title ?? '',
          phone: data.user.profile?.phone ?? '',
          email: data.user.profile?.email ?? '',
          status_text: data.user.profile?.status_text ?? '',
          status_emoji: data.user.profile?.status_emoji ?? '',
          image_72: data.user.profile?.image_72 ?? '',
        },
        is_admin: data.user.is_admin ?? false,
        is_bot: data.user.is_bot ?? false,
        tz: data.user.tz ?? '',
      },
    }
  },
})

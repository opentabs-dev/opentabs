import { defineTool, stripUndefined } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';

export const updateProfile = defineTool({
  name: 'update_profile',
  displayName: 'Update Profile',
  description:
    'Update profile preferences including bio, age range, distance filter, gender filter, and discoverability. Only provided fields are updated.',
  summary: 'Update your Tinder profile',
  icon: 'pencil',
  group: 'Profile',
  input: z.object({
    bio: z.string().describe('Profile bio text').optional(),
    age_filter_min: z.number().min(18).max(100).describe('Minimum age preference (18-100)').optional(),
    age_filter_max: z.number().min(18).max(100).describe('Maximum age preference (18-100)').optional(),
    distance_filter: z.number().min(1).max(100).describe('Maximum distance in miles (1-100)').optional(),
    gender_filter: z.number().describe('Gender preference filter (-1=everyone, 0=male, 1=female)').optional(),
    discoverable: z.boolean().describe('Whether profile is visible to others').optional(),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the profile was updated successfully'),
  }),
  handle: async params => {
    const body = stripUndefined({
      bio: params.bio,
      age_filter_min: params.age_filter_min,
      age_filter_max: params.age_filter_max,
      distance_filter: params.distance_filter,
      gender_filter: params.gender_filter,
      discoverable: params.discoverable,
    });

    await api('/profile', { method: 'POST', body });
    return { success: true };
  },
});

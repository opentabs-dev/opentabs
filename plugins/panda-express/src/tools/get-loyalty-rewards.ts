import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { type RawLoyaltyReward, loyaltyRewardSchema, mapLoyaltyReward } from './schemas.js';

export const getLoyaltyRewards = defineTool({
  name: 'get_loyalty_rewards',
  displayName: 'Get Loyalty Rewards',
  description:
    'Get available Panda Express loyalty rewards that can be redeemed with points. Reads from the local app state — requires the user to be logged in with an active rewards account.',
  summary: 'View available loyalty rewards',
  icon: 'gift',
  group: 'Loyalty',
  input: z.object({}),
  output: z.object({
    rewards: z.array(loyaltyRewardSchema).describe('Available loyalty rewards'),
    current_points: z.number().int().describe('Current loyalty points balance'),
  }),
  handle: async () => {
    try {
      const root = localStorage.getItem('persist:root');
      if (!root) return { rewards: [], current_points: 0 };
      const parsed = JSON.parse(root) as Record<string, string>;
      const loyalty = JSON.parse(parsed.loyalty ?? '{}') as {
        rewardStoreRedeemables?: { entities?: RawLoyaltyReward[] };
        estimatedPoints?: number;
      };
      const milestones = JSON.parse(parsed.loyaltyMilestonesUI ?? '{}') as {
        currentPoints?: number;
      };
      const rewards = (loyalty.rewardStoreRedeemables?.entities ?? []).map(mapLoyaltyReward);
      const currentPoints = milestones.currentPoints ?? loyalty.estimatedPoints ?? 0;
      return { rewards, current_points: currentPoints };
    } catch {
      return { rewards: [], current_points: 0 };
    }
  },
});

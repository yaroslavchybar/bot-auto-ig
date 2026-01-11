/**
 * Engagement Activities
 * 
 * Activities for following/unfollowing users and managing requests.
 */

export { followUser } from './follow-user';
export { unfollowUser } from './unfollow-user';
export { approveRequests } from './approve-requests';

import { followUser } from './follow-user';
import { unfollowUser } from './unfollow-user';
import { approveRequests } from './approve-requests';

export const engagementActivities = [followUser, unfollowUser, approveRequests];

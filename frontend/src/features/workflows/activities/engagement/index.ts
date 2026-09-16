/**
 * Engagement Activities
 *
 * Activities for following/unfollowing users.
 */

export { followUser } from './follow-user'
export { unfollowUser } from './unfollow-user'

import { followUser } from './follow-user'
import { unfollowUser } from './unfollow-user'

export const engagementActivities = [followUser, unfollowUser]



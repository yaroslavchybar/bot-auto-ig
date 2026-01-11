/**
 * Browsing Activities
 * 
 * Activities for scrolling through feeds and reels.
 * Used for warming up accounts and natural behavior.
 */

export { browseFeed } from './browse-feed';
export { browseReels } from './browse-reels';

import { browseFeed } from './browse-feed';
import { browseReels } from './browse-reels';

export const browsingActivities = [browseFeed, browseReels];


import { query } from "./_generated/server";

export const getStats = query({
    args: {},
    handler: async (ctx) => {
        // Parallelize fetching counts for performance
        const [profiles, lists, instagramAccounts, recentActivity] = await Promise.all([
            ctx.db.query("profiles").collect(),
            ctx.db.query("lists").collect(),
            ctx.db.query("instagramAccounts").collect(),
            ctx.db.query("profiles").order("desc").take(5), // Latest modified profiles as activity
        ]);

        const profilesCount = profiles.length;
        // Simple heuristic: "Active" lists are those with profiles assigned, or just total lists for now.
        // Let's stick to total lists as per original design intention or maybe refine later.
        const activeListsCount = lists.length;

        // "Instagram Actions" - we don't have an actions log in Convex. 
        // We can use the total number of Instagram accounts as a proxy or "Accounts Managed".
        // Or if 'message' field implies an action, we count that.
        // Let's use total accounts for now.
        const instagramActionsCount = instagramAccounts.length;

        // Recent Activity
        // We will construct this from the latest profiles created/updated.
        const formattedActivity = recentActivity.map((p) => ({
            id: p._id,
            action: "Profile Updated", // simplified since we don't track update time
            details: p.name,
            timestamp: p._creationTime,
            timeAgo: "Just now",
        }));

        return {
            totalProfiles: profilesCount,
            activeLists: activeListsCount,
            instagramActions: instagramActionsCount,
            recentActivity: formattedActivity,
        };
    },
});

import { internalMutation } from "../_generated/server";

export const resetDailyScrapingUsed = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("profiles").collect();
		const toUpdate = rows.filter((r) => (r.dailyScrapingUsed || 0) !== 0);
		await Promise.all(toUpdate.map((p) => ctx.db.patch(p._id, { dailyScrapingUsed: 0 })));
		return true;
	},
});

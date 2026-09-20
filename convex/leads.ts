import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

import { normalizeUsername } from "./leadImport";

export const lists = query({
  args: {},
  handler: (ctx) => ctx.db.query("leadLists").collect(),
});
export const list = query({
  args: { listId: v.optional(v.id("leadLists")) },
  handler: async (ctx, { listId }) => {
    const rows = await ctx.db.query("leads").collect();
    return Promise.all(
      rows
        .filter((r) => !listId || r.listIds.includes(listId))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (row) => ({
          ...row,
          senderName: row.senderId
            ? ((await ctx.db.get(row.senderId))?.name ?? "Deleted profile")
            : undefined,
        })),
    );
  },
});
export const createList = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    if (!name.trim()) throw new Error("List name is required");
    return ctx.db.insert("leadLists", {
      name: name.trim(),
      createdAt: Date.now(),
    });
  },
});
export const importLeads = mutation({
  args: {
    listId: v.id("leadLists"),
    usernames: v.array(v.string()),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.listId)))
      throw new Error("Lead list not found");
    if (args.usernames.length > 500)
      throw new Error("Import at most 500 leads at once");
    let added = 0,
      duplicates = 0,
      invalid = 0;
    for (const raw of args.usernames) {
      const username = normalizeUsername(raw);
      if (!username) {
        invalid++;
        continue;
      }
      const existing = await ctx.db
        .query("leads")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique();
      if (existing) {
        duplicates++;
        if (!existing.listIds.includes(args.listId))
          await ctx.db.patch(existing._id, {
            listIds: [...existing.listIds, args.listId],
          });
      } else {
        await ctx.db.insert("leads", {
          username,
          listIds: [args.listId],
          source: args.source.trim(),
          status: "new",
          dmSent: false,
          followed: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        added++;
      }
    }
    return { added, duplicates, invalid };
  },
});
export const setStatus = mutation({
  args: {
    ids: v.array(v.id("leads")),
    status: v.union(
      v.literal("ready"),
      v.literal("contacted"),
      v.literal("replied"),
      v.literal("do_not_contact"),
    ),
  },
  handler: async (ctx, { ids, status }) => {
    for (const id of ids) {
      const lead = await ctx.db.get(id);
      if (!lead) continue;
      if (status === "ready" && !["new", "ready"].includes(lead.status))
        throw new Error(
          "Previously contacted or reserved leads cannot be queued again",
        );
      const confirmed = status === 'contacted' || status === 'replied';
      await ctx.db.patch(id, {
        status, updatedAt: Date.now(),
        ...(confirmed ? { dmSent: true } : {}),
        ...(lead.delivery && status !== 'ready' ? {
          delivery: { ...lead.delivery, state: confirmed || lead.dmSent ? 'sent' as const : 'cancelled' as const },
        } : {}),
      });
    }
  },
});

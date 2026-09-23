import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { paginationOptsValidator } from 'convex/server';

export const lists = query({
  args: {},
  handler: (ctx) => ctx.db.query("leadLists").collect(),
});
export const listPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    listId: v.optional(v.id('leadLists')),
    classification: v.optional(v.union(v.literal('male'), v.literal('female'), v.literal('business'))),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { paginationOpts, listId, classification, search }) => {
    const queryText = search?.trim().toLowerCase() ?? '';
    if (listId) {
      const memberships = await ctx.db.query('leadMemberships')
        .withIndex('by_list_created', q => q.eq('listId', listId)).order('desc')
        .paginate({ ...paginationOpts, numItems: Math.min(500, Math.max(100, paginationOpts.numItems)) });
      const rows = await Promise.all(memberships.page.map(membership => ctx.db.get(membership.leadId)));
      const matches = rows.filter((lead): lead is Doc<'leads'> => !!lead &&
        (!classification || lead.classification === classification) &&
        (!queryText || [lead.username, lead.fullName, lead.profilePicDescription]
          .some(value => value?.toLowerCase().includes(queryText))));
      return {
        isDone: memberships.isDone, continueCursor: memberships.continueCursor,
        page: await Promise.all(matches.map(async row => ({
          ...row,
          senderName: row.senderId ? (await ctx.db.get(row.senderId))?.name ?? 'Deleted profile' : undefined,
        }))),
      };
    }
    const base = classification
      ? ctx.db.query('leads').withIndex('by_classification', q => q.eq('classification', classification)).order('desc')
      : ctx.db.query('leads').order('desc');
    // Scan a bounded page even when list/search filters are sparse. The UI
    // advances through empty pages until it finds a match or reaches the end.
    const batch = await base.paginate({
      ...paginationOpts,
      numItems: queryText ? Math.min(500, Math.max(100, paginationOpts.numItems)) : paginationOpts.numItems,
    });
    const matches: Doc<'leads'>[] = batch.page.filter(lead =>
        (!queryText || [lead.username, lead.fullName, lead.profilePicDescription]
          .some(value => value?.toLowerCase().includes(queryText))));
    return {
      isDone: batch.isDone, continueCursor: batch.continueCursor,
      page: await Promise.all(matches.map(async row => ({
        ...row,
        senderName: row.senderId ? (await ctx.db.get(row.senderId))?.name ?? 'Deleted profile' : undefined,
      }))),
    };
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
export const renameList = internalMutation({
  args: { listId: v.id("leadLists"), name: v.string() },
  handler: async (ctx, { listId, name }) => {
    if (!name.trim()) throw new Error("List name is required");
    if (!(await ctx.db.get(listId))) throw new Error("Lead list not found");
    await ctx.db.patch(listId, { name: name.trim() });
  },
});
export const deleteList = internalMutation({
  args: { listId: v.id("leadLists") },
  handler: async (ctx, { listId }) => {
    if (!(await ctx.db.get(listId))) return;
    await ctx.db.delete(listId);
    await ctx.scheduler.runAfter(0, internal.leads.cleanupDeletedList, { listId });
  },
});

/** Delete only this list's memberships in bounded batches. */
export const cleanupDeletedList = internalMutation({
  args: { listId: v.id('leadLists') },
  handler: async (ctx, { listId }) => {
    const rows = await ctx.db.query('leadMemberships')
      .withIndex('by_list_created', q => q.eq('listId', listId)).take(100);
    await Promise.all(rows.map(row => ctx.db.delete(row._id)));
    if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.leads.cleanupDeletedList, { listId });
  },
});

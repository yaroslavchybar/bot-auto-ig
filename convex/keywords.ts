import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const get = internalQuery({
    args: { filename: v.string() },
    handler: async (ctx, args) => {
        const doc = await ctx.db
            .query("keywords")
            .withIndex("by_filename", (q) => q.eq("filename", args.filename))
            .first();
        if (!doc) return null;
        return doc.content;
    },
});

export const list = internalQuery({
    args: {},
    handler: async (ctx) => {
        const docs = await ctx.db.query("keywords").collect();
        return docs.map((d) => ({
            _id: d._id,
            filename: d.filename,
            _creationTime: d._creationTime,
        }));
    },
});

export const upsert = internalMutation({
    args: {
        filename: v.string(),
        content: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("keywords")
            .withIndex("by_filename", (q) => q.eq("filename", args.filename))
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, { content: args.content });
            return { _id: existing._id, updated: true };
        }

        const id = await ctx.db.insert("keywords", {
            filename: args.filename,
            content: args.content,
        });
        return { _id: id, updated: false };
    },
});

export const remove = internalMutation({
    args: { filename: v.string() },
    handler: async (ctx, args) => {
        const doc = await ctx.db
            .query("keywords")
            .withIndex("by_filename", (q) => q.eq("filename", args.filename))
            .first();
        if (!doc) throw new Error(`Keyword file '${args.filename}' not found`);
        await ctx.db.delete(doc._id);
        return { deleted: true };
    },
});

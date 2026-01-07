import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	lists: defineTable({
		name: v.string(),
		createdAt: v.number(),
	}),

	profiles: defineTable({
		createdAt: v.number(),
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		status: v.optional(v.string()),
		mode: v.optional(v.string()),
		using: v.boolean(),
		testIp: v.boolean(),
		fingerprintSeed: v.optional(v.string()),
		fingerprintOs: v.optional(v.string()),
		listId: v.optional(v.id("lists")),
		sessionsToday: v.number(),
		lastOpenedAt: v.optional(v.number()),
		login: v.boolean(),
	})
		.index("by_listId", ["listId"])
		.index("by_name", ["name"])
		.index("by_status", ["status"]),

	instagramAccounts: defineTable({
		userName: v.string(),
		createdAt: v.number(),
		assignedTo: v.optional(v.id("profiles")),
		status: v.optional(v.string()),
		linkSent: v.optional(v.string()),
		message: v.boolean(),
		subscribedAt: v.optional(v.number()),
		lastMessageSentAt: v.optional(v.number()),
	})
		.index("by_userName", ["userName"])
		.index("by_assignedTo", ["assignedTo"])
		.index("by_status", ["status"])
		.index("by_assignedTo_status", ["assignedTo", "status"]),

	instagramSettings: defineTable({
		scope: v.string(),
		data: v.any(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_scope", ["scope"]),

	messageTemplates: defineTable({
		kind: v.string(),
		texts: v.array(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_kind", ["kind"]),
});

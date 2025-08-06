import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("settings")
      .first();
    
    // Return default settings if none exist
    if (!settings) {
      return {
        model: "llama-3.3-70b",
        temperature: 0.7,
        topP: 0.9,
        minP: 0.05,
        maxTokens: 2048,
        topK: 40,
        repetitionPenalty: 1.2,
        webSearch: "auto" as const,
        webCitations: true,
        includeSearchResults: true,
        stripThinking: false,
        disableThinking: false,
      };
    }
    
    return settings;
  },
});

export const update = mutation({
  args: {
    model: v.optional(v.string()),
    temperature: v.optional(v.number()),
    topP: v.optional(v.number()),
    minP: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    topK: v.optional(v.number()),
    repetitionPenalty: v.optional(v.number()),
    webSearch: v.optional(v.union(v.literal("off"), v.literal("auto"), v.literal("on"))),
    webCitations: v.optional(v.boolean()),
    includeSearchResults: v.optional(v.boolean()),
    stripThinking: v.optional(v.boolean()),
    disableThinking: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existingSettings = await ctx.db
      .query("settings")
      .first();
    
    if (existingSettings) {
      await ctx.db.patch(existingSettings._id, args);
    } else {
      await ctx.db.insert("settings", {
        userId: "default",
        model: args.model || "llama-3.3-70b",
        temperature: args.temperature || 0.7,
        topP: args.topP || 0.9,
        minP: args.minP || 0.05,
        maxTokens: args.maxTokens || 2048,
        topK: args.topK || 40,
        repetitionPenalty: args.repetitionPenalty || 1.2,
        webSearch: args.webSearch || "auto",
        webCitations: args.webCitations ?? true,
        includeSearchResults: args.includeSearchResults ?? true,
        stripThinking: args.stripThinking ?? false,
        disableThinking: args.disableThinking ?? false,
      });
    }
  },
});
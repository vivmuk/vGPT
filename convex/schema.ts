import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  settings: defineTable({
    userId: v.string(), // For future user support
    model: v.string(),
    temperature: v.number(),
    topP: v.number(),
    minP: v.number(),
    maxTokens: v.number(),
    topK: v.number(),
    repetitionPenalty: v.number(),
    webSearch: v.union(v.literal("off"), v.literal("auto"), v.literal("on")),
    webCitations: v.boolean(),
    includeSearchResults: v.boolean(),
    stripThinking: v.boolean(),
    disableThinking: v.boolean(),
  }),
});
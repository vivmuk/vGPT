"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

export const sendMessage = action({
  args: {
    messages: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
    })),
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
  },
  handler: async (ctx, args) => {
    const apiKey = "ntmhtbP2fr_pOQsmuLPuN_nm6lm2INWKiNcvrdEfEC";

    const requestBody = {
      model: args.model,
      messages: args.messages,
      temperature: args.temperature,
      top_p: args.topP,
      min_p: args.minP,
      max_tokens: args.maxTokens,
      top_k: args.topK,
      repetition_penalty: args.repetitionPenalty,
      stream: false,
      venice_parameters: {
        character_slug: "venice",
        strip_thinking_response: args.stripThinking,
        disable_thinking: args.disableThinking,
        enable_web_search: args.webSearch,
        enable_web_citations: args.webCitations,
        include_search_results_in_stream: args.includeSearchResults,
        include_venice_system_prompt: true,
      },
    };

    try {
      const response = await fetch("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Venice API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      return {
        content: data.choices[0]?.message?.content || "",
        usage: data.usage || null,
      };
    } catch (error) {
      console.error("Venice API error:", error);
      throw new Error(`Failed to get response from Venice AI: ${error}`);
    }
  },
});

export const getModels = action({
  args: {},
  handler: async (ctx) => {
    const apiKey = "ntmhtbP2fr_pOQsmuLPuN_nm6lm2INWKiNcvrdEfEC";

    try {
      const response = await fetch("https://api.venice.ai/api/v1/models", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Venice API error: ${response.status}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("Venice API error:", error);
      throw new Error(`Failed to get models from Venice AI: ${error}`);
    }
  },
});
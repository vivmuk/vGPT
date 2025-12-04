export type WebSearchMode = 'off' | 'auto' | 'on';

export interface AppSettings {
  model: string;
  temperature: number;
  topP: number;
  minP: number;
  maxTokens: number;
  topK: number;
  repetitionPenalty: number;
  webSearch: WebSearchMode;
  webCitations: boolean;
  includeSearchResults: boolean;
  includeVeniceSystemPrompt: boolean;
  stripThinking: boolean;
  disableThinking: boolean;
  imageModel: string;
  imageSteps: number;
  imageWidth: number;
  imageHeight: number;
  imageGuidanceScale: number;
}

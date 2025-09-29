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
  stripThinking: boolean;
  disableThinking: boolean;
}

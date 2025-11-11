import { AppSettings } from '@/types/settings';

export const DEFAULT_SETTINGS: AppSettings = {
  model: 'llama-3.3-70b',
  temperature: 0.7,
  topP: 0.9,
  minP: 0.05,
  maxTokens: 4096,
  topK: 40,
  repetitionPenalty: 1.2,
  webSearch: 'auto',
  webCitations: true,
  includeSearchResults: true,
  stripThinking: false,
  disableThinking: false,
  imageModel: '',
  imageSteps: 8,
  imageWidth: 1024,
  imageHeight: 1024,
  imageGuidanceScale: 7.5,
};

export interface VeniceModel {
  id: string;
  model_spec: {
    name: string;
    pricing: {
      input: { usd: number; vcu: number; diem: number } | Record<string, number>;
      output: { usd: number; vcu: number; diem: number } | Record<string, number>;
    };
    availableContextTokens?: number;
    capabilities: {
      optimizedForCode?: boolean;
      quantization?: string;
      supportsFunctionCalling?: boolean;
      supportsReasoning?: boolean;
      supportsResponseSchema?: boolean;
      supportsVision?: boolean;
      supportsWebSearch?: boolean;
      supportsLogProbs?: boolean;
    };
    constraints: {
      temperature?: { default?: number } | number;
      top_p?: { default?: number } | number;
      max_output_tokens?: { default?: number; max?: number } | number;
      maxOutputTokens?: { default?: number; max?: number } | number;
      max_tokens?: { default?: number; max?: number } | number;
      response_tokens?: { default?: number; max?: number } | number;
      [key: string]: any;
    };
    modelSource: string;
    offline: boolean;
    traits: string[];
    beta?: boolean;
  };
}

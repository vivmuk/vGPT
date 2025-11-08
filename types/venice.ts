export type VeniceModelType = 'text' | 'image' | 'audio' | 'embedding' | 'rerank' | string;

export interface VeniceModel {
  id: string;
  object?: string;
  type?: VeniceModelType;
  owned_by?: string;
  model_spec: {
    name: string;
    pricing: {
      input?: { usd: number; vcu?: number; diem?: number } | Record<string, number>;
      output?: { usd: number; vcu?: number; diem?: number } | Record<string, number>;
      generation?: { usd: number; vcu?: number; diem?: number } | Record<string, number>;
      upscale?: Record<string, { usd: number; vcu?: number; diem?: number }> | Record<string, number>;
      [key: string]: any;
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
      supportsImageGeneration?: boolean;
      [key: string]: any;
    };
    constraints: {
      temperature?: { default?: number; max?: number; min?: number } | number;
      top_p?: { default?: number; max?: number; min?: number } | number;
      max_output_tokens?: { default?: number; max?: number; min?: number } | number;
      maxOutputTokens?: { default?: number; max?: number; min?: number } | number;
      max_tokens?: { default?: number; max?: number; min?: number } | number;
      response_tokens?: { default?: number; max?: number; min?: number } | number;
      steps?: { default?: number; max?: number; min?: number } | number;
      width?: { default?: number; max?: number; min?: number } | number;
      height?: { default?: number; max?: number; min?: number } | number;
      guidance_scale?: { default?: number; max?: number; min?: number } | number;
      widthHeightDivisor?: number;
      [key: string]: any;
    };
    modelSource: string;
    offline: boolean;
    traits: string[];
    beta?: boolean;
  };
}

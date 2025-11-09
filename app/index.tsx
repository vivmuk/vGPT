import React, { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  FlatList,
  Linking,
  ScrollView,
  ActivityIndicator
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
// Hardcoded API key in code as requested
import { BlurView } from 'expo-blur';
import { Animated, Easing } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { DEFAULT_SETTINGS } from '@/constants/settings';
import { AppSettings } from '@/types/settings';
import { VeniceModel } from '@/types/venice';
import { loadStoredSettings, persistSettings } from '@/utils/settingsStorage';
import { theme } from '@/constants/theme';
import {
  VENICE_API_KEY,
  VENICE_CHAT_COMPLETIONS_ENDPOINT,
  VENICE_IMAGE_GENERATIONS_ENDPOINT,
  VENICE_MODELS_ENDPOINT,
} from '@/constants/venice';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  id: string;
  thinking?: string;
  images?: { uri: string; mimeType: string; dataUrl?: string }[];
  metrics?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    tokensPerSecond: number;
    responseTime: number;
    model: string;
  };
  references?: VeniceReference[];
}

interface VeniceReference {
  id?: string | number;
  title?: string;
  url?: string;
  snippet?: string;
}

interface GeneratedImage {
  id: string;
  prompt: string;
  modelId: string;
  createdAt: number;
  imageData: string;
  width?: number;
  height?: number;
}

const getConstraintNumber = (constraint: any): number | undefined => {
  if (constraint == null) return undefined;
  if (typeof constraint === 'number') return constraint;
  if (typeof constraint.default === 'number') return constraint.default;
  if (typeof constraint.max === 'number') return constraint.max;
  if (typeof constraint.min === 'number') return constraint.min;
  return undefined;
};

const getModelDefaultMaxTokens = (model?: VeniceModel | null): number | undefined => {
  if (!model) return undefined;
  const constraints = model.model_spec?.constraints || {};
  const candidates: any[] = [
    constraints.max_output_tokens,
    constraints.maxOutputTokens,
    constraints.max_tokens,
    constraints.response_tokens,
  ];

  for (const candidate of candidates) {
    const value = getConstraintNumber(candidate);
    if (typeof value === 'number' && value > 0) {
      return value;
    }
  }

  if (typeof model.model_spec.availableContextTokens === 'number') {
    return model.model_spec.availableContextTokens;
  }

  return undefined;
};

const isImageModel = (model?: VeniceModel | null): boolean => {
  if (!model) return false;

  // Check model type first
  const modelType = model.type?.toLowerCase?.() ?? '';
  if (modelType === 'image' || modelType.includes('image') || modelType.includes('diffusion')) {
    return true;
  }

  // Check capabilities
  const capabilities = model.model_spec?.capabilities || {};
  if (capabilities.supportsImageGeneration === true || capabilities.image === true || capabilities.supportsImage === true) {
    return true;
  }

  // Check capability keys
  const capabilityKeys = Object.keys(capabilities);
  if (capabilityKeys.some((key) => {
    const lowerKey = key.toLowerCase();
    return (lowerKey.includes('image') || lowerKey.includes('generation')) && capabilities[key] === true;
  })) {
    return true;
  }

  // Check traits
  if (Array.isArray(model.model_spec?.traits)) {
    if (model.model_spec.traits.some((trait) => {
      const lowerTrait = String(trait).toLowerCase();
      return lowerTrait.includes('image') || lowerTrait.includes('generation') || lowerTrait.includes('diffusion');
    })) {
      return true;
    }
  }

  // Check pricing - if it has generation pricing, it's likely an image model
  if (model.model_spec?.pricing?.generation) {
    return true;
  }

  // Check model source
  const source = model.model_spec?.modelSource?.toLowerCase() ?? '';
  if (source.includes('stable-diffusion') || source.includes('flux') || source.includes('dall-e') || source.includes('midjourney')) {
    return true;
  }

  // Check model ID - be more lenient
  const modelId = model.id.toLowerCase();
  const imageKeywords = ['image', 'flux', 'sd', 'stable-diffusion', 'dalle', 'midjourney', 'imagen', 'venice-sd', 'venice-flux'];
  if (imageKeywords.some(keyword => modelId.includes(keyword))) {
    return true;
  }

  // Check model name
  const modelName = model.model_spec?.name?.toLowerCase() ?? '';
  if (imageKeywords.some(keyword => modelName.includes(keyword))) {
    return true;
  }

  return false;
};

const mistralMatcher = /mistral/i;

const findMistralModel = (models: VeniceModel[]): VeniceModel | undefined => {
  return models.find((model) => mistralMatcher.test(model.id) || mistralMatcher.test(model.model_spec?.name ?? ''));
};

const getConstraintDefaults = (model: VeniceModel | undefined | null, key: string, fallback?: number): number | undefined => {
  if (!model) return fallback;
  const constraints = model.model_spec?.constraints || {};
  const value = constraints[key];
  const numeric = getConstraintNumber(value);
  if (typeof numeric === 'number') {
    return numeric;
  }
  return fallback;
};

const clampToConstraint = (
  value: number,
  model: VeniceModel | undefined | null,
  key: string,
  fallback?: number
): number => {
  const constraints = model?.model_spec?.constraints || {};
  const constraint = constraints[key];
  if (constraint == null || typeof constraint === 'number') {
    return constraint != null ? constraint : value;
  }

  const min = typeof constraint.min === 'number' ? constraint.min : undefined;
  const max = typeof constraint.max === 'number' ? constraint.max : undefined;
  const defaultValue = typeof constraint.default === 'number' ? constraint.default : fallback;

  let next = value;
  if (typeof min === 'number') {
    next = Math.max(min, next);
  }
  if (typeof max === 'number') {
    next = Math.min(max, next);
  }

  if (Number.isNaN(next)) {
    return defaultValue ?? value;
  }

  return next;
};

const MODEL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const completionParameterConstraints: Record<string, string[]> = {
  temperature: ['temperature'],
  top_p: ['top_p'],
  min_p: ['min_p'],
  max_tokens: ['max_output_tokens', 'maxOutputTokens', 'max_tokens', 'response_tokens'],
  top_k: ['top_k'],
  repetition_penalty: ['repetition_penalty'],
};

const shouldIncludeCompletionParameter = (model: VeniceModel | undefined, parameter: keyof typeof completionParameterConstraints): boolean => {
  if (!model) return true;
  const keys = completionParameterConstraints[parameter] || [];
  const constraints = model.model_spec?.constraints || {};
  return keys.some((key) => Object.prototype.hasOwnProperty.call(constraints, key));
};

const getImageDimension = (model: VeniceModel | undefined, key: 'width' | 'height', fallback: number): number => {
  const defaultValue = getConstraintDefaults(model, key, fallback);
  return defaultValue ?? fallback;
};

const getImageSteps = (model: VeniceModel | undefined, fallback: number): number => {
  const defaultValue = getConstraintDefaults(model, 'steps', fallback);
  return defaultValue ?? fallback;
};

const getImageGuidance = (model: VeniceModel | undefined, fallback: number): number => {
  const defaultValue = getConstraintDefaults(model, 'guidance_scale', fallback);
  return defaultValue ?? fallback;
};

interface SuggestedImageSize {
  label: string;
  width: number;
  height: number;
}

const buildSuggestedImageSizes = (model: VeniceModel | undefined, settings: AppSettings): SuggestedImageSize[] => {
  const divisor = model?.model_spec?.constraints?.widthHeightDivisor || 8;
  const baseWidth = clampToConstraint(settings.imageWidth, model, 'width', settings.imageWidth);
  const baseHeight = clampToConstraint(settings.imageHeight, model, 'height', settings.imageHeight);

  const normalize = (value: number) => Math.round(value / divisor) * divisor;

  const square = normalize(Math.min(baseWidth, baseHeight));
  const landscape = normalize(Math.max(baseWidth, Math.round((baseHeight * 4) / 3)));
  const portrait = normalize(Math.max(baseHeight, Math.round((baseWidth * 4) / 3)));

  const sizes: SuggestedImageSize[] = [
    { label: 'Square', width: square, height: square },
    { label: 'Portrait', width: normalize(Math.round(square * 0.75)), height: portrait },
    { label: 'Landscape', width: landscape, height: normalize(Math.round(square * 0.75)) },
  ];

  const unique: SuggestedImageSize[] = [];
  for (const size of sizes) {
    if (!unique.some((entry) => entry.width === size.width && entry.height === size.height)) {
      unique.push(size);
    }
  }

  return unique;
};

const inlineMarkdownRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[(.+?)\]\((.+?)\))/g;

// Extract formatted text from markdown content for clipboard
const extractFormattedText = (content: string): string => {
  if (!content) return '';
  
  // Replace markdown with formatted text
  let formatted = content;
  
  // Convert headings
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, (match, text) => {
    const level = match.match(/^#+/)?.[0].length ?? 1;
    const prefix = '#'.repeat(level) + ' ';
    return prefix + text;
  });
  
  // Convert bold
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, '**$1**');
  
  // Convert italic
  formatted = formatted.replace(/\*(.+?)\*/g, '*$1*');
  
  // Convert code blocks
  formatted = formatted.replace(/```([\s\S]*?)```/g, '```\n$1\n```');
  formatted = formatted.replace(/`(.+?)`/g, '`$1`');
  
  // Convert links to readable format
  formatted = formatted.replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');
  
  // Convert lists - preserve bullet points
  formatted = formatted.replace(/^\s*[-*]\s+(.+)$/gm, '• $1');
  
  // Convert numbered lists
  formatted = formatted.replace(/^\s*\d+\.\s+(.+)$/gm, (match, text, offset, string) => {
    const lineNum = string.substring(0, offset).split('\n').length;
    return `${lineNum}. ${text}`;
  });
  
  // Clean up extra whitespace but preserve paragraph breaks
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  
  return formatted.trim();
};

const renderInlineMarkdown = (text: string, keyPrefix: string) => {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = inlineMarkdownRegex.exec(text)) !== null) {
    const [fullMatch] = match;
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      nodes.push(
        <Text key={`${keyPrefix}-plain-${index}`} style={styles.inlineText} selectable>
          {text.slice(lastIndex, matchStart)}
        </Text>
      );
      index += 1;
    }

    if (fullMatch.startsWith('**')) {
      const content = fullMatch.slice(2, -2);
      nodes.push(
        <Text key={`${keyPrefix}-bold-${index}`} style={styles.inlineBold} selectable>
          {content}
        </Text>
      );
    } else if (fullMatch.startsWith('*')) {
      const content = fullMatch.slice(1, -1);
      nodes.push(
        <Text key={`${keyPrefix}-italic-${index}`} style={styles.inlineItalic} selectable>
          {content}
        </Text>
      );
    } else if (fullMatch.startsWith('`')) {
      const content = fullMatch.slice(1, -1);
      nodes.push(
        <Text key={`${keyPrefix}-code-${index}`} style={styles.inlineCode} selectable>
          {content}
        </Text>
      );
    } else if (fullMatch.startsWith('[')) {
      const label = match?.[2] ?? '';
      const url = match?.[3] ?? '';
      nodes.push(
        <Text
          key={`${keyPrefix}-link-${index}`}
          style={styles.inlineLink}
          selectable
          onPress={() => {
            if (url) {
              Linking.openURL(url).catch(() => {
                Alert.alert('Unable to open link', 'The reference link could not be opened.');
              });
            }
          }}
        >
          {label}
        </Text>
      );
    }

    index += 1;
    lastIndex = matchStart + fullMatch.length;
  }

  if (lastIndex < text.length) {
    nodes.push(
      <Text key={`${keyPrefix}-plain-${index}`} style={styles.inlineText} selectable>
        {text.slice(lastIndex)}
      </Text>
    );
  }

  if (nodes.length === 0) {
    return [
      <Text key={`${keyPrefix}-plain`} style={styles.inlineText} selectable>
        {text}
      </Text>,
    ];
  }

  return nodes;
};

const RichText: React.FC<{ content: string }> = ({ content }) => {
  if (!content || content.trim().length === 0) {
    return null;
  }

  // Split by double newlines for paragraphs, but also handle code blocks
  const sections: string[] = [];
  let currentSection = '';
  let inCodeBlock = false;
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isCodeBlockStart = /^```/.test(line);
    const isCodeBlockEnd = /^```/.test(line) && inCodeBlock;

    if (isCodeBlockStart && !inCodeBlock) {
      if (currentSection.trim()) {
        sections.push(currentSection.trim());
        currentSection = '';
      }
      inCodeBlock = true;
      currentSection += line + '\n';
    } else if (isCodeBlockEnd) {
      currentSection += line;
      sections.push(currentSection);
      currentSection = '';
      inCodeBlock = false;
    } else if (inCodeBlock) {
      currentSection += line + '\n';
    } else if (line.trim() === '' && currentSection.trim()) {
      sections.push(currentSection.trim());
      currentSection = '';
    } else if (line.trim() !== '') {
      currentSection += line + '\n';
    }
  }

  if (currentSection.trim()) {
    sections.push(currentSection.trim());
  }

  if (sections.length === 0) {
    return null;
  }

  return (
    <View style={styles.richTextContainer}>
      {sections.map((section, sectionIndex) => {
        const trimmed = section.trim();
        if (!trimmed) return null;

        // Code blocks
        if (trimmed.startsWith('```')) {
          const codeMatch = trimmed.match(/^```(\w+)?\n([\s\S]*?)```$/);
          if (codeMatch) {
            const language = codeMatch[1] || '';
            const code = codeMatch[2];
            return (
              <View key={`code-${sectionIndex}`} style={styles.codeBlock}>
                {language && (
                  <Text style={styles.codeBlockLanguage} selectable>
                    {language}
                  </Text>
                )}
                <Text style={styles.codeBlockText} selectable>
                  {code}
                </Text>
              </View>
            );
          }
        }

        // Headings
        if (/^#{1,6}\s/.test(trimmed)) {
          const level = trimmed.match(/^#+/)?.[0].length ?? 1;
          const headingLevel = Math.min(level, 3);
          const headingStyle =
            headingLevel === 1 ? styles.headingLevel1 : headingLevel === 2 ? styles.headingLevel2 : styles.headingLevel3;
          const heading = trimmed.replace(/^#{1,6}\s*/, '');
          return (
            <Text key={`heading-${sectionIndex}`} style={[styles.headingText, headingStyle]} selectable>
              {renderInlineMarkdown(heading, `heading-${sectionIndex}`)}
            </Text>
          );
        }

        // Lists (bullets and numbered)
        if (/^\s*[-*]\s+/m.test(trimmed) || /^\s*\d+\.\s+/m.test(trimmed)) {
          const isNumbered = /^\s*\d+\.\s+/m.test(trimmed);
          const listLines = trimmed.split(/\n/g).filter((line) => 
            /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)
          );
          return (
            <View key={`list-${sectionIndex}`} style={styles.bulletList}>
              {listLines.map((line, lineIndex) => {
                const text = line.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+\.\s+/, '');
                const isNumberedItem = /^\s*\d+\.\s+/.test(line);
                return (
                  <View key={`list-${sectionIndex}-${lineIndex}`} style={styles.bulletRow}>
                    {isNumbered ? (
                      <Text style={styles.bulletNumber} selectable>
                        {lineIndex + 1}.
                      </Text>
                    ) : (
                      <Text style={styles.bulletDot} selectable>
                        •
                      </Text>
                    )}
                    <Text style={styles.inlineText} selectable>
                      {renderInlineMarkdown(text, `list-${sectionIndex}-${lineIndex}`)}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        }

        // Regular paragraphs
        if (trimmed.includes('\n')) {
          const lines = trimmed.split('\n');
          return (
            <View key={`paragraph-${sectionIndex}`} style={styles.paragraphBlock}>
              {lines.map((line, lineIndex) => (
                <Text key={`paragraph-${sectionIndex}-${lineIndex}`} style={styles.inlineText} selectable>
                  {renderInlineMarkdown(line, `paragraph-${sectionIndex}-${lineIndex}`)}
                </Text>
              ))}
            </View>
          );
        }

        return (
          <Text key={`paragraph-${sectionIndex}`} style={styles.inlineText} selectable>
            {renderInlineMarkdown(trimmed, `paragraph-${sectionIndex}`)}
          </Text>
        );
      })}
    </View>
  );
};

const normalizeReference = (ref: any, index: number): VeniceReference | null => {
  if (!ref) return null;

  if (typeof ref === 'string') {
    return {
      id: index,
      url: ref,
      title: ref,
    };
  }

  const metadata = ref.metadata || {};
  const url =
    ref.url ||
    ref.link ||
    ref.href ||
    ref.source_url ||
    metadata.url ||
    metadata.link ||
    metadata.href ||
    metadata.source_url ||
    ref.website?.url ||
    ref.website ||
    metadata.website?.url ||
    metadata.website;
  const title =
    ref.title ||
    ref.name ||
    ref.page_title ||
    metadata.title ||
    metadata.name ||
    metadata.page_title ||
    ref.website?.title ||
    ref.website?.name ||
    metadata.website?.title ||
    metadata.website?.name ||
    ref.source ||
    ref.domain;
  const snippet =
    ref.snippet ||
    ref.text ||
    ref.content ||
    ref.excerpt ||
    ref.description ||
    metadata.snippet ||
    metadata.text ||
    metadata.content ||
    metadata.excerpt ||
    metadata.description;
  const id = ref.id ?? ref.citation_id ?? ref.document_id ?? index;

  if (!url && !title && !snippet) {
    return null;
  }

  return {
    id,
    title,
    url,
    snippet,
  };
};

const extractVeniceReferences = (data: any): VeniceReference[] => {
  const references: VeniceReference[] = [];
  const potentialSources = [
    data?.choices?.[0]?.message?.metadata?.citations,
    data?.choices?.[0]?.message?.metadata?.references,
    data?.choices?.[0]?.message?.metadata?.search_results,
    data?.choices?.[0]?.message?.citations,
    data?.choices?.[0]?.message?.references,
    data?.choices?.[0]?.citations,
    data?.choices?.[0]?.references,
    data?.choices?.[0]?.search_results,
    data?.citations,
    data?.references,
    data?.search_results,
  ];

  potentialSources.forEach((source) => {
    if (!source) return;
    if (Array.isArray(source)) {
      source.forEach((ref: any) => {
        const normalized = normalizeReference(ref, references.length);
        if (normalized) {
          references.push(normalized);
        }
      });
    } else if (typeof source === 'object') {
      Object.values(source).forEach((ref: any) => {
        const normalized = normalizeReference(ref, references.length);
        if (normalized) {
          references.push(normalized);
        }
      });
    }
  });

  return references;
};

const sanitizeContentWithReferences = (content: string, references: VeniceReference[]): string => {
  if (!content) return '';

  let counter = 0;
  let sanitized = content.replace(/\[\/REF\]/g, '');

  if (references?.length) {
    sanitized = sanitized.replace(/\[REF[^\]]*\]/g, () => {
      counter += 1;
      if (counter <= references.length) {
        return ` [${counter}]`;
      }
      return '';
    });
  } else {
    sanitized = sanitized.replace(/\[REF[^\]]*\]/g, '');
  }

  sanitized = sanitized.replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n');

  return sanitized.trim();
};

const splitThinkingFromContent = (fullText: string): { thinking: string; content: string } => {
  if (!fullText) {
    return { thinking: '', content: '' };
  }

  let thinking = '';
  let content = fullText;

  if (fullText.includes('<think>') && fullText.includes('</think>')) {
    const thinkMatch = fullText.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      content = fullText.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    }
  }

  return { thinking, content };
};

const resolveUsdPrice = (pricingSection: unknown): number | undefined => {
  if (pricingSection == null) {
    return undefined;
  }

  if (typeof pricingSection === 'number') {
    return pricingSection;
  }

  if (typeof pricingSection === 'object' && 'usd' in (pricingSection as Record<string, unknown>)) {
    const value = (pricingSection as Record<string, unknown>).usd;
    return typeof value === 'number' ? value : undefined;
  }

  return undefined;
};

export default function ChatScreen() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<VeniceModel[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'image'>('chat');
  const [imagePrompt, setImagePrompt] = useState('');
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [hasWarnedNoMistral, setHasWarnedNoMistral] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);
  const previousChatModelRef = useRef<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<{ uri: string; mimeType: string }[]>([]);
  const activeRequestControllerRef = useRef<AbortController | null>(null);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [imageOptions, setImageOptions] = useState({
    steps: DEFAULT_SETTINGS.imageSteps,
    width: DEFAULT_SETTINGS.imageWidth,
    height: DEFAULT_SETTINGS.imageHeight,
    guidance: DEFAULT_SETTINGS.imageGuidanceScale,
  });
  const [showAdvancedImageOptions, setShowAdvancedImageOptions] = useState(false);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      const stored = await loadStoredSettings<AppSettings>(DEFAULT_SETTINGS);
      if (isMounted) {
        setSettings((prev) => ({ ...prev, ...stored }));
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      activeRequestControllerRef.current?.abort();
    };
  }, []);

  const textModels = useMemo(() => models.filter((model) => !isImageModel(model)), [models]);
  const imageModels = useMemo(() => models.filter((model) => isImageModel(model)), [models]);

  const updateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updatedSettings = { ...prev, ...newSettings };
      void persistSettings(updatedSettings);
      return updatedSettings;
    });
  }, []);

  useEffect(() => {
    if (textModels.length === 0) {
      return;
    }

    if (!settings.model || !textModels.some((model) => model.id === settings.model)) {
      updateSettings({ model: textModels[0].id });
    }
  }, [textModels, settings.model, updateSettings]);

  useEffect(() => {
    if (imageModels.length === 0) {
      return;
    }

    if (!settings.imageModel || !imageModels.some((model) => model.id === settings.imageModel)) {
      updateSettings({ imageModel: imageModels[0].id });
    }
  }, [imageModels, settings.imageModel, updateSettings]);

  useEffect(() => {
    setImageOptions({
      steps: settings.imageSteps,
      width: settings.imageWidth,
      height: settings.imageHeight,
      guidance: settings.imageGuidanceScale,
    });
  }, [settings.imageSteps, settings.imageWidth, settings.imageHeight, settings.imageGuidanceScale]);

  const currentModel = useMemo(
    () => textModels.find((model) => model.id === settings.model),
    [textModels, settings.model]
  );

  const currentImageModel = useMemo(
    () => imageModels.find((model) => model.id === settings.imageModel),
    [imageModels, settings.imageModel]
  );

  const suggestedImageSizes = useMemo(
    () => buildSuggestedImageSizes(currentImageModel, settings),
    [currentImageModel, settings]
  );

  useEffect(() => {
    if (!currentImageModel) {
      return;
    }

    setImageOptions((prev) => ({
      steps: clampToConstraint(prev.steps ?? settings.imageSteps, currentImageModel, 'steps', settings.imageSteps),
      width: clampToConstraint(prev.width ?? settings.imageWidth, currentImageModel, 'width', settings.imageWidth),
      height: clampToConstraint(prev.height ?? settings.imageHeight, currentImageModel, 'height', settings.imageHeight),
      guidance: clampToConstraint(prev.guidance ?? settings.imageGuidanceScale, currentImageModel, 'guidance_scale', settings.imageGuidanceScale),
    }));
  }, [currentImageModel, settings.imageSteps, settings.imageWidth, settings.imageHeight, settings.imageGuidanceScale]);

  useEffect(() => {
    if (messages.length > 0) {
      const timeoutId = setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({ index: Math.max(0, messages.length - 1), animated: true });
        } catch {
          // ignore out-of-range errors; onContentSizeChange will also scroll
        }
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [messages.length]);

  const loadModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const response = await fetch(VENICE_MODELS_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${VENICE_API_KEY}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Venice API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const incomingModels: VeniceModel[] = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.models)
        ? data.models
        : [];

      // Debug: Log image models
      const detectedImageModels = incomingModels.filter((model) => isImageModel(model));
      console.log(`Loaded ${incomingModels.length} total models, ${detectedImageModels.length} image models`);
      if (detectedImageModels.length > 0) {
        console.log('Image models:', detectedImageModels.map(m => ({ id: m.id, name: m.model_spec?.name, type: m.type })));
      } else {
        console.log('No image models detected. Sample models:', incomingModels.slice(0, 3).map(m => ({
          id: m.id,
          name: m.model_spec?.name,
          type: m.type,
          capabilities: m.model_spec?.capabilities,
          pricing: m.model_spec?.pricing
        })));
      }

      setModels(incomingModels);
    } catch (error) {
      console.error('Failed to load models:', error);
      Alert.alert('Error', 'Failed to load available models');
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      loadModels();
    }, MODEL_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [loadModels]);

  const handleChatModelSelect = useCallback(
    (modelId: string) => {
      const selectedModel = textModels.find((model) => model.id === modelId);
      const defaultMaxTokens = getModelDefaultMaxTokens(selectedModel);
      const updates: Partial<AppSettings> = { model: modelId };
      if (defaultMaxTokens && defaultMaxTokens > 0) {
        updates.maxTokens = defaultMaxTokens;
      }

      updateSettings(updates);
    setShowModelPicker(false);
    },
    [textModels, updateSettings]
  );

  const handleImageModelSelect = useCallback(
    (modelId: string) => {
      const selectedModel = imageModels.find((model) => model.id === modelId);
      if (!selectedModel) {
        return;
      }

      const nextSteps = getImageSteps(selectedModel, settings.imageSteps);
      const nextWidth = getImageDimension(selectedModel, 'width', settings.imageWidth);
      const nextHeight = getImageDimension(selectedModel, 'height', settings.imageHeight);
      const nextGuidance = getImageGuidance(selectedModel, settings.imageGuidanceScale);

      updateSettings({
        imageModel: modelId,
        imageSteps: nextSteps,
        imageWidth: nextWidth,
        imageHeight: nextHeight,
        imageGuidanceScale: nextGuidance,
      });

      setImageOptions({
        steps: nextSteps,
        width: nextWidth,
        height: nextHeight,
        guidance: nextGuidance,
      });

      setShowModelPicker(false);
    },
    [imageModels, settings.imageGuidanceScale, settings.imageHeight, settings.imageSteps, settings.imageWidth, updateSettings]
  );

  const openReferenceLink = useCallback((url?: string) => {
    if (!url) return;
    Linking.openURL(url).catch(() => {
      Alert.alert('Unable to open link', 'The reference link could not be opened.');
    });
  }, []);

  const syncImageSettings = useCallback(
    (next: { steps?: number; width?: number; height?: number; guidance?: number }) => {
      setImageOptions((prev) => {
        const merged = { ...prev, ...next };
        updateSettings({
          imageSteps: merged.steps,
          imageWidth: merged.width,
          imageHeight: merged.height,
          imageGuidanceScale: merged.guidance,
        });
        return merged;
      });
    },
    [updateSettings]
  );

  const handleGenerateImage = useCallback(async () => {
    if (!imagePrompt.trim() || isGeneratingImage) {
      return;
    }

    if (!currentImageModel) {
      Alert.alert('No image model', 'Please select an image generation model before creating artwork.');
      return;
    }

    const prompt = imagePrompt.trim();
    setIsGeneratingImage(true);
    setImageError(null);

    try {
      const width = clampToConstraint(imageOptions.width, currentImageModel, 'width', settings.imageWidth);
      const height = clampToConstraint(imageOptions.height, currentImageModel, 'height', settings.imageHeight);

      const payload: Record<string, any> = {
        model: currentImageModel.id,
        prompt,
        width,
        height,
        format: 'webp',
      };

      if (currentImageModel?.model_spec?.constraints?.steps != null) {
        payload.steps = clampToConstraint(imageOptions.steps, currentImageModel, 'steps', settings.imageSteps);
      }

      if (currentImageModel?.model_spec?.constraints?.guidance_scale != null) {
        payload.guidance_scale = clampToConstraint(
          imageOptions.guidance,
          currentImageModel,
          'guidance_scale',
          settings.imageGuidanceScale
        );
      }

      const response = await fetch(VENICE_IMAGE_GENERATIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VENICE_API_KEY}`,
          "Content-Type": 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Venice image API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      // Handle different response formats from Venice API
      const imagesArray = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.images)
        ? data.images
        : Array.isArray(data?.data?.images)
        ? data.data.images
        : Array.isArray(data?.outputs)
        ? data.outputs
        : null;

      const firstImage = imagesArray?.[0] || data?.data || data?.image || data;
      
      // Extract base64 or URL from response
      const base64 =
        firstImage?.b64_json ||
        firstImage?.b64 ||
        firstImage?.image_base64 ||
        firstImage?.base64 ||
        firstImage?.image ||
        data?.b64_json ||
        data?.b64 ||
        data?.image_base64 ||
        data?.base64 ||
        data?.image;
      
      const imageUrl =
        firstImage?.url ||
        firstImage?.image_url ||
        firstImage?.imageUrl ||
        firstImage?.signed_url ||
        firstImage?.signedUrl ||
        data?.url ||
        data?.image_url ||
        data?.imageUrl ||
        data?.signed_url ||
        data?.signedUrl;

      if (!base64 && !imageUrl) {
        console.error('Image response structure:', JSON.stringify(data, null, 2));
        throw new Error('Image response did not include content.');
      }

      const mimeType =
        firstImage?.mime_type ||
        firstImage?.mimeType ||
        data?.mime_type ||
        data?.mimeType ||
        (typeof firstImage?.format === 'string' ? `image/${firstImage.format}` : null) ||
        (typeof data?.format === 'string' ? `image/${data.format}` : null) ||
        'image/webp';

      const imageData = base64 ? `data:${mimeType};base64,${base64}` : imageUrl;
      const generated: GeneratedImage = {
        id: `${Date.now()}`,
        prompt,
        modelId: currentImageModel.id,
        createdAt: Date.now(),
        imageData,
        width: payload.width,
        height: payload.height,
      };

      setGeneratedImages((prev) => [generated, ...prev]);
      setImagePrompt('');
    } catch (error) {
      console.error('Failed to generate image:', error);
      setImageError(error instanceof Error ? error.message : 'Failed to generate image.');
    } finally {
      setIsGeneratingImage(false);
    }
  }, [currentImageModel, imageOptions.guidance, imageOptions.height, imageOptions.steps, imageOptions.width, imagePrompt, isGeneratingImage, settings.imageGuidanceScale, settings.imageHeight, settings.imageSteps, settings.imageWidth]);

  const handleSelectImageSize = useCallback(
    (width: number, height: number) => {
      if (!currentImageModel) {
        return;
      }

      const nextWidth = clampToConstraint(width, currentImageModel, 'width', settings.imageWidth);
      const nextHeight = clampToConstraint(height, currentImageModel, 'height', settings.imageHeight);
      syncImageSettings({ width: nextWidth, height: nextHeight });
    },
    [currentImageModel, settings.imageHeight, settings.imageWidth, syncImageSettings]
  );

  const adjustImageSteps = useCallback(
    (delta: number) => {
      if (!currentImageModel) {
        return;
      }
      const next = clampToConstraint(imageOptions.steps + delta, currentImageModel, 'steps', settings.imageSteps);
      syncImageSettings({ steps: next });
    },
    [currentImageModel, imageOptions.steps, settings.imageSteps, syncImageSettings]
  );

  const adjustImageGuidance = useCallback(
    (delta: number) => {
      if (!currentImageModel) {
        return;
      }
      const next = clampToConstraint(imageOptions.guidance + delta, currentImageModel, 'guidance_scale', settings.imageGuidanceScale);
      syncImageSettings({ guidance: parseFloat(next.toFixed(1)) });
    },
    [currentImageModel, imageOptions.guidance, settings.imageGuidanceScale, syncImageSettings]
  );
  useEffect(() => {
    if (!currentModel) return;
    const defaultMaxTokens = getModelDefaultMaxTokens(currentModel);
    if (!defaultMaxTokens) return;

    const shouldUpdate =
      settings.maxTokens === 4096 ||
      settings.maxTokens == null ||
      settings.maxTokens > defaultMaxTokens;

    if (shouldUpdate && settings.maxTokens !== defaultMaxTokens) {
      updateSettings({ maxTokens: defaultMaxTokens });
    }
  }, [currentModel, settings.maxTokens]);

  const mistralModel = useMemo(() => findMistralModel(textModels), [textModels]);

  useEffect(() => {
    if (attachedImages.length > 0) {
      if (mistralModel) {
        if (settings.model !== mistralModel.id) {
          previousChatModelRef.current = settings.model;
          updateSettings({ model: mistralModel.id });
        }
      } else if (!hasWarnedNoMistral) {
        setHasWarnedNoMistral(true);
        Alert.alert(
          'Vision fallback unavailable',
          'No Mistral vision-capable model was found. The selected model may fail to use the attached images.'
        );
      }
    } else if (previousChatModelRef.current) {
      const previousId = previousChatModelRef.current;
      previousChatModelRef.current = null;
      if (previousId && textModels.some((model) => model.id === previousId)) {
        updateSettings({ model: previousId });
      }
    }
  }, [attachedImages.length, hasWarnedNoMistral, mistralModel, settings.model, textModels, updateSettings]);

  useEffect(() => {
    if (mistralModel) {
      setHasWarnedNoMistral(false);
    }
  }, [mistralModel]);

  const pickImageFromLibrary = async () => {
    try {
      console.log('📷 Launching image picker from library...');
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Please allow photo library access to attach images.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: false,
        quality: 0.8,
      });
      console.log('📷 Image picker result:', result);
      if (!result.canceled) {
        const asset = result.assets[0];
        const mimeType = asset.mimeType || 'image/jpeg';
        console.log('📷 Adding image to attachments:', asset.uri);
        setAttachedImages((prev: { uri: string; mimeType: string }[]) => [...prev, { uri: asset.uri, mimeType }]);
      }
    } catch (err) {
      console.error('📷 Error picking image:', err);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const takePhotoWithCamera = async () => {
    try {
      console.log('📸 Launching camera...');
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Please allow camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
      });
      console.log('📸 Camera result:', result);
      if (!result.canceled) {
        const asset = result.assets[0];
        const mimeType = asset.mimeType || 'image/jpeg';
        console.log('📸 Adding photo to attachments:', asset.uri);
        setAttachedImages((prev: { uri: string; mimeType: string }[]) => [...prev, { uri: asset.uri, mimeType }]);
      }
    } catch (err) {
      console.error('📸 Error taking photo:', err);
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  const removeAttachedImage = (uri: string) => {
    setAttachedImages((prev: { uri: string; mimeType: string }[]) => prev.filter((img: { uri: string; mimeType: string }) => img.uri !== uri));
  };

  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const userMessageText = message.trim();
    setMessage('');
    setIsLoading(true);

    const attachmentsSnapshot = [...attachedImages];

    if (attachmentsSnapshot.length > 0) {
      const currentModelVision = models.find((m: VeniceModel) => m.id === settings.model)?.model_spec.capabilities.supportsVision;
      if (!currentModelVision) {
        Alert.alert(
          'Model limitation',
          'The selected model may not support images. The request will still be sent, but it may be ignored by the model.'
        );
      }
    }

    const imagesWithDataUrls: { uri: string; mimeType: string; dataUrl: string }[] = [];

    for (const img of attachmentsSnapshot) {
      try {
        const base64 = await FileSystem.readAsStringAsync(img.uri, { encoding: FileSystem.EncodingType.Base64 });
        imagesWithDataUrls.push({
          uri: img.uri,
          mimeType: img.mimeType,
          dataUrl: `data:${img.mimeType};base64,${base64}`,
        });
      } catch {
        imagesWithDataUrls.push({
          uri: img.uri,
          mimeType: img.mimeType,
          dataUrl: img.uri,
        });
      }
    }

    const newUserMessage: Message = {
      role: 'user',
      content: userMessageText,
      id: Date.now().toString(),
      images: imagesWithDataUrls.length ? imagesWithDataUrls : undefined,
    };

    const conversationMessages = [...messages, newUserMessage];

    setMessages((prev: Message[]) => [...prev, newUserMessage]);

    let assistantMessageId: string | null = null;
      const startTime = Date.now();
      
    try {
      const currentModel = models.find((m: VeniceModel) => m.id === settings.model);

      const conversationHistory: any[] = conversationMessages.map((msg: Message) => {
          if (msg.role === 'user' && msg.images && msg.images.length > 0) {
            return {
              role: 'user',
              content: [
                { type: 'text', text: msg.content },
              ...msg.images.map((img) => ({
                type: 'image_url',
                image_url: { url: img.dataUrl ?? img.uri },
              })),
            ],
            };
          }
          return { role: msg.role, content: msg.content };
      });

      const requestBody: Record<string, any> = {
        model: settings.model,
        messages: conversationHistory,
        stream: true,
        venice_parameters: {
          character_slug: 'venice',
          strip_thinking_response: false,
          disable_thinking: settings.disableThinking,
          enable_web_search: settings.webSearch,
          enable_web_citations: settings.webCitations,
          include_search_results_in_stream: settings.includeSearchResults,
          include_venice_system_prompt: true,
        },
      };

      if (shouldIncludeCompletionParameter(currentModel, 'temperature')) {
        requestBody.temperature = settings.temperature;
      }
      if (shouldIncludeCompletionParameter(currentModel, 'top_p')) {
        requestBody.top_p = settings.topP;
      }
      if (shouldIncludeCompletionParameter(currentModel, 'min_p')) {
        requestBody.min_p = settings.minP;
      }
      if (shouldIncludeCompletionParameter(currentModel, 'max_tokens')) {
        requestBody.max_tokens = settings.maxTokens;
      }
      if (shouldIncludeCompletionParameter(currentModel, 'top_k')) {
        requestBody.top_k = settings.topK;
      }
      if (shouldIncludeCompletionParameter(currentModel, 'repetition_penalty')) {
        requestBody.repetition_penalty = settings.repetitionPenalty;
      }

      const supportsReasoning = currentModel?.model_spec.capabilities.supportsReasoning;
      const requestTimeoutMs = supportsReasoning ? 10 * 60 * 1000 : 2 * 60 * 1000;

      const controller = new AbortController();
      activeRequestControllerRef.current?.abort();
      activeRequestControllerRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      const response = await fetch(VENICE_CHAT_COMPLETIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VENICE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal as any,
      });

      clearTimeout(timeoutId);
      activeRequestControllerRef.current = null;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Venice API error: ${response.status} - ${errorText}`);
      }

      assistantMessageId = `${Date.now()}-assistant`;
      const placeholderMessage: Message = {
        role: 'assistant',
        content: '',
        thinking: '',
        id: assistantMessageId,
        references: [],
      };

      setMessages((prev: Message[]) => [...prev, placeholderMessage]);

      const updateAssistantMessage = (partial: Partial<Message>) => {
        if (!assistantMessageId) return;
        setMessages((prev: Message[]) =>
          prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, ...partial } : msg))
        );
      };

      let rawAssistantContent = '';
      let rawAssistantThinking = '';
      let latestUsage: any = null;
      let latestPayload: any = null;

      const pushCombinedContent = () => {
        const combined = rawAssistantThinking
          ? `<think>${rawAssistantThinking}</think>${rawAssistantContent}`
          : rawAssistantContent;
        const { thinking, content } = splitThinkingFromContent(combined);
        updateAssistantMessage({ content, thinking });
      };

      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let eventPayload = '';
        let receivedDone = false;

        const processEventPayload = (payload: string) => {
          const trimmed = payload.trim();
          if (!trimmed) {
            return;
          }

          if (trimmed === '[DONE]') {
            receivedDone = true;
            return;
          }

          try {
            const parsed = JSON.parse(trimmed);
            latestPayload = parsed;
            if (parsed?.usage) {
              latestUsage = parsed.usage;
            }

            const choice = parsed?.choices?.[0];
            if (choice?.delta?.content) {
              rawAssistantContent += choice.delta.content;
              pushCombinedContent();
            }
            if (choice?.delta?.thinking) {
              rawAssistantThinking += choice.delta.thinking;
              pushCombinedContent();
            }
            if (choice?.message?.content) {
              rawAssistantContent = choice.message.content;
              pushCombinedContent();
            }
            if (choice?.message?.thinking) {
              rawAssistantThinking = choice.message.thinking;
              pushCombinedContent();
            }

            if (parsed?.references || choice?.message?.references || choice?.delta?.references) {
              const refs = extractVeniceReferences(parsed);
              if (refs.length > 0) {
                updateAssistantMessage({ references: refs });
              }
            }
          } catch (streamError) {
            console.error('Failed to parse stream chunk:', streamError);
          }
        };

        while (!receivedDone) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data:')) {
              eventPayload += line.replace(/^data:\s*/, '');
            } else if (line.trim() === '') {
              processEventPayload(eventPayload);
              eventPayload = '';
              if (receivedDone) {
                break;
              }
            }
          }
        }

        processEventPayload(eventPayload);
        reader.releaseLock?.();
      } else {
      const data = await response.json();
        latestPayload = data;
        latestUsage = data?.usage;
        rawAssistantContent = data?.choices?.[0]?.message?.content ?? '';
        rawAssistantThinking = data?.choices?.[0]?.message?.thinking ?? '';
        pushCombinedContent();
      }

      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      const finalPayload = latestPayload ?? {
        choices: [{ message: { content: rawAssistantContent } }],
      };

      const combinedFinalText = rawAssistantThinking
        ? `<think>${rawAssistantThinking}</think>${rawAssistantContent}`
        : rawAssistantContent || finalPayload?.choices?.[0]?.message?.content || '';

      const { thinking: finalThinking, content: finalContent } = splitThinkingFromContent(combinedFinalText);
      const references = extractVeniceReferences(finalPayload);
      const sanitizedContent = sanitizeContentWithReferences(finalContent, references);

      const usage = latestUsage ?? finalPayload?.usage ?? {};
      const inputTokens = usage?.prompt_tokens ?? 0;
      const outputTokens = usage?.completion_tokens ?? 0;
      const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;

      const inputUsd = resolveUsdPrice(currentModel?.model_spec?.pricing?.input);
      const outputUsd = resolveUsdPrice(currentModel?.model_spec?.pricing?.output);
      const inputCost = inputUsd ? (inputTokens / 1_000_000) * inputUsd : 0;
      const outputCost = outputUsd ? (outputTokens / 1_000_000) * outputUsd : 0;
      const totalCost = inputCost + outputCost;
      const tokensPerSecond = outputTokens > 0 && responseTime > 0 ? outputTokens / (responseTime / 1000) : 0;

      updateAssistantMessage({
        content: sanitizedContent || finalContent || "Sorry, I couldn't generate a response.",
        thinking: finalThinking,
        references,
        metrics: {
          inputTokens,
          outputTokens,
          totalTokens,
          cost: totalCost,
          tokensPerSecond,
          responseTime,
          model: settings.model,
        },
      });
    } catch (error) {
      console.error('Error sending message:', error);
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      const fallbackText = isAbortError
        ? 'The request was cancelled. Please try again.'
        : 'Something went wrong. Please try again.';

      if (assistantMessageId) {
        setMessages((prev: Message[]) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: fallbackText,
                  thinking: '',
                }
              : msg
          )
        );
      }

      Alert.alert(isAbortError ? 'Request cancelled' : 'Error', fallbackText);
    } finally {
      setIsLoading(false);
      setAttachedImages([]);
      activeRequestControllerRef.current = null;
    }
  };

  const handleNewChat = useCallback(() => {
    setMessages([]);
  }, []);

  const modelIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of models) map.set(m.id, m.model_spec.name);
    return map;
  }, [models]);

  const getModelDisplayName = useCallback((modelId: string) => {
    return modelIdToName.get(modelId) || modelId;
  }, [modelIdToName]);

  const copyToClipboard = useCallback(async (content: string) => {
    try {
      // Extract formatted text from markdown content
      const formattedText = extractFormattedText(content);
      await Clipboard.setStringAsync(formattedText);
      if (Platform.OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Copied!', 'Response copied to clipboard with formatting');
    } catch (error) {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  }, []);

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const renderMessage = useCallback((msg: Message) => {
    const isUser = msg.role === 'user';
    
    if (isUser) {
      return (
        <View style={[
          styles.messageContainer,
          styles.userMessageContainer
        ]}>
          <View style={[styles.messageBubble, styles.userBubble]}>
            <Text style={[styles.messageText, styles.userText]} selectable>
              {msg.content}
            </Text>
          </View>
          {msg.images && msg.images.length > 0 && (
            <View style={styles.sentImagesRow}>
              {msg.images.map((img: { uri: string; mimeType: string; dataUrl?: string }) => (
                <Image key={img.uri} source={{ uri: img.uri }} style={styles.sentImage} contentFit="cover" />
              ))}
            </View>
          )}
        </View>
      );
    }

    // Assistant message with enhanced formatting
    return (
      <View style={[
        styles.messageContainer,
        styles.assistantMessageContainer
      ]}>
        {/* Thinking Section */}
        {msg.thinking && (
          <View style={styles.thinkingContainer}>
            <View style={styles.thinkingHeader}>
              <Ionicons name="bulb-outline" size={16} color={palette.accentStrong} />
              <Text style={styles.thinkingLabel}>Thinking</Text>
            </View>
            <Text style={styles.thinkingText} selectable>{msg.thinking}</Text>
          </View>
        )}

        {/* Main Response */}
        <View style={[styles.messageBubble, styles.assistantBubble]}>
          <RichText content={msg.content} />

          {msg.references && msg.references.length > 0 && (
            <View style={styles.referencesContainer}>
              <Text style={styles.referencesTitle}>References</Text>
              {msg.references.map((ref: VeniceReference, index: number) => {
                const referenceContent = (
                  <>
                    <Text style={styles.referenceText} selectable>
                      {index + 1}. {ref.title || ref.url || 'Source'}
          </Text>
                    {ref.snippet ? (
                      <Text style={styles.referenceSnippet} selectable>
                        {ref.snippet}
                      </Text>
                    ) : null}
                  </>
                );

                if (ref.url) {
                  return (
                    <TouchableOpacity
                      key={`${ref.url}-${index}`}
                      style={styles.referenceItem}
                      onPress={() => openReferenceLink(ref.url)}
                      activeOpacity={0.7}
                    >
                      {referenceContent}
                    </TouchableOpacity>
                  );
                }

                return (
                  <View key={`${ref.title || 'ref'}-${index}`} style={styles.referenceItem}>
                    {referenceContent}
                  </View>
                );
              })}
            </View>
          )}
          
          {/* Copy Button */}
          <TouchableOpacity 
            style={styles.copyButton}
            onPress={() => copyToClipboard(msg.content)}
          >
            <Ionicons name="copy-outline" size={16} color={palette.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Metrics Section */}
        {msg.metrics && (
          <View style={styles.metricsContainer}>
            {/* Header with model and timestamp */}
            <View style={styles.metricsHeader}>
              <Text style={styles.modelDisplayName}>{getModelDisplayName(msg.metrics.model)}</Text>
              <Text style={styles.timestamp}>{new Date().toLocaleTimeString()}</Text>
            </View>
            
            {/* Token Information */}
            <View style={styles.tokenMetrics}>
              <Text style={styles.tokenInfo}>
                Input: <Text style={styles.inputTokens}>{msg.metrics.inputTokens.toLocaleString()}</Text>{" "}
                Output: <Text style={styles.outputTokens}>{msg.metrics.outputTokens.toLocaleString()}</Text>
              </Text>
            </View>
            
            {/* Performance metrics in compact row */}
            <View style={styles.performanceRow}>
              <Text style={styles.performanceMetric}>
                ⭐ <Text style={styles.metricNumber}>{msg.metrics.tokensPerSecond.toFixed(1)}</Text> t/s
              </Text>
              <Text style={styles.performanceMetric}>
                ⏱ <Text style={styles.metricNumber}>{(msg.metrics.responseTime / 1000).toFixed(1)}</Text>s
              </Text>
              <Text style={styles.performanceMetric}>
                💰 <Text style={styles.metricNumber}>${msg.metrics.cost < 0.01 ? msg.metrics.cost.toFixed(4) : msg.metrics.cost.toFixed(3)}</Text>
              </Text>
            </View>
          </View>
        )}
      </View>
    );
  }, [copyToClipboard, getModelDisplayName, openReferenceLink]);

  const MessageItem = memo(({ item }: { item: Message }) => {
    return renderMessage(item);
  });

  const renderModelItem = useCallback(
    ({ item }: { item: VeniceModel }) => {
      const isChatTab = activeTab === 'chat';
      const isSelected = (isChatTab ? settings.model : settings.imageModel) === item.id;
      const capabilities = item.model_spec.capabilities || {};
      const metaParts: string[] = [];
      const onSelect = () => (isChatTab ? handleChatModelSelect(item.id) : handleImageModelSelect(item.id));

      if (isChatTab) {
        const availableContext = item.model_spec.availableContextTokens;
        if (typeof availableContext === 'number' && availableContext > 0) {
          metaParts.push(`${Math.round((availableContext / 1000) * 10) / 10}K context`);
        }
        const quantization = capabilities?.quantization;
        if (quantization) {
          metaParts.push(quantization);
        }
      } else {
        const width = getConstraintDefaults(item, 'width', settings.imageWidth);
        const height = getConstraintDefaults(item, 'height', settings.imageHeight);
        if (width && height) {
          metaParts.push(`${width}×${height}px`);
        }
        const steps = getConstraintDefaults(item, 'steps', settings.imageSteps);
        if (steps) {
          metaParts.push(`${steps} steps`);
        }
      }

      const metaText = metaParts.length > 0 ? metaParts.join(' • ') : 'Specs unavailable';
      const primaryPrice = isChatTab
        ? resolveUsdPrice(item.model_spec.pricing?.input)
        : resolveUsdPrice(item.model_spec.pricing?.generation ?? item.model_spec.pricing?.output);
      const secondaryPrice = isChatTab
        ? resolveUsdPrice(item.model_spec.pricing?.output)
        : resolveUsdPrice(item.model_spec.pricing?.upscale);

      return (
        <TouchableOpacity
          style={[styles.modelItem, isSelected && styles.selectedModelItem]}
          onPress={onSelect}
        >
          <View style={styles.modelInfo}>
            <View style={styles.modelHeader}>
              <Text style={styles.modelName}>{item.model_spec.name}</Text>
              {item.model_spec.beta && <Text style={styles.betaTag}>BETA</Text>}
            </View>
            <Text style={styles.modelId}>{item.id}</Text>
            <Text style={styles.contextTokens}>{metaText}</Text>
            <View style={styles.modelCapabilities}>
              {isChatTab && capabilities.supportsWebSearch && (
                <Text style={styles.capabilityTag}>🌐 Web</Text>
              )}
              {isChatTab && capabilities.supportsReasoning && (
                <Text style={styles.capabilityTag}>🧠 Reasoning</Text>
              )}
              {isChatTab && capabilities.optimizedForCode && (
                <Text style={styles.capabilityTag}>💻 Code</Text>
              )}
              {capabilities.supportsVision && <Text style={styles.capabilityTag}>👁️ Vision</Text>}
              {!isChatTab && (capabilities.supportsImageGeneration || isImageModel(item)) && (
                <Text style={styles.capabilityTag}>🎨 Image</Text>
              )}
              {isChatTab && capabilities.supportsFunctionCalling && (
                <Text style={styles.capabilityTag}>🔧 Functions</Text>
              )}
            </View>
          </View>

          <View style={styles.modelPricing}>
            <Text style={styles.pricingText}>
              {primaryPrice != null ? `$${primaryPrice}${isChatTab ? '/1M in' : ''}` : '—'}
            </Text>
            {isChatTab ? (
              <Text style={styles.pricingText}>
                {secondaryPrice != null ? `$${secondaryPrice}/1M out` : '—'}
              </Text>
            ) : (
              <Text style={styles.pricingText}>
                {secondaryPrice != null ? `Upscale from $${secondaryPrice}` : 'Generation only'}
              </Text>
            )}
          </View>

          {isSelected && <Ionicons name="checkmark-circle" size={24} color={palette.accentStrong} />}
        </TouchableOpacity>
      );
    },
    [activeTab, handleChatModelSelect, handleImageModelSelect, settings.imageHeight, settings.imageModel, settings.imageSteps, settings.imageWidth, settings.model]
  );

  const TypingIndicator: React.FC = () => {
    const pulses = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

    useEffect(() => {
      const animations = pulses.map((value, index) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(index * 150),
            Animated.timing(value, {
              toValue: 1,
              duration: 600,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(value, {
              toValue: 0,
              duration: 600,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        )
      );

      animations.forEach((animation) => animation.start());
      return () => {
        animations.forEach((animation) => animation.stop());
      };
    }, [pulses]);

    return (
      <View style={styles.fetchingContainer}>
        <Text style={styles.fetchingText}>Crafting magic…</Text>
        <View style={styles.typingDots}>
          {pulses.map((value, index) => (
          <Animated.View
              key={index}
            style={[
                styles.typingDot,
              {
                transform: [
                  {
                      scale: value.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.8, 1.25],
                    }),
                  },
                ],
                  opacity: value.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.4, 1],
                  }),
              },
            ]}
          />
          ))}
        </View>
      </View>
    );
  };

  const ImagePreview: React.FC<{ uri: string }> = ({ uri }: { uri: string }) => {
    return <Image source={{ uri }} style={styles.attachmentImage} contentFit="cover" />;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <BlurView intensity={65} tint="dark" style={styles.header}>
          <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoIcon}>✨</Text>
              <Text style={styles.logoText}>vGPT</Text>
            </View>
          </View>
          
          <View style={styles.headerRight}>
            <TouchableOpacity 
              style={styles.modelSelector}
              onPress={() => setShowModelPicker(true)}
              activeOpacity={0.8}
            >
                <Text style={styles.modelText} numberOfLines={1}>
                  {activeTab === 'chat'
                    ? getModelDisplayName(settings.model)
                    : getModelDisplayName(settings.imageModel)}
              </Text>
                <Ionicons name="chevron-down" size={16} color={palette.accentStrong} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.settingsButton}
              onPress={() => router.push('/settings')}
              activeOpacity={0.8}
            >
                <Ionicons name="settings" size={20} color={palette.accentStrong} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.newChatButton}
                onPress={activeTab === 'chat' ? handleNewChat : () => setGeneratedImages([])}
              activeOpacity={0.8}
            >
                <Ionicons name={activeTab === 'chat' ? 'add' : 'refresh'} size={24} color={palette.accentStrong} />
            </TouchableOpacity>
            </View>
          </View>
        </BlurView>

        <View style={styles.tabSwitcherRow}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'chat' && styles.tabButtonActive]}
            onPress={() => setActiveTab('chat')}
            activeOpacity={0.9}
          >
            <Text style={[styles.tabButtonText, activeTab === 'chat' && styles.tabButtonTextActive]}>Chat</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'image' && styles.tabButtonActive]}
            onPress={() => setActiveTab('image')}
            activeOpacity={0.9}
          >
            <Text style={[styles.tabButtonText, activeTab === 'image' && styles.tabButtonTextActive]}>Images</Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'chat' ? (
          <>
        <FlatList
          ref={flatListRef}
          data={messages}
          style={styles.messagesContainer}
              keyExtractor={keyExtractor}
          renderItem={({ item }: { item: Message }) => <MessageItem item={item} />}
          contentContainerStyle={messages.length === 0 ? styles.emptyState : styles.messagesContent}
          ListEmptyComponent={
            <View style={styles.welcomeContainer}>
              <View style={styles.welcomeIconContainer}>
                <Text style={styles.welcomeIcon}>✨</Text>
                <Text style={styles.sparkleIcon}>✨</Text>
              </View>
              <Text style={styles.welcomeTitle}>Ready to chat!</Text>
              <Text style={styles.welcomeSubtitle}>
                Send a message to start the conversation with {getModelDisplayName(settings.model)}
              </Text>
            </View>
          }
          ListFooterComponent={
            isLoading ? (
              <View style={styles.loadingMessage}>
                <View style={[styles.assistantBubble, { alignSelf: 'flex-start' }]}>
                  <TypingIndicator />
                </View>
              </View>
            ) : null
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
              removeClippedSubviews={Platform.OS !== 'web'}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

            <View style={styles.composerContainer}>
          {attachedImages.length > 0 && (
                <ScrollView
                  horizontal
                  style={styles.attachmentsBar}
                  contentContainerStyle={styles.attachmentsContent}
                  showsHorizontalScrollIndicator={false}
                >
              {attachedImages.map((img: { uri: string; mimeType: string }) => (
                <View key={img.uri} style={styles.attachmentItem}>
                  <ImagePreview uri={img.uri} />
                  <TouchableOpacity style={styles.removeAttachmentBtn} onPress={() => removeAttachedImage(img.uri)}>
                    <Ionicons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
                </ScrollView>
              )}
              <View style={styles.composerShell}>
                <View style={styles.composerInner}>
            <TextInput
              style={styles.textInput}
                    placeholder="Message the AI..."
                    placeholderTextColor={palette.textMuted}
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={4000}
              editable={!isLoading}
              autoCorrect
              autoCapitalize="sentences"
            />
                </View>
                <View style={styles.composerActions}>
                  <TouchableOpacity onPress={pickImageFromLibrary} style={styles.iconButton} activeOpacity={0.8}>
                    <Ionicons name="image-outline" size={20} color={palette.textSecondary} />
                  </TouchableOpacity>
            <TouchableOpacity
                    style={[styles.sendButton, (!message.trim() || isLoading) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!message.trim() || isLoading}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-up" size={20} color="white" />
            </TouchableOpacity>
          </View>
              </View>
            </View>
          </>
        ) : (
          <View style={styles.imageTabContainer}>
            <ScrollView
              style={styles.imageScroll}
              contentContainerStyle={generatedImages.length === 0 ? styles.imageEmptyState : styles.imageResults}
              showsVerticalScrollIndicator={false}
            >
              {imageError && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{imageError}</Text>
                </View>
              )}

              {generatedImages.length === 0 ? (
                <View style={styles.imageWelcome}>
                  <Ionicons name="image-outline" size={32} color={palette.textSecondary} />
                  <Text style={styles.imageWelcomeTitle}>Create your first masterpiece</Text>
                  <Text style={styles.imageWelcomeSubtitle}>
                    Describe an idea and let {getModelDisplayName(settings.imageModel)} bring it to life.
                  </Text>
                </View>
              ) : (
                generatedImages.map((item) => (
                  <View key={item.id} style={styles.generatedCard}>
                    <Image source={{ uri: item.imageData }} style={styles.generatedImage} contentFit="cover" />
                    <View style={styles.generatedMeta}>
                      <Text style={styles.generatedPrompt} numberOfLines={2} selectable>
                        {item.prompt}
                      </Text>
                      <Text style={styles.generatedDetails} selectable>
                        {getModelDisplayName(item.modelId)} • {new Date(item.createdAt).toLocaleTimeString()}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={styles.imageComposer}>
              <TouchableOpacity
                style={styles.imageModelSelector}
                onPress={() => setShowModelPicker(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.imageModelLabel} numberOfLines={1}>
                  {getModelDisplayName(settings.imageModel)}
                </Text>
                <Ionicons name="chevron-down" size={16} color={palette.accentStrong} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.advancedToggle}
                onPress={() => setShowAdvancedImageOptions((prev) => !prev)}
                activeOpacity={0.85}
              >
                <View style={styles.advancedToggleLeft}>
                  <Ionicons name="options-outline" size={18} color={palette.accentStrong} />
                  <Text style={styles.advancedToggleText}>Advanced options</Text>
                </View>
                <Ionicons
                  name={showAdvancedImageOptions ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={palette.accentStrong}
                />
              </TouchableOpacity>

              {showAdvancedImageOptions && (
                <View style={styles.advancedOptionsContainer}>
                  <View style={styles.sizeChipsRow}>
                    {suggestedImageSizes.map((size) => {
                      const isActive = imageOptions.width === size.width && imageOptions.height === size.height;
                      return (
                        <TouchableOpacity
                          key={`${size.width}x${size.height}`}
                          style={[styles.sizeChip, isActive && styles.sizeChipActive]}
                          onPress={() => handleSelectImageSize(size.width, size.height)}
                        >
                          <Text style={[styles.sizeChipText, isActive && styles.sizeChipTextActive]}>
                            {size.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={styles.imageControlsRow}>
                    <View style={styles.controlGroup}>
                      <Text style={styles.controlLabel}>Steps</Text>
                      <View style={styles.controlButtons}>
                        <TouchableOpacity style={styles.controlButton} onPress={() => adjustImageSteps(-1)}>
                          <Ionicons name="remove" size={18} color={palette.textPrimary} />
                        </TouchableOpacity>
                        <Text style={styles.controlValue}>{imageOptions.steps}</Text>
                        <TouchableOpacity style={styles.controlButton} onPress={() => adjustImageSteps(1)}>
                          <Ionicons name="add" size={18} color={palette.textPrimary} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.controlGroup}>
                      <Text style={styles.controlLabel}>Guidance</Text>
                      <View style={styles.controlButtons}>
                        <TouchableOpacity style={styles.controlButton} onPress={() => adjustImageGuidance(-0.5)}>
                          <Ionicons name="remove" size={18} color={palette.textPrimary} />
                        </TouchableOpacity>
                        <Text style={styles.controlValue}>{imageOptions.guidance.toFixed(1)}</Text>
                        <TouchableOpacity style={styles.controlButton} onPress={() => adjustImageGuidance(0.5)}>
                          <Ionicons name="add" size={18} color={palette.textPrimary} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              )}

              <View style={styles.imagePromptField}>
                <TextInput
                  style={styles.imagePromptInput}
                  placeholder="Describe what you want to see..."
                  placeholderTextColor={palette.textMuted}
                  value={imagePrompt}
                  onChangeText={setImagePrompt}
                  multiline
                  numberOfLines={6}
                  maxLength={1000}
                />
              </View>

              <TouchableOpacity
                style={[styles.generateButton, (isGeneratingImage || !imagePrompt.trim()) && styles.generateButtonDisabled]}
                onPress={handleGenerateImage}
                disabled={isGeneratingImage || !imagePrompt.trim()}
                activeOpacity={0.85}
              >
                {isGeneratingImage ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.generateButtonText}>Generate</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>


      {/* Model Picker Modal */}
      <Modal
        visible={showModelPicker}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowModelPicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {activeTab === 'chat' ? 'Select Chat Model' : 'Select Image Model'}
            </Text>
            <View style={styles.headerSpacer} />
          </View>
          
          {isLoadingModels ? (
            <View style={styles.loadingContainer}>
              <Text>Loading models...</Text>
            </View>
          ) : (
            <FlatList
              data={activeTab === 'chat' ? textModels : imageModels}
              renderItem={renderModelItem}
              keyExtractor={(item: VeniceModel) => item.id}
              contentContainerStyle={styles.modelList}
              ListEmptyComponent={(
                <View style={styles.loadingContainer}>
                  <Text style={styles.emptyModelsText}>
                    {activeTab === 'chat'
                      ? 'No chat models available.'
                      : 'No image models available.'}
                    </Text>
                    </View>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const palette = theme.colors;
const space = theme.spacing;
const radii = theme.radius;
const fonts = theme.fonts;
const shadow = theme.shadows;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.background,
  },
  emptyModelsText: {
    fontSize: 16,
    color: palette.textMuted,
    fontFamily: fonts.medium,
  },
  header: {
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.divider,
    ...shadow.subtle,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  tabSwitcherRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.divider,
  },
  tabButton: {
    flex: 1,
    paddingVertical: space.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceElevated,
  },
  tabButtonActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent,
  },
  tabButtonText: {
    textAlign: 'center',
    fontSize: 14,
    fontFamily: fonts.medium,
    color: palette.textSecondary,
    letterSpacing: 0.4,
  },
  tabButtonTextActive: {
    color: palette.accentStrong,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoIcon: {
    fontSize: 24,
    marginRight: space.sm,
    color: palette.accent,
  },
  logoText: {
    fontSize: 20,
    color: palette.textPrimary,
    fontFamily: fonts.semibold,
    letterSpacing: 0.3,
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.accentSoft,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.accent,
    shadowColor: palette.glow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  modelText: {
    fontSize: 14,
    color: palette.accentStrong,
    marginRight: space.xs,
    fontFamily: fonts.medium,
    letterSpacing: 0.4,
  },
  settingsButton: {
    padding: space.sm,
    borderRadius: radii.sm,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  newChatButton: {
    padding: space.sm,
    borderRadius: radii.sm,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: palette.backgroundMuted,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xxl,
  },
  messagesContent: {
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
  welcomeContainer: {
    alignItems: 'center',
    gap: space.md,
  },
  welcomeIconContainer: {
    position: 'relative',
    marginBottom: space.xl,
  },
  welcomeIcon: {
    fontSize: 84,
    textAlign: 'center',
    color: palette.accent,
  },
  sparkleIcon: {
    fontSize: 20,
    position: 'absolute',
    top: -10,
    right: -12,
    opacity: 0.65,
    color: palette.accentStrong,
  },
  welcomeTitle: {
    fontSize: 28,
    color: palette.textPrimary,
    fontFamily: fonts.semibold,
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: space.xl,
    fontFamily: fonts.regular,
  },
  messageContainer: {
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  userMessageContainer: {
    alignItems: 'flex-end',
  },
  assistantMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '88%',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radii.lg,
  },
  userBubble: {
    backgroundColor: palette.accent,
    borderBottomRightRadius: radii.sm,
    ...shadow.elevated,
  },
  assistantBubble: {
    backgroundColor: palette.surfaceElevated,
    borderBottomLeftRadius: radii.sm,
    borderWidth: 1,
    borderColor: palette.border,
    position: 'relative',
    paddingTop: space.lg,
    paddingBottom: space.md,
    ...shadow.subtle,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: fonts.regular,
  },
  userText: {
    color: palette.textPrimary,
  },
  assistantText: {
    color: palette.textPrimary,
  },
  richTextContainer: {
    gap: space.sm,
  },
  paragraphBlock: {
    gap: space.xs,
  },
  inlineText: {
    fontSize: 16,
    lineHeight: 24,
    color: palette.textPrimary,
    fontFamily: fonts.regular,
  },
  inlineBold: {
    fontSize: 16,
    lineHeight: 24,
    color: palette.textPrimary,
    fontFamily: fonts.semibold,
  },
  inlineItalic: {
    fontSize: 16,
    lineHeight: 24,
    color: palette.textPrimary,
    fontStyle: 'italic',
    fontFamily: fonts.regular,
  },
  inlineCode: {
    fontSize: 15,
    lineHeight: 24,
    color: palette.accentStrong,
    fontFamily: fonts.mono,
    backgroundColor: palette.surfaceActive,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  inlineLink: {
    fontSize: 16,
    lineHeight: 24,
    color: palette.accentStrong,
    textDecorationLine: 'underline',
    fontFamily: fonts.medium,
  },
  headingText: {
    fontSize: 18,
    color: palette.textPrimary,
    fontFamily: fonts.semibold,
  },
  headingLevel1: {
    fontSize: 22,
  },
  headingLevel2: {
    fontSize: 20,
  },
  headingLevel3: {
    fontSize: 18,
  },
  bulletList: {
    gap: space.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  bulletDot: {
    fontSize: 16,
    color: palette.accentStrong,
  },
  bulletNumber: {
    fontSize: 16,
    color: palette.accentStrong,
    fontFamily: fonts.medium,
    minWidth: 24,
  },
  codeBlock: {
    backgroundColor: palette.surfaceActive,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: space.md,
    marginVertical: space.xs,
  },
  codeBlockLanguage: {
    fontSize: 12,
    color: palette.textMuted,
    fontFamily: fonts.medium,
    textTransform: 'uppercase',
    marginBottom: space.xs,
    letterSpacing: 0.5,
  },
  codeBlockText: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.textPrimary,
    fontFamily: fonts.mono,
  },
  referencesContainer: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.divider,
    gap: space.sm,
  },
  referencesTitle: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  referenceItem: {
    backgroundColor: palette.surfaceActive,
    borderRadius: radii.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: palette.border,
  },
  referenceText: {
    fontSize: 14,
    color: palette.textPrimary,
    fontFamily: fonts.medium,
  },
  referenceSnippet: {
    marginTop: space.xs,
    fontSize: 13,
    color: palette.textMuted,
    lineHeight: 18,
  },
  loadingMessage: {
    paddingHorizontal: space.lg,
    marginVertical: space.xs,
    alignItems: 'flex-start',
  },
  fetchingContainer: {
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  fetchingText: {
    fontSize: 14,
    color: palette.textSecondary,
    fontFamily: fonts.medium,
    letterSpacing: 0.3,
  },
  typingDots: {
    flexDirection: 'row',
    gap: space.sm,
  },
  typingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.accent,
  },
  attachmentsBar: {
    maxHeight: 80,
    marginBottom: space.sm,
  },
  attachmentsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingBottom: space.sm,
    gap: space.sm,
  },
  attachmentItem: {
    width: 60,
    height: 60,
    borderRadius: radii.md,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: palette.border,
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
  },
  removeAttachmentBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 12, 12, 0.65)',
  },
  composerContainer: {
    backgroundColor: palette.surface,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.divider,
    gap: space.md,
  },
  composerShell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.inputBackground,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.inputBorder,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.md,
  },
  composerInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: palette.surfaceActive,
    borderWidth: 1,
    borderColor: palette.border,
  },
  sentImagesRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.sm,
  },
  sentImage: {
    width: 150,
    height: 150,
    borderRadius: radii.md,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: palette.textPrimary,
    maxHeight: 200,
    paddingVertical: space.xs,
    paddingRight: space.sm,
    textAlignVertical: 'top',
    fontFamily: fonts.regular,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: space.md,
    shadowColor: palette.glow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 6,
  },
  sendButtonDisabled: {
    backgroundColor: palette.borderMuted,
    shadowOpacity: 0,
  },
  imageTabContainer: {
    flex: 1,
    backgroundColor: palette.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.divider,
  },
  imageScroll: {
    flex: 1,
  },
  imageEmptyState: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
  },
  imageResults: {
    padding: space.lg,
    gap: space.lg,
  },
  errorBanner: {
    borderRadius: radii.lg,
    backgroundColor: palette.danger,
    padding: space.md,
  },
  errorText: {
    color: palette.textPrimary,
    fontFamily: fonts.medium,
  },
  imageWelcome: {
    alignItems: 'center',
    gap: space.sm,
  },
  imageWelcomeTitle: {
    fontSize: 20,
    color: palette.textPrimary,
    fontFamily: fonts.semibold,
  },
  imageWelcomeSubtitle: {
    fontSize: 14,
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: space.xl,
  },
  imageComposer: {
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.divider,
    backgroundColor: palette.surface,
  },
  imageModelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.inputBackground,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.inputBorder,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  imageModelLabel: {
    fontSize: 14,
    color: palette.textPrimary,
    fontFamily: fonts.medium,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  advancedToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  advancedToggleText: {
    fontSize: 14,
    color: palette.textPrimary,
    fontFamily: fonts.medium,
  },
  advancedOptionsContainer: {
    gap: space.md,
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: space.md,
  },
  sizeChipsRow: {
    flexDirection: 'row',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  sizeChip: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceElevated,
  },
  sizeChipActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  sizeChipText: {
    fontSize: 12,
    color: palette.textSecondary,
    fontFamily: fonts.medium,
  },
  sizeChipTextActive: {
    color: palette.accentStrong,
  },
  imageControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
  },
  controlGroup: {
    flex: 1,
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: space.md,
    gap: space.sm,
  },
  controlLabel: {
    fontSize: 12,
    color: palette.textSecondary,
    fontFamily: fonts.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  controlButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  controlButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceActive,
    borderWidth: 1,
    borderColor: palette.border,
  },
  controlValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    color: palette.textPrimary,
    fontFamily: fonts.semibold,
  },
  imagePromptField: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.inputBorder,
    backgroundColor: palette.inputBackground,
    padding: space.md,
  },
  imagePromptInput: {
    minHeight: 150,
    fontSize: 16,
    color: palette.textPrimary,
    textAlignVertical: 'top',
    fontFamily: fonts.regular,
  },
  generateButton: {
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.elevated,
  },
  generateButtonDisabled: {
    backgroundColor: palette.borderMuted,
    shadowOpacity: 0,
  },
  generateButtonText: {
    fontSize: 16,
    color: palette.textPrimary,
    fontFamily: fonts.semibold,
    letterSpacing: 0.4,
  },
  generatedCard: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceElevated,
    ...shadow.subtle,
  },
  generatedImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: palette.surface,
  },
  generatedMeta: {
    padding: space.md,
    gap: space.xs,
  },
  generatedPrompt: {
    fontSize: 14,
    color: palette.textPrimary,
    fontFamily: fonts.medium,
  },
  generatedDetails: {
    fontSize: 12,
    color: palette.textMuted,
    fontFamily: fonts.regular,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: palette.backgroundMuted,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.divider,
  },
  modalCancelText: {
    fontSize: 16,
    color: palette.accent,
    fontFamily: fonts.medium,
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: fonts.semibold,
    color: palette.textPrimary,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 80,
  },
  modelList: {
    paddingVertical: space.md,
  },
  modelItem: {
    backgroundColor: palette.surfaceElevated,
    marginHorizontal: space.lg,
    marginVertical: space.xs,
    padding: space.lg,
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    ...shadow.subtle,
  },
  selectedModelItem: {
    borderColor: palette.accent,
    shadowColor: palette.glow,
    shadowOpacity: 0.5,
    elevation: 10,
  },
  modelInfo: {
    flex: 1,
  },
  modelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  modelName: {
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: palette.textPrimary,
    flex: 1,
  },
  betaTag: {
    fontSize: 10,
    fontFamily: fonts.medium,
    color: palette.accentStrong,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.accent,
  },
  modelId: {
    fontSize: 13,
    color: palette.textMuted,
    marginBottom: space.xs,
    fontFamily: fonts.medium,
  },
  contextTokens: {
    fontSize: 12,
    color: palette.textMuted,
    marginBottom: space.sm,
    fontFamily: fonts.regular,
  },
  modelCapabilities: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  capabilityTag: {
    fontSize: 12,
    color: palette.accentStrong,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  modelPricing: {
    alignItems: 'flex-end',
    marginRight: space.md,
  },
  pricingText: {
    fontSize: 12,
    color: palette.textMuted,
    fontFamily: fonts.medium,
  },
  thinkingContainer: {
    marginTop: space.sm,
    backgroundColor: palette.surfaceActive,
    borderRadius: radii.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: palette.border,
  },
  thinkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.xs,
    gap: space.xs,
  },
  thinkingLabel: {
    fontSize: 13,
    color: palette.accentStrong,
    fontFamily: fonts.medium,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  thinkingText: {
    fontSize: 13,
    color: palette.textSecondary,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  copyButton: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radii.pill,
    backgroundColor: palette.surfaceActive,
    borderWidth: 1,
    borderColor: palette.border,
  },
  metricsContainer: {
    marginTop: space.md,
    backgroundColor: palette.surfaceActive,
    borderRadius: radii.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: palette.border,
    gap: space.sm,
  },
  metricsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modelDisplayName: {
    fontSize: 13,
    color: palette.textSecondary,
    fontFamily: fonts.medium,
  },
  timestamp: {
    fontSize: 12,
    color: palette.textMuted,
    fontFamily: fonts.medium,
  },
  tokenMetrics: {
    marginBottom: space.xs,
  },
  tokenInfo: {
    fontSize: 12,
    color: palette.textMuted,
    lineHeight: 18,
    fontFamily: fonts.regular,
  },
  inputTokens: {
    color: palette.textSecondary,
    fontFamily: fonts.medium,
  },
  outputTokens: {
    color: palette.accentStrong,
    fontFamily: fonts.semibold,
  },
  costDisplay: {
    color: palette.accentStrong,
    fontFamily: fonts.semibold,
  },
  performanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
  },
  performanceMetric: {
    fontSize: 12,
    color: palette.textSecondary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    fontFamily: fonts.regular,
  },
  metricNumber: {
    fontFamily: fonts.semibold,
    color: palette.textPrimary,
  },
});

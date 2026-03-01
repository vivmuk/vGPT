import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Text,
  Share,
  Animated,
  Dimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import Slider from '@react-native-community/slider';
import { DEFAULT_SETTINGS } from '@/constants/settings';
import { AppSettings } from '@/types/settings';
import { VeniceModel } from '@/types/venice';
import { loadStoredSettings, persistSettings } from '@/utils/settingsStorage';
import {
  VENICE_CHAT_COMPLETIONS_ENDPOINT,
  VENICE_MODELS_ENDPOINT,
  VENICE_IMAGE_GENERATIONS_ENDPOINT,
} from '@/constants/venice';

// ═══════════════════════════════════════════════════════════════════════════
// TERMINAL FUTURISTIC THEME
// ═══════════════════════════════════════════════════════════════════════════

const T = {
  bg: '#050508',
  surface: '#0A0A10',
  surfaceLight: '#111118',
  surfaceActive: '#1A1A24',

  green: '#00FF88',
  greenDim: 'rgba(0, 255, 136, 0.6)',
  greenGlow: 'rgba(0, 255, 136, 0.08)',
  greenBorder: 'rgba(0, 255, 136, 0.15)',

  cyan: '#00D4FF',
  cyanDim: 'rgba(0, 212, 255, 0.6)',
  cyanGlow: 'rgba(0, 212, 255, 0.08)',
  cyanBorder: 'rgba(0, 212, 255, 0.15)',

  amber: '#FFB800',
  amberDim: 'rgba(255, 184, 0, 0.6)',
  amberGlow: 'rgba(255, 184, 0, 0.08)',
  amberBorder: 'rgba(255, 184, 0, 0.2)',

  red: '#FF3366',
  redGlow: 'rgba(255, 51, 102, 0.1)',

  text: '#D4D4D8',
  textBright: '#FAFAFA',
  textMuted: '#52525B',
  textDim: '#3F3F46',

  border: 'rgba(255, 255, 255, 0.04)',
  white: '#FFFFFF',
  black: '#000000',
};

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface Message {
  role: 'user' | 'assistant';
  content: string;
  id: string;
  isStreaming?: boolean;
  reasoning?: string;
  metrics?: {
    tokensPerSecond?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    responseTime?: number;
  };
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

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const isImageModel = (model?: VeniceModel | null): boolean => {
  if (!model) return false;
  const modelType = model.type?.toLowerCase() ?? '';
  if (modelType === 'image') return true;
  const capabilities = model.model_spec?.capabilities || {};
  if (capabilities.supportsImageGeneration === true) return true;
  const modelId = model.id.toLowerCase();
  return ['flux', 'stable-diffusion', 'imagen', 'dall'].some(k => modelId.includes(k));
};

const resolveUsdPrice = (p: unknown): number | undefined => {
  if (typeof p === 'number') return p;
  if (p && typeof p === 'object' && 'usd' in p) {
    const val = (p as any).usd;
    return typeof val === 'number' ? val : undefined;
  }
  return undefined;
};

const getConstraintNumber = (constraint: any): number | undefined => {
  if (constraint == null) return undefined;
  if (typeof constraint === 'number') return constraint;
  if (typeof constraint.default === 'number') return constraint.default;
  if (typeof constraint.max === 'number') return constraint.max;
  return undefined;
};

const getModelMaxTokens = (model?: VeniceModel | null): number | undefined => {
  if (!model) return undefined;
  const c = model.model_spec?.constraints || {};
  for (const key of ['max_output_tokens', 'maxOutputTokens', 'max_tokens', 'response_tokens']) {
    const val = getConstraintNumber((c as any)[key]);
    if (val && val > 0) return val;
  }
  return undefined;
};

const extractThinkingBlocks = (text: string): { reasoning: string; content: string } => {
  if (!text) return { reasoning: '', content: '' };

  const patterns: RegExp[] = [
    /<think>([\s\S]*?)<\/think>/gi,
    /<thinking>([\s\S]*?)<\/thinking>/gi,
    /```(?:thinking|think)\s*\n([\s\S]*?)```/gi,
  ];

  const reasoningParts: string[] = [];
  let content = text;

  for (const pattern of patterns) {
    content = content.replace(pattern, (_m, inner: string) => {
      const cleaned = String(inner ?? '').trim();
      if (cleaned) reasoningParts.push(cleaned);
      return '';
    });
  }

  content = content.replace(/\n{3,}/g, '\n\n').trim();
  return { reasoning: reasoningParts.join('\n\n').trim(), content };
};

const getModelBadges = (model: VeniceModel): string[] => {
  const badges: string[] = [];
  const caps = model.model_spec?.capabilities || {};
  const name = model.id.toLowerCase();
  if (caps.supportsReasoning) badges.push('REASON');
  if (caps.supportsVision) badges.push('VISION');
  if (caps.supportsWebSearch) badges.push('WEB');
  if (name.includes('fast') || name.includes('turbo') || name.includes('nano')) badges.push('FAST');
  if (name.includes('pro') || name.includes('xl') || name.includes('large')) badges.push('PRO');
  return badges;
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const SUGGESTIONS = [
  { icon: 'code', text: 'Write a React hook' },
  { icon: 'edit-3', text: 'Draft a professional email' },
  { icon: 'cpu', text: 'Explain machine learning' },
  { icon: 'globe', text: 'Plan a trip to Paris' },
];

const IMAGE_SUGGESTIONS = [
  { icon: 'sun', text: 'Cinematic golden hour landscape, dramatic lighting' },
  { icon: 'zap', text: 'Futuristic neon city at night, cyberpunk style' },
  { icon: 'feather', text: 'Soft watercolor portrait, pastel tones' },
  { icon: 'layers', text: 'Abstract geometric art, vibrant colors' },
];

const STYLE_PRESETS = [
  { label: 'NONE', value: '' },
  { label: 'CINEMA', value: ', cinematic lighting, film grain, dramatic composition, wide angle' },
  { label: 'ANIME', value: ', anime style, cel shaded, vibrant colors, detailed illustration' },
  { label: 'PHOTO', value: ', photorealistic, 8k resolution, ultra detailed, DSLR photography' },
  { label: 'PAINT', value: ', oil painting, thick brushstrokes, classical art, rich textures' },
  { label: 'NEON', value: ', neon lights, cyberpunk, dark background, glowing edges, futuristic' },
  { label: 'MINIMAL', value: ', minimalist, clean composition, simple shapes, negative space' },
];

const ASPECT_RATIOS = [
  { label: '1:1', w: 1024, h: 1024, boxW: 22, boxH: 22 },
  { label: '16:9', w: 1024, h: 576, boxW: 26, boxH: 15 },
  { label: '9:16', w: 576, h: 1024, boxW: 15, boxH: 26 },
];

const SCREEN_WIDTH = Dimensions.get('window').width;

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function MainScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // State
  const [activeTab, setActiveTab] = useState<'chat' | 'create'>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<VeniceModel[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [imageSettings, setImageSettings] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});

  // New state
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('');
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [fullscreenImage, setFullscreenImage] = useState<GeneratedImage | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Refs
  const listRef = useRef<FlatList>(null);
  const imageScrollRef = useRef<ScrollView>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const tokenRef = useRef<number>(0);
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Load settings and models
  useEffect(() => {
    loadStoredSettings<AppSettings>(DEFAULT_SETTINGS).then(setSettings);
    loadModels();
    return () => controllerRef.current?.abort();
  }, []);

  const loadModels = async () => {
    setLoadingModels(true);
    try {
      const [textRes, imgRes] = await Promise.all([
        fetch(VENICE_MODELS_ENDPOINT),
        fetch(`${VENICE_MODELS_ENDPOINT}?type=image`),
      ]);

      const textData = await textRes.json();
      const imgData = await imgRes.json();

      const textModels = Array.isArray(textData?.data) ? textData.data : [];
      const imgModels = Array.isArray(imgData?.data) ? imgData.data : [];

      setModels([...textModels, ...imgModels]);
    } catch (e) {
      console.error('Failed to load models:', e);
    } finally {
      setLoadingModels(false);
    }
  };

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      persistSettings(next);
      return next;
    });
  }, []);

  const textModels = useMemo(() =>
    models.filter(m => !isImageModel(m)), [models]);

  const imageModels = useMemo(() =>
    models.filter(m => isImageModel(m)), [models]);

  // Auto-select models
  useEffect(() => {
    if (textModels.length && !textModels.find(m => m.id === settings.model)) {
      updateSettings({ model: textModels[0].id });
    }
  }, [textModels, settings.model, updateSettings]);

  useEffect(() => {
    if (imageModels.length && !imageModels.find(m => m.id === settings.imageModel)) {
      updateSettings({ imageModel: imageModels[0].id });
    }
  }, [imageModels, settings.imageModel, updateSettings]);

  // Shimmer animation
  useEffect(() => {
    if (isGenerating) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.timing(shimmerAnim, { toValue: 0.2, duration: 900, useNativeDriver: true }),
        ])
      ).start();
    } else {
      shimmerAnim.stopAnimation();
      shimmerAnim.setValue(0);
    }
  }, [isGenerating, shimmerAnim]);

  const getModelName = (id: string) => {
    const m = models.find(x => x.id === id);
    return m?.model_spec?.name || id.split('/').pop() || id;
  };

  const toggleReasoning = useCallback((id: string) => {
    setExpandedReasoning(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const downloadImage = useCallback(async (img: GeneratedImage) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (Platform.OS === 'web') {
        if (typeof document === 'undefined') return;
        const a = document.createElement('a');
        a.href = img.imageData;
        a.download = `vgpt-${img.id}.webp`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }

      const match = img.imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
      if (!match) throw new Error('Unsupported image data.');

      const mime = match[1] || 'image/webp';
      const base64 = match[2] || '';
      const ext = mime.split('/')[1] || 'webp';

      const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!dir) throw new Error('File system unavailable.');

      const fileUri = `${dir}vgpt-${img.id}.${ext}`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      await Share.share({ url: fileUri, title: 'vGPT Image', message: img.prompt });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Download failed', e?.message || 'Unable to download image.');
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // STREAMING CHAT
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput('');
    setIsLoading(true);

    const userMsg: Message = { role: 'user', content: text, id: `${Date.now()}` };
    const history = [...messages, userMsg];
    setMessages(history);

    const assistantId = `${Date.now()}-ai`;
    setMessages(prev => [...prev, { role: 'assistant', content: '', reasoning: '', id: assistantId, isStreaming: true }]);

    try {
      const controller = new AbortController();
      controllerRef.current?.abort();
      controllerRef.current = controller;

      const currentModel = models.find(m => m.id === settings.model);
      const veniceParams: any = {
        include_venice_system_prompt: settings.includeVeniceSystemPrompt,
      };
      if (settings.stripThinking) veniceParams.strip_thinking = true;
      if (settings.disableThinking) veniceParams.disable_thinking = true;
      if (currentModel?.model_spec?.capabilities?.supportsWebSearch) {
        veniceParams.enable_web_search = settings.webSearch;
        veniceParams.enable_web_citations = settings.webCitations;
      }

      const modelMax = getModelMaxTokens(currentModel);
      let maxCompletionTokens: number | undefined;
      if (currentModel?.model_spec?.capabilities?.supportsReasoning) {
        maxCompletionTokens = modelMax ?? settings.maxTokens;
      } else {
        maxCompletionTokens = modelMax ? Math.min(settings.maxTokens, modelMax) : settings.maxTokens;
      }

      const body = {
        model: settings.model,
        messages: history.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        venice_parameters: veniceParams,
        temperature: settings.temperature,
        top_p: settings.topP,
        ...(maxCompletionTokens ? { max_completion_tokens: maxCompletionTokens } : {}),
      };

      startTimeRef.current = Date.now();
      tokenRef.current = 0;

      const response = await fetch(VENICE_CHAT_COMPLETIONS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);

      let content = '';
      let reasoning = '';
      let usage: any = null;

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.usage) usage = parsed.usage;

              const deltaContent = parsed?.choices?.[0]?.delta?.content;
              const deltaReasoning = parsed?.choices?.[0]?.delta?.reasoning;

              if (deltaReasoning) reasoning += deltaReasoning;
              if (deltaContent) {
                content += deltaContent;
                tokenRef.current += Math.ceil(deltaContent.length / 4);
              }

              const extracted = extractThinkingBlocks(content);
              if (extracted.reasoning) {
                reasoning = [reasoning, extracted.reasoning].filter(Boolean).join('\n\n');
                content = extracted.content;
              }

              if (deltaContent || deltaReasoning) {
                const elapsed = (Date.now() - startTimeRef.current) / 1000;
                const tps = elapsed > 0 ? tokenRef.current / elapsed : 0;

                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content,
                        reasoning: reasoning || undefined,
                        metrics: { tokensPerSecond: Math.round(tps * 10) / 10, totalTokens: tokenRef.current }
                      }
                    : m
                ));
              }
            } catch {}
          }
        }
        reader.releaseLock();
      } else {
        const data = await response.json();
        content = data?.choices?.[0]?.message?.content || '';
        reasoning = data?.choices?.[0]?.message?.reasoning || '';
        usage = data?.usage;
      }

      const extracted = extractThinkingBlocks(content);
      if (extracted.reasoning) {
        reasoning = [reasoning, extracted.reasoning].filter(Boolean).join('\n\n');
        content = extracted.content;
      }

      const responseTime = (Date.now() - startTimeRef.current) / 1000;
      const inputTokens = usage?.prompt_tokens;
      const outputTokens = usage?.completion_tokens;
      const totalTokens = usage?.total_tokens || tokenRef.current;
      const tps = responseTime > 0 ? totalTokens / responseTime : 0;

      const model = models.find(m => m.id === settings.model);
      const inPrice = resolveUsdPrice(model?.model_spec?.pricing?.input);
      const outPrice = resolveUsdPrice(model?.model_spec?.pricing?.output);
      let cost = 0;
      if (inPrice && inputTokens) cost += (inPrice * inputTokens) / 1_000_000;
      if (outPrice && outputTokens) cost += (outPrice * outputTokens) / 1_000_000;

      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? {
              ...m,
              content: content || 'No response received.',
              reasoning: reasoning || undefined,
              isStreaming: false,
              metrics: {
                tokensPerSecond: Math.round(tps * 10) / 10,
                totalTokens,
                inputTokens,
                outputTokens,
                responseTime: Math.round(responseTime * 10) / 10,
                cost: cost > 0 ? Math.round(cost * 10000) / 10000 : undefined,
              },
            }
          : m
      ));
    } catch (e: any) {
      const msg = e.name === 'AbortError' ? 'Request cancelled.' : 'Something went wrong.';
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: msg, isStreaming: false } : m
      ));
    } finally {
      setIsLoading(false);
      controllerRef.current = null;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // IMAGE GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  const handleGenerate = async () => {
    const rawPrompt = imagePrompt.trim();
    if (!rawPrompt || isGenerating) return;

    const model = imageModels.find(m => m.id === settings.imageModel);
    if (!model) {
      Alert.alert('No Model', 'Please select an image model.');
      return;
    }

    // Build final prompt with style preset
    const prompt = rawPrompt + selectedStyle;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsGenerating(true);

    // Save to prompt history
    setPromptHistory(prev => {
      const next = [rawPrompt, ...prev.filter(p => p !== rawPrompt)];
      return next.slice(0, 20);
    });

    try {
      const stepsConstraint = model.model_spec?.constraints?.steps;
      const modelDefaultSteps = getConstraintNumber(stepsConstraint);
      const modelMaxSteps = typeof stepsConstraint === 'object' && stepsConstraint?.max
        ? stepsConstraint.max : undefined;

      let steps = modelDefaultSteps ?? settings.imageSteps ?? 8;
      if (settings.imageSteps !== DEFAULT_SETTINGS.imageSteps) {
        steps = settings.imageSteps;
      }
      if (modelMaxSteps) {
        steps = Math.min(steps, modelMaxSteps);
      }
      // Force 1 step for any banana-variant models
      const modelIdLower = model.id.toLowerCase();
      if (modelIdLower.includes('banana')) {
        steps = 1;
      }

      const payload: any = {
        model: model.id,
        prompt,
        width: settings.imageWidth || 1024,
        height: settings.imageHeight || 576,
        steps,
        cfg_scale: Math.max(1, Math.min(20, settings.imageGuidanceScale || 7.5)),
        format: 'webp',
        hide_watermark: false,
      };

      // Include negative prompt if provided
      const neg = negativePrompt.trim();
      if (neg) {
        payload.negative_prompt = neg;
      }

      const res = await fetch(VENICE_IMAGE_GENERATIONS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Image API error: ${res.status}`);

      const data = await res.json();
      if (!data.images?.length) throw new Error('No images returned.');

      const img: GeneratedImage = {
        id: `${Date.now()}`,
        prompt: rawPrompt,
        modelId: model.id,
        createdAt: Date.now(),
        imageData: `data:image/webp;base64,${data.images[0]}`,
        width: payload.width,
        height: payload.height,
      };

      setImages(prev => [img, ...prev]);
      setImagePrompt('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => imageScrollRef.current?.scrollTo({ y: 0, animated: true }), 100);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', e.message || 'Failed to generate image.');
    } finally {
      setIsGenerating(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  const renderCode = (content: string): React.ReactNode => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const code = part.replace(/^```\w*\n?/, '').replace(/```$/, '');
        return (
          <View key={i} style={s.codeBlock}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={s.codeText}>{code}</Text>
            </ScrollView>
          </View>
        );
      }
      return <Text key={i} style={s.msgText}>{part}</Text>;
    });
  };

  const accentColor = activeTab === 'chat' ? T.green : T.amber;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {/* ── HEADER ── */}
      <View style={[s.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <View style={s.headerLeft}>
          <Text style={s.logoText}>{'>_'}</Text>
          <Text style={s.logoName}>vGPT</Text>
        </View>

        <TouchableOpacity onPress={() => setShowModels(true)} style={s.modelBtn}>
          <Text style={s.modelBtnText} numberOfLines={1}>
            {getModelName(activeTab === 'chat' ? settings.model : settings.imageModel)}
          </Text>
          {loadingModels ? (
            <ActivityIndicator size="small" color={T.green} />
          ) : (
            <Feather name="chevron-down" size={12} color={T.green} />
          )}
        </TouchableOpacity>

        <View style={s.headerRight}>
          <TouchableOpacity
            onPress={() => { setMessages([]); setImages([]); }}
            style={s.iconBtn}
          >
            <Feather name="trash-2" size={16} color={T.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/settings')} style={s.iconBtn}>
            <Feather name="settings" size={16} color={T.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── TABS ── */}
      <View style={s.tabs}>
        {([
          { key: 'chat' as const, label: 'CHAT', color: T.green },
          { key: 'create' as const, label: 'IMG', color: T.amber },
        ]).map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => {
              setActiveTab(tab.key);
              Haptics.selectionAsync();
            }}
            style={[s.tab, activeTab === tab.key && { borderBottomColor: tab.color }]}
          >
            <Text style={[
              s.tabLabel,
              activeTab === tab.key && { color: tab.color },
            ]}>
              [{tab.label}]
            </Text>
          </TouchableOpacity>
        ))}
        <View style={s.tabFill} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.flex}
      >
        {activeTab === 'chat' ? (
          /* ══════════ CHAT TAB ══════════ */
          <View style={s.flex}>
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={m => m.id}
              style={s.flex}
              contentContainerStyle={[s.msgList, messages.length === 0 && s.msgListEmpty]}
              onContentSizeChange={() => listRef.current?.scrollToEnd()}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyTerminal}>SYSTEM READY</Text>
                  <Text style={s.emptySub}>query something or select a prompt</Text>

                  <View style={s.suggestions}>
                    {SUGGESTIONS.map((sg, i) => (
                      <TouchableOpacity
                        key={i}
                        style={s.suggestion}
                        onPress={() => { setInput(sg.text); Haptics.selectionAsync(); }}
                      >
                        <Text style={s.suggestionArrow}>{'>'}</Text>
                        <Text style={s.suggestionText}>{sg.text}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              }
              renderItem={({ item }) => (
                <View style={[s.msgRow, item.role === 'assistant' && s.msgRowAi]}>
                  <Text style={[s.msgPrefix, { color: item.role === 'user' ? T.cyan : T.green }]}>
                    {item.role === 'user' ? '$' : '>'}
                  </Text>
                  <View style={s.msgBody}>
                    {item.isStreaming && !item.content ? (
                      <Text style={s.msgStreaming}>processing...</Text>
                    ) : (
                      renderCode(item.content)
                    )}
                    {!settings.stripThinking && item.role === 'assistant' && item.reasoning?.trim() && (
                      <View style={s.reasoning}>
                        <TouchableOpacity style={s.reasoningHeader} onPress={() => toggleReasoning(item.id)}>
                          <Text style={s.reasoningToggle}>
                            {expandedReasoning[item.id] ? '[-]' : '[+]'}
                          </Text>
                          <Text style={s.reasoningTitle}>reasoning</Text>
                        </TouchableOpacity>
                        {expandedReasoning[item.id] && (
                          <View style={s.reasoningBody}>
                            {renderCode(item.reasoning || '')}
                          </View>
                        )}
                      </View>
                    )}
                    {item.metrics && !item.isStreaming && (
                      <Text style={s.metrics}>
                        {'// '}{item.metrics.tokensPerSecond} tok/s
                        {' · '}{item.metrics.totalTokens} tokens
                        {item.metrics.cost ? ` · $${item.metrics.cost.toFixed(4)}` : ''}
                      </Text>
                    )}
                  </View>
                </View>
              )}
            />

            {/* Chat Composer */}
            <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={s.composerInner}>
                <Text style={s.composerPrefix}>{'>_'}</Text>
                <TextInput
                  style={s.input}
                  placeholder="query..."
                  placeholderTextColor={T.textDim}
                  value={input}
                  onChangeText={setInput}
                  multiline
                  editable={!isLoading}
                  onSubmitEditing={handleSend}
                />
                <TouchableOpacity
                  onPress={handleSend}
                  disabled={!input.trim() || isLoading}
                  style={[s.sendBtn, (!input.trim() || isLoading) && s.sendBtnDisabled]}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={T.bg} />
                  ) : (
                    <Feather name="arrow-up" size={16} color={T.bg} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          /* ══════════ CREATE TAB ══════════ */
          <View style={s.flex}>
            <ScrollView
              ref={imageScrollRef}
              style={s.flex}
              contentContainerStyle={s.createContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Style Presets */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.presetsScroll} contentContainerStyle={s.presetsRow}>
                {STYLE_PRESETS.map(preset => {
                  const active = selectedStyle === preset.value;
                  return (
                    <TouchableOpacity
                      key={preset.label}
                      onPress={() => {
                        setSelectedStyle(active ? '' : preset.value);
                        Haptics.selectionAsync();
                      }}
                      style={[s.presetChip, active && s.presetChipActive]}
                    >
                      <Text style={[s.presetText, active && s.presetTextActive]}>{preset.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Generating State */}
              {isGenerating && (
                <Animated.View style={[s.genCard, { opacity: shimmerAnim }]}>
                  <View style={s.genCardInner}>
                    <ActivityIndicator size="small" color={T.amber} />
                    <Text style={s.genCardLabel}>RENDERING...</Text>
                    <Text style={s.genCardPrompt} numberOfLines={2}>{imagePrompt}</Text>
                  </View>
                </Animated.View>
              )}

              {/* Image Gallery or Empty State */}
              {images.length === 0 && !isGenerating ? (
                <View style={s.createEmpty}>
                  <Text style={s.emptyTerminal}>IMG GENERATOR</Text>
                  <Text style={s.emptySub}>describe a scene to render</Text>

                  <View style={s.suggestions}>
                    {IMAGE_SUGGESTIONS.map((sg, i) => (
                      <TouchableOpacity
                        key={i}
                        style={s.suggestion}
                        onPress={() => { setImagePrompt(sg.text); Haptics.selectionAsync(); }}
                      >
                        <Text style={[s.suggestionArrow, { color: T.amber }]}>{'>'}</Text>
                        <Text style={s.suggestionText}>{sg.text}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={s.imageGrid}>
                  {images.map(img => (
                    <TouchableOpacity
                      key={img.id}
                      style={s.imageCard}
                      onPress={() => setFullscreenImage(img)}
                      activeOpacity={0.85}
                    >
                      <View style={s.imageFrame}>
                        <Image
                          source={{ uri: img.imageData }}
                          style={[s.image, { aspectRatio: (img.width || 16) / (img.height || 9) }]}
                          contentFit="contain"
                        />
                      </View>
                      <View style={s.imageInfo}>
                        <Text style={s.imagePromptText} numberOfLines={2}>{img.prompt}</Text>
                        <View style={s.imageActions}>
                          <TouchableOpacity onPress={() => downloadImage(img)} style={s.imageActionBtn}>
                            <Feather name="share" size={14} color={T.text} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => downloadImage(img)} style={s.imageActionBtn}>
                            <Feather name="download" size={14} color={T.text} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Settings Panel */}
              {imageSettings && (
                <View style={s.imgPanel}>
                  <View style={s.imgPanelHeader}>
                    <Text style={s.imgPanelTitle}>// SETTINGS</Text>
                    <TouchableOpacity onPress={() => setImageSettings(false)}>
                      <Text style={s.imgPanelClose}>[x]</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Aspect Ratio */}
                  <Text style={s.panelLabel}>// RATIO</Text>
                  <View style={s.ratioRow}>
                    {ASPECT_RATIOS.map(r => {
                      const active = settings.imageWidth === r.w && settings.imageHeight === r.h;
                      return (
                        <TouchableOpacity
                          key={r.label}
                          onPress={() => {
                            updateSettings({ imageWidth: r.w, imageHeight: r.h });
                            Haptics.selectionAsync();
                          }}
                          style={[s.ratioBtn, active && s.ratioBtnActive]}
                        >
                          <View style={[
                            s.ratioIcon,
                            { width: r.boxW, height: r.boxH },
                            active && s.ratioIconActive,
                          ]} />
                          <Text style={[s.ratioText, active && s.ratioTextActive]}>{r.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Steps */}
                  <View style={s.sliderRow}>
                    <Text style={s.panelLabel}>// STEPS</Text>
                    <Text style={s.panelValue}>{settings.imageSteps || 8}</Text>
                  </View>
                  <Slider
                    value={settings.imageSteps || 8}
                    minimumValue={1}
                    maximumValue={8}
                    step={1}
                    onValueChange={v => updateSettings({ imageSteps: v })}
                    minimumTrackTintColor={T.amber}
                    maximumTrackTintColor={T.border}
                    thumbTintColor={T.amber}
                  />

                  {/* Guidance */}
                  <View style={s.sliderRow}>
                    <Text style={s.panelLabel}>// GUIDANCE</Text>
                    <Text style={s.panelValue}>{(settings.imageGuidanceScale || 7.5).toFixed(1)}</Text>
                  </View>
                  <Slider
                    value={settings.imageGuidanceScale || 7.5}
                    minimumValue={1}
                    maximumValue={20}
                    step={0.5}
                    onValueChange={v => updateSettings({ imageGuidanceScale: v })}
                    minimumTrackTintColor={T.amber}
                    maximumTrackTintColor={T.border}
                    thumbTintColor={T.amber}
                  />

                  {/* Negative Prompt */}
                  <Text style={s.panelLabel}>// NEGATIVE PROMPT</Text>
                  <TextInput
                    style={s.negInput}
                    placeholder="exclude elements..."
                    placeholderTextColor={T.textDim}
                    value={negativePrompt}
                    onChangeText={setNegativePrompt}
                    multiline
                  />
                </View>
              )}

              {/* Prompt History */}
              {showHistory && promptHistory.length > 0 && (
                <View style={s.historyPanel}>
                  <Text style={s.imgPanelTitle}>// RECENT</Text>
                  {promptHistory.slice(0, 8).map((p, i) => (
                    <TouchableOpacity
                      key={i}
                      style={s.historyItem}
                      onPress={() => {
                        setImagePrompt(p);
                        setShowHistory(false);
                        Haptics.selectionAsync();
                      }}
                    >
                      <Text style={s.historyText} numberOfLines={1}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </ScrollView>

            {/* Image Composer */}
            <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={s.composerInner}>
                <TouchableOpacity
                  onPress={() => { setImageSettings(!imageSettings); Haptics.selectionAsync(); }}
                  style={[s.compBtn, imageSettings && s.compBtnActive]}
                >
                  <Feather name="sliders" size={16} color={imageSettings ? T.amber : T.textMuted} />
                </TouchableOpacity>
                {promptHistory.length > 0 && (
                  <TouchableOpacity
                    onPress={() => { setShowHistory(!showHistory); Haptics.selectionAsync(); }}
                    style={[s.compBtn, showHistory && s.compBtnActive]}
                  >
                    <Feather name="clock" size={16} color={showHistory ? T.amber : T.textMuted} />
                  </TouchableOpacity>
                )}
                <TextInput
                  style={s.input}
                  placeholder="describe an image..."
                  placeholderTextColor={T.textDim}
                  value={imagePrompt}
                  onChangeText={setImagePrompt}
                  multiline
                  editable={!isGenerating}
                />
                <TouchableOpacity
                  onPress={handleGenerate}
                  disabled={!imagePrompt.trim() || isGenerating}
                  style={[s.sendBtnAmber, (!imagePrompt.trim() || isGenerating) && s.sendBtnDisabled]}
                >
                  {isGenerating ? (
                    <ActivityIndicator size="small" color={T.bg} />
                  ) : (
                    <Feather name="zap" size={16} color={T.bg} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* ══════════ FULLSCREEN IMAGE VIEWER ══════════ */}
      <Modal visible={!!fullscreenImage} animationType="fade" statusBarTranslucent>
        <View style={s.viewer}>
          <View style={s.viewerHeader}>
            <TouchableOpacity onPress={() => setFullscreenImage(null)} style={s.viewerClose}>
              <Feather name="x" size={22} color={T.text} />
            </TouchableOpacity>
          </View>
          {fullscreenImage && (
            <>
              <View style={s.viewerImageWrap}>
                <Image
                  source={{ uri: fullscreenImage.imageData }}
                  style={s.viewerImage}
                  contentFit="contain"
                />
              </View>
              <View style={[s.viewerBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                <Text style={s.viewerPrompt} numberOfLines={3}>{fullscreenImage.prompt}</Text>
                <View style={s.viewerActions}>
                  <TouchableOpacity onPress={() => fullscreenImage && downloadImage(fullscreenImage)} style={s.viewerBtn}>
                    <Feather name="share" size={18} color={T.text} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => fullscreenImage && downloadImage(fullscreenImage)} style={s.viewerBtn}>
                    <Feather name="download" size={18} color={T.text} />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* ══════════ MODEL PICKER ══════════ */}
      <Modal visible={showModels} animationType="slide" presentationStyle="formSheet">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>// SELECT MODEL</Text>
            <TouchableOpacity onPress={() => setShowModels(false)} style={s.modalClose}>
              <Text style={s.modalCloseText}>[x]</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={activeTab === 'chat' ? textModels : imageModels}
            keyExtractor={m => m.id}
            contentContainerStyle={s.modalList}
            renderItem={({ item }) => {
              const selected = (activeTab === 'chat' ? settings.model : settings.imageModel) === item.id;
              const badges = getModelBadges(item);
              return (
                <TouchableOpacity
                  onPress={() => {
                    if (activeTab === 'chat') {
                      updateSettings({ model: item.id });
                    } else {
                      updateSettings({ imageModel: item.id });
                    }
                    setShowModels(false);
                    Haptics.selectionAsync();
                  }}
                  style={[s.modelItem, selected && s.modelItemSelected]}
                >
                  <View style={s.modelInfo}>
                    <View style={s.modelNameRow}>
                      <Text style={[s.modelName, selected && { color: T.green }]}>
                        {selected ? '[*] ' : '[ ] '}
                        {item.model_spec?.name || item.id}
                      </Text>
                    </View>
                    <View style={s.modelMeta}>
                      <Text style={s.modelId}>{item.id}</Text>
                      {badges.length > 0 && (
                        <View style={s.badgeRow}>
                          {badges.map(b => (
                            <View key={b} style={s.badge}>
                              <Text style={s.badgeText}>{b}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════

const s = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: T.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: T.greenBorder,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoText: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: '700',
    color: T.green,
  },
  logoName: {
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: '700',
    color: T.text,
    letterSpacing: 1,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 2,
  },
  iconBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  modelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    gap: 6,
    maxWidth: 180,
    borderWidth: 1,
    borderColor: T.greenBorder,
  },
  modelBtnText: {
    fontFamily: MONO,
    color: T.text,
    fontSize: 11,
    fontWeight: '500',
  },

  // Tabs
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '600',
    color: T.textMuted,
    letterSpacing: 1,
  },
  tabFill: {
    flex: 1,
  },

  // Empty / Welcome
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTerminal: {
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: '700',
    color: T.green,
    letterSpacing: 2,
    marginBottom: 8,
  },
  emptySub: {
    fontFamily: MONO,
    fontSize: 12,
    color: T.textMuted,
    marginBottom: 32,
  },
  suggestions: {
    width: '100%',
    maxWidth: 360,
    gap: 6,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 4,
    gap: 10,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
  },
  suggestionArrow: {
    fontFamily: MONO,
    fontSize: 14,
    color: T.green,
    fontWeight: '700',
  },
  suggestionText: {
    fontFamily: MONO,
    color: T.text,
    fontSize: 12,
    flex: 1,
  },

  // Messages
  msgList: {
    paddingVertical: 4,
  },
  msgListEmpty: {
    flex: 1,
  },
  msgRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  msgRowAi: {
    backgroundColor: T.surface,
    borderLeftWidth: 2,
    borderLeftColor: T.greenBorder,
  },
  msgPrefix: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: '700',
    paddingTop: 1,
  },
  msgBody: {
    flex: 1,
  },
  msgText: {
    fontSize: 14,
    lineHeight: 21,
    color: T.text,
  },
  msgStreaming: {
    fontFamily: MONO,
    fontSize: 12,
    color: T.greenDim,
    fontStyle: 'italic',
  },
  metrics: {
    fontFamily: MONO,
    fontSize: 10,
    color: T.textMuted,
    marginTop: 8,
  },

  // Code
  codeBlock: {
    backgroundColor: '#08080C',
    borderRadius: 4,
    padding: 12,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: T.greenBorder,
  },
  codeText: {
    fontFamily: MONO,
    fontSize: 12,
    color: T.green,
    lineHeight: 18,
  },

  // Reasoning
  reasoning: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  reasoningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: T.surfaceLight,
  },
  reasoningToggle: {
    fontFamily: MONO,
    fontSize: 11,
    color: T.cyan,
    fontWeight: '700',
  },
  reasoningTitle: {
    fontFamily: MONO,
    fontSize: 11,
    color: T.textMuted,
    letterSpacing: 0.5,
  },
  reasoningBody: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: T.surface,
  },

  // Composer
  composer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: T.bg,
    borderTopWidth: 1,
    borderTopColor: T.border,
  },
  composerInner: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: T.surface,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
    borderWidth: 1,
    borderColor: T.greenBorder,
  },
  composerPrefix: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: '700',
    color: T.green,
    paddingBottom: 6,
  },
  input: {
    flex: 1,
    fontFamily: MONO,
    color: T.text,
    fontSize: 13,
    maxHeight: 100,
    paddingVertical: 4,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 4,
    backgroundColor: T.green,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnAmber: {
    width: 32,
    height: 32,
    borderRadius: 4,
    backgroundColor: T.amber,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.25,
  },
  compBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
  },
  compBtnActive: {
    backgroundColor: T.amberGlow,
  },

  // Create Tab
  createContent: {
    padding: 16,
    paddingBottom: 16,
  },
  createEmpty: {
    alignItems: 'center',
    paddingTop: 60,
  },

  // Style Presets
  presetsScroll: {
    marginBottom: 16,
    marginHorizontal: -16,
  },
  presetsRow: {
    paddingHorizontal: 16,
    gap: 6,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 4,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
  },
  presetChipActive: {
    borderColor: T.amberBorder,
    backgroundColor: T.amberGlow,
  },
  presetText: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '600',
    color: T.textMuted,
    letterSpacing: 0.5,
  },
  presetTextActive: {
    color: T.amber,
  },

  // Generating Card
  genCard: {
    backgroundColor: T.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: T.amberBorder,
    marginBottom: 16,
    overflow: 'hidden',
  },
  genCardInner: {
    alignItems: 'center',
    padding: 28,
    gap: 10,
  },
  genCardLabel: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '700',
    color: T.amber,
    letterSpacing: 2,
  },
  genCardPrompt: {
    fontFamily: MONO,
    fontSize: 11,
    color: T.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },

  // Image Grid
  imageGrid: {
    gap: 16,
  },
  imageCard: {
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
  },
  imageFrame: {
    backgroundColor: T.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
  },
  imageInfo: {
    padding: 12,
    gap: 8,
  },
  imagePromptText: {
    fontFamily: MONO,
    color: T.text,
    fontSize: 11,
    lineHeight: 16,
  },
  imageActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  imageActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 4,
    backgroundColor: T.surfaceLight,
    borderWidth: 1,
    borderColor: T.border,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Image Settings Panel
  imgPanel: {
    backgroundColor: T.surface,
    marginTop: 16,
    padding: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: T.amberBorder,
  },
  imgPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  imgPanelTitle: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: '700',
    color: T.amber,
    letterSpacing: 1,
  },
  imgPanelClose: {
    fontFamily: MONO,
    fontSize: 12,
    color: T.textMuted,
    fontWeight: '700',
  },
  panelLabel: {
    fontFamily: MONO,
    fontSize: 10,
    color: T.textMuted,
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 12,
  },
  panelValue: {
    fontFamily: MONO,
    fontSize: 12,
    color: T.amber,
    fontWeight: '700',
  },
  sliderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 2,
  },

  // Ratio buttons
  ratioRow: {
    flexDirection: 'row',
    gap: 8,
  },
  ratioBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 4,
    backgroundColor: T.surfaceLight,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 6,
  },
  ratioBtnActive: {
    borderColor: T.amberBorder,
    backgroundColor: T.amberGlow,
  },
  ratioIcon: {
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: T.textMuted,
  },
  ratioIconActive: {
    borderColor: T.amber,
  },
  ratioText: {
    fontFamily: MONO,
    fontSize: 10,
    color: T.textMuted,
    fontWeight: '600',
  },
  ratioTextActive: {
    color: T.amber,
  },

  // Negative prompt
  negInput: {
    fontFamily: MONO,
    fontSize: 12,
    color: T.text,
    backgroundColor: T.surfaceLight,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: T.border,
    padding: 10,
    minHeight: 44,
    textAlignVertical: 'top',
  },

  // Prompt History
  historyPanel: {
    backgroundColor: T.surface,
    marginTop: 16,
    padding: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: T.border,
  },
  historyItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  historyText: {
    fontFamily: MONO,
    fontSize: 11,
    color: T.text,
  },

  // Fullscreen Viewer
  viewer: {
    flex: 1,
    backgroundColor: T.black,
  },
  viewerHeader: {
    position: 'absolute',
    top: 50,
    right: 16,
    zIndex: 10,
  },
  viewerClose: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImageWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerBar: {
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  viewerPrompt: {
    fontFamily: MONO,
    fontSize: 12,
    color: T.text,
    lineHeight: 18,
    marginBottom: 12,
  },
  viewerActions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  viewerBtn: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: T.surfaceLight,
    borderWidth: 1,
    borderColor: T.border,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Model Picker Modal
  modal: {
    flex: 1,
    backgroundColor: T.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: T.greenBorder,
  },
  modalTitle: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: '700',
    color: T.green,
    letterSpacing: 1,
  },
  modalClose: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    fontFamily: MONO,
    fontSize: 14,
    color: T.textMuted,
    fontWeight: '700',
  },
  modalList: {
    padding: 16,
  },
  modelItem: {
    padding: 12,
    borderRadius: 4,
    marginBottom: 4,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modelItemSelected: {
    borderColor: T.greenBorder,
    backgroundColor: T.greenGlow,
  },
  modelInfo: {
    flex: 1,
  },
  modelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modelName: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '500',
    color: T.text,
  },
  modelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
    flexWrap: 'wrap',
  },
  modelId: {
    fontFamily: MONO,
    fontSize: 10,
    color: T.textDim,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 2,
    backgroundColor: T.surfaceActive,
    borderWidth: 1,
    borderColor: T.border,
  },
  badgeText: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '700',
    color: T.cyan,
    letterSpacing: 0.5,
  },
});

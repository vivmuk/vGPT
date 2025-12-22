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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
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
// FRENCH DESIGNER THEME - Subtle, Elegant, Futuristic
// Inspired by French minimalism with tricolore accents
// ═══════════════════════════════════════════════════════════════════════════

const THEME = {
  // Primary accents - RED for chat, ORANGE for images
  red: '#FF4757',            // Vibrant red - chat accent
  redLight: 'rgba(255, 71, 87, 0.15)',
  orange: '#FF7F50',         // Coral orange - image/create accent
  orangeLight: 'rgba(255, 127, 80, 0.15)',

  // Neutral
  blanc: '#FFFFFF',          // White

  // Dark sophisticated base
  noir: '#0C0C0E',           // Deep black
  surface: '#141416',        // Card surface
  surfaceHover: '#1C1C1F',   // Elevated surface
  surfaceActive: '#232326',  // Active states

  // Text with excellent contrast
  text: '#FAFAFA',           // Primary text
  textSecondary: '#A1A1A6',  // Secondary text
  textMuted: '#636366',      // Muted text
  textDim: '#48484A',        // Barely visible

  // Borders - ultra subtle
  border: 'rgba(255, 255, 255, 0.06)',
  borderLight: 'rgba(255, 255, 255, 0.03)',
  borderAccent: 'rgba(255, 71, 87, 0.3)',

  // Glows
  glowRed: 'rgba(255, 71, 87, 0.15)',
  glowOrange: 'rgba(255, 127, 80, 0.12)',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
  id: string;
  isStreaming?: boolean;
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

const SUGGESTIONS = [
  { icon: 'code', text: 'Write a React hook' },
  { icon: 'edit-3', text: 'Draft a professional email' },
  { icon: 'cpu', text: 'Explain machine learning' },
  { icon: 'globe', text: 'Plan a trip to Paris' },
];

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

  // Refs
  const listRef = useRef<FlatList>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const tokenRef = useRef<number>(0);

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

  const textModels = useMemo(() =>
    models.filter(m => !isImageModel(m)), [models]);

  const imageModels = useMemo(() =>
    models.filter(m => isImageModel(m)), [models]);

  // Auto-select models
  useEffect(() => {
    if (textModels.length && !textModels.find(m => m.id === settings.model)) {
      updateSettings({ model: textModels[0].id });
    }
  }, [textModels, settings.model]);

  useEffect(() => {
    if (imageModels.length && !imageModels.find(m => m.id === settings.imageModel)) {
      updateSettings({ imageModel: imageModels[0].id });
    }
  }, [imageModels, settings.imageModel]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      persistSettings(next);
      return next;
    });
  }, []);

  const getModelName = (id: string) => {
    const m = models.find(x => x.id === id);
    return m?.model_spec?.name || id.split('/').pop() || id;
  };

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
    setMessages(prev => [...prev, { role: 'assistant', content: '', id: assistantId, isStreaming: true }]);

    try {
      const controller = new AbortController();
      controllerRef.current?.abort();
      controllerRef.current = controller;

      const currentModel = models.find(m => m.id === settings.model);
      const veniceParams: any = {
        include_venice_system_prompt: settings.includeVeniceSystemPrompt,
      };
      if (currentModel?.model_spec?.capabilities?.supportsWebSearch) {
        veniceParams.enable_web_search = settings.webSearch;
        veniceParams.enable_web_citations = settings.webCitations;
      }

      const body = {
        model: settings.model,
        messages: history.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        venice_parameters: veniceParams,
        temperature: settings.temperature,
        top_p: settings.topP,
        max_completion_tokens: settings.maxTokens,
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

              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) {
                content += delta;
                tokenRef.current += Math.ceil(delta.length / 4);

                const elapsed = (Date.now() - startTimeRef.current) / 1000;
                const tps = elapsed > 0 ? tokenRef.current / elapsed : 0;

                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content, metrics: { tokensPerSecond: Math.round(tps * 10) / 10, totalTokens: tokenRef.current } }
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
        usage = data?.usage;
      }

      // Final metrics
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
    const prompt = imagePrompt.trim();
    if (!prompt || isGenerating) return;

    const model = imageModels.find(m => m.id === settings.imageModel);
    if (!model) {
      Alert.alert('No Model', 'Please select an image model.');
      return;
    }

    setIsGenerating(true);

    try {
      const payload = {
        model: model.id,
        prompt,
        width: settings.imageWidth || 1024,
        height: settings.imageHeight || 1024,
        steps: Math.min(settings.imageSteps || 8, 8),
        cfg_scale: Math.max(1, Math.min(20, settings.imageGuidanceScale || 7.5)),
        format: 'webp',
        hide_watermark: false,
      };

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
        prompt,
        modelId: model.id,
        createdAt: Date.now(),
        imageData: `data:image/webp;base64,${data.images[0]}`,
        width: payload.width,
        height: payload.height,
      };

      setImages(prev => [img, ...prev]);
      setImagePrompt('');
    } catch (e: any) {
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
          <View key={i} style={styles.codeBlock}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={styles.codeText}>{code}</Text>
            </ScrollView>
          </View>
        );
      }
      return <Text key={i} style={styles.msgText}>{part}</Text>;
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LOADING STATE
  // ═══════════════════════════════════════════════════════════════════════════

  if (loadingModels) {
    return (
      <View style={styles.loadingScreen}>
        <View style={styles.loadingPulse}>
          <View style={styles.loadingDot} />
        </View>
        <Text style={styles.loadingText}>Initializing</Text>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <View style={styles.headerLeft}>
          <View style={styles.logoWrapper}>
            <View style={styles.logoRed} />
            <View style={styles.logoBlanc} />
            <View style={styles.logoOrange} />
          </View>
          <Text style={styles.logoText}>vGPT</Text>
        </View>

        <TouchableOpacity onPress={() => setShowModels(true)} style={styles.modelBtn}>
          <Text style={styles.modelBtnText} numberOfLines={1}>
            {getModelName(activeTab === 'chat' ? settings.model : settings.imageModel)}
          </Text>
          <Feather name="chevron-down" size={14} color={THEME.red} />
        </TouchableOpacity>

        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setMessages([])}
            style={styles.iconBtn}
            disabled={messages.length === 0}
          >
            <Feather name="trash-2" size={18} color={messages.length ? THEME.textSecondary : THEME.textDim} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/settings')} style={styles.iconBtn}>
            <Feather name="settings" size={18} color={THEME.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {[
          { key: 'chat', label: 'Chat', icon: 'message-circle' },
          { key: 'create', label: 'Create', icon: 'image' },
        ].map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setActiveTab(tab.key as any)}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
          >
            <Feather
              name={tab.icon as any}
              size={15}
              color={activeTab === tab.key ? (tab.key === 'chat' ? THEME.red : THEME.orange) : THEME.textMuted}
            />
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        {activeTab === 'chat' ? (
          <View style={styles.flex}>
            {/* Messages */}
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={m => m.id}
              contentContainerStyle={[styles.msgList, messages.length === 0 && styles.msgListEmpty]}
              onContentSizeChange={() => listRef.current?.scrollToEnd()}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <View style={styles.emptyIcon}>
                    <Feather name="message-circle" size={28} color={THEME.red} />
                  </View>
                  <Text style={styles.emptyTitle}>Start a conversation</Text>
                  <Text style={styles.emptySub}>Ask anything or try a suggestion</Text>

                  <View style={styles.suggestions}>
                    {SUGGESTIONS.map((s, i) => (
                      <TouchableOpacity
                        key={i}
                        style={styles.suggestion}
                        onPress={() => setInput(s.text)}
                      >
                        <Feather name={s.icon as any} size={14} color={THEME.orange} />
                        <Text style={styles.suggestionText}>{s.text}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              }
              renderItem={({ item }) => (
                <View style={[styles.msgRow, item.role === 'assistant' && styles.msgRowAi]}>
                  <View style={[styles.avatar, item.role === 'user' ? styles.avatarUser : styles.avatarAi]}>
                    <Feather
                      name={item.role === 'user' ? 'user' : 'cpu'}
                      size={12}
                      color={item.role === 'user' ? THEME.noir : THEME.red}
                    />
                  </View>
                  <View style={styles.msgBody}>
                    <Text style={styles.msgRole}>{item.role === 'user' ? 'You' : 'AI'}</Text>
                    {item.isStreaming && !item.content ? (
                      <View style={styles.typing}>
                        <View style={[styles.typingDot, styles.typingDot1]} />
                        <View style={[styles.typingDot, styles.typingDot2]} />
                        <View style={[styles.typingDot, styles.typingDot3]} />
                      </View>
                    ) : (
                      renderCode(item.content)
                    )}
                    {item.metrics && !item.isStreaming && (
                      <View style={styles.metrics}>
                        <Text style={styles.metric}>{item.metrics.tokensPerSecond} tok/s</Text>
                        <Text style={styles.metricDot}>·</Text>
                        <Text style={styles.metric}>{item.metrics.totalTokens} tokens</Text>
                        {item.metrics.cost && (
                          <>
                            <Text style={styles.metricDot}>·</Text>
                            <Text style={styles.metric}>${item.metrics.cost.toFixed(4)}</Text>
                          </>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              )}
            />

            {/* Composer */}
            <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={styles.composerInner}>
                <TextInput
                  style={styles.input}
                  placeholder="Ask anything..."
                  placeholderTextColor={THEME.textMuted}
                  value={input}
                  onChangeText={setInput}
                  multiline
                  editable={!isLoading}
                  onSubmitEditing={handleSend}
                />
                <TouchableOpacity
                  onPress={handleSend}
                  disabled={!input.trim() || isLoading}
                  style={[styles.sendBtn, (!input.trim() || isLoading) && styles.sendBtnDisabled]}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={THEME.noir} />
                  ) : (
                    <Feather name="arrow-up" size={18} color={THEME.noir} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          /* CREATE TAB */
          <View style={styles.flex}>
            <ScrollView contentContainerStyle={styles.createContent}>
              {images.length === 0 ? (
                <View style={styles.createEmpty}>
                  <View style={styles.createEmptyIcon}>
                    <Feather name="image" size={28} color={THEME.orange} />
                  </View>
                  <Text style={styles.emptyTitle}>Generate images</Text>
                  <Text style={styles.emptySub}>Describe what you want to create</Text>
                </View>
              ) : (
                <View style={styles.imageGrid}>
                  {images.map(img => (
                    <View key={img.id} style={styles.imageCard}>
                      <Image
                        source={{ uri: img.imageData }}
                        style={[styles.image, { aspectRatio: (img.width || 1) / (img.height || 1) }]}
                        contentFit="cover"
                      />
                      <View style={styles.imageOverlay}>
                        <Text style={styles.imagePrompt} numberOfLines={2}>{img.prompt}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            {/* Image Settings */}
            {imageSettings && (
              <View style={styles.imgSettings}>
                <View style={styles.imgSettingsHeader}>
                  <Text style={styles.imgSettingsTitle}>Settings</Text>
                  <TouchableOpacity onPress={() => setImageSettings(false)}>
                    <Feather name="x" size={18} color={THEME.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Steps</Text>
                  <Text style={styles.settingValue}>{settings.imageSteps || 8}</Text>
                </View>
                <Slider
                  value={settings.imageSteps || 8}
                  minimumValue={1}
                  maximumValue={8}
                  step={1}
                  onValueChange={v => updateSettings({ imageSteps: v })}
                  minimumTrackTintColor={THEME.orange}
                  maximumTrackTintColor={THEME.border}
                  thumbTintColor={THEME.orange}
                />

                <View style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Guidance</Text>
                  <Text style={styles.settingValue}>{(settings.imageGuidanceScale || 7.5).toFixed(1)}</Text>
                </View>
                <Slider
                  value={settings.imageGuidanceScale || 7.5}
                  minimumValue={1}
                  maximumValue={20}
                  step={0.5}
                  onValueChange={v => updateSettings({ imageGuidanceScale: v })}
                  minimumTrackTintColor={THEME.orange}
                  maximumTrackTintColor={THEME.border}
                  thumbTintColor={THEME.orange}
                />

                <View style={styles.sizes}>
                  {[
                    { label: '1:1', w: 1024, h: 1024 },
                    { label: '9:16', w: 576, h: 1024 },
                    { label: '16:9', w: 1024, h: 576 },
                  ].map(s => (
                    <TouchableOpacity
                      key={s.label}
                      onPress={() => updateSettings({ imageWidth: s.w, imageHeight: s.h })}
                      style={[
                        styles.sizeBtn,
                        settings.imageWidth === s.w && settings.imageHeight === s.h && styles.sizeBtnActive
                      ]}
                    >
                      <Text style={[
                        styles.sizeBtnText,
                        settings.imageWidth === s.w && settings.imageHeight === s.h && styles.sizeBtnTextActive
                      ]}>{s.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Image Composer */}
            <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={styles.composerInner}>
                <TouchableOpacity
                  onPress={() => setImageSettings(!imageSettings)}
                  style={styles.settingsToggle}
                >
                  <Feather name="sliders" size={18} color={imageSettings ? THEME.orange : THEME.textMuted} />
                </TouchableOpacity>
                <TextInput
                  style={styles.input}
                  placeholder="Describe an image..."
                  placeholderTextColor={THEME.textMuted}
                  value={imagePrompt}
                  onChangeText={setImagePrompt}
                  multiline
                  editable={!isGenerating}
                />
                <TouchableOpacity
                  onPress={handleGenerate}
                  disabled={!imagePrompt.trim() || isGenerating}
                  style={[styles.sendBtnOrange, (!imagePrompt.trim() || isGenerating) && styles.sendBtnDisabled]}
                >
                  {isGenerating ? (
                    <ActivityIndicator size="small" color={THEME.noir} />
                  ) : (
                    <Feather name="zap" size={18} color={THEME.noir} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Model Picker Modal */}
      <Modal visible={showModels} animationType="slide" presentationStyle="formSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Model</Text>
            <TouchableOpacity onPress={() => setShowModels(false)} style={styles.modalClose}>
              <Feather name="x" size={24} color={THEME.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={activeTab === 'chat' ? textModels : imageModels}
            keyExtractor={m => m.id}
            contentContainerStyle={styles.modalList}
            renderItem={({ item }) => {
              const selected = (activeTab === 'chat' ? settings.model : settings.imageModel) === item.id;
              return (
                <TouchableOpacity
                  onPress={() => {
                    if (activeTab === 'chat') {
                      updateSettings({ model: item.id });
                    } else {
                      updateSettings({ imageModel: item.id });
                    }
                    setShowModels(false);
                  }}
                  style={[styles.modelItem, selected && styles.modelItemSelected]}
                >
                  <View style={styles.modelInfo}>
                    <Text style={styles.modelName}>{item.model_spec?.name || item.id}</Text>
                    <Text style={styles.modelId}>{item.id}</Text>
                  </View>
                  {selected && (
                    <View style={styles.modelCheck}>
                      <Feather name="check" size={16} color={THEME.red} />
                    </View>
                  )}
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: THEME.noir },

  // Loading
  loadingScreen: {
    flex: 1,
    backgroundColor: THEME.noir,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingPulse: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: THEME.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME.red,
  },
  loadingText: {
    color: THEME.textMuted,
    fontSize: 13,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoWrapper: {
    width: 20,
    height: 20,
    flexDirection: 'row',
    gap: 2,
  },
  logoRed: { flex: 1, backgroundColor: THEME.red, borderRadius: 2 },
  logoBlanc: { flex: 1, backgroundColor: THEME.blanc, borderRadius: 2 },
  logoOrange: { flex: 1, backgroundColor: THEME.orange, borderRadius: 2 },
  logoText: {
    fontSize: 17,
    fontWeight: '700',
    color: THEME.text,
    letterSpacing: -0.3,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  modelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    maxWidth: 160,
    borderWidth: 1,
    borderColor: THEME.borderAccent,
  },
  modelBtnText: {
    color: THEME.text,
    fontSize: 13,
    fontWeight: '500',
  },

  // Tabs
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  tabActive: {
    backgroundColor: THEME.glowRed,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: THEME.textMuted,
  },
  tabLabelActive: {
    color: THEME.red,
  },

  // Empty / Welcome
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: THEME.glowRed,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: THEME.text,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 14,
    color: THEME.textSecondary,
    marginBottom: 28,
  },
  suggestions: {
    width: '100%',
    maxWidth: 360,
    gap: 8,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  suggestionText: {
    color: THEME.text,
    fontSize: 14,
  },

  // Messages
  msgList: {
    paddingBottom: 100,
  },
  msgListEmpty: {
    flex: 1,
  },
  msgRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  msgRowAi: {
    backgroundColor: THEME.surface,
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarUser: {
    backgroundColor: THEME.blanc,
  },
  avatarAi: {
    backgroundColor: THEME.glowRed,
    borderWidth: 1,
    borderColor: THEME.borderAccent,
  },
  msgBody: {
    flex: 1,
  },
  msgRole: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.textMuted,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  msgText: {
    fontSize: 15,
    lineHeight: 22,
    color: THEME.text,
  },
  typing: {
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 8,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: THEME.red,
  },
  typingDot1: { opacity: 0.3 },
  typingDot2: { opacity: 0.6 },
  typingDot3: { opacity: 1 },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  metric: {
    fontSize: 11,
    color: THEME.textMuted,
  },
  metricDot: {
    color: THEME.textDim,
    fontSize: 11,
  },

  // Code
  codeBlock: {
    backgroundColor: '#0a0a0c',
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: THEME.text,
    lineHeight: 20,
  },

  // Composer
  composer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: THEME.noir,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
  },
  composerInner: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: THEME.surface,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  input: {
    flex: 1,
    color: THEME.text,
    fontSize: 15,
    maxHeight: 100,
    paddingVertical: 6,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: THEME.red,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnOrange: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: THEME.orange,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.3,
  },
  settingsToggle: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Create Tab
  createContent: {
    padding: 16,
    paddingBottom: 120,
  },
  createEmpty: {
    alignItems: 'center',
    paddingTop: 80,
  },
  createEmptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: THEME.orangeLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  imageGrid: {
    gap: 16,
  },
  imageCard: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  image: {
    width: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  imagePrompt: {
    color: THEME.text,
    fontSize: 13,
  },

  // Image Settings
  imgSettings: {
    backgroundColor: THEME.surface,
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  imgSettingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  imgSettingsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    marginTop: 12,
  },
  settingLabel: {
    fontSize: 13,
    color: THEME.textSecondary,
  },
  settingValue: {
    fontSize: 13,
    color: THEME.orange,
    fontWeight: '600',
  },
  sizes: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  sizeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: THEME.surfaceHover,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sizeBtnActive: {
    borderColor: THEME.orange,
    backgroundColor: THEME.orangeLight,
  },
  sizeBtnText: {
    fontSize: 12,
    color: THEME.textSecondary,
    fontWeight: '500',
  },
  sizeBtnTextActive: {
    color: THEME.orange,
  },

  // Modal
  modal: {
    flex: 1,
    backgroundColor: THEME.noir,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: THEME.text,
  },
  modalClose: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalList: {
    padding: 16,
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modelItemSelected: {
    borderColor: THEME.red,
    backgroundColor: THEME.glowRed,
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    fontSize: 14,
    fontWeight: '500',
    color: THEME.text,
    marginBottom: 2,
  },
  modelId: {
    fontSize: 11,
    color: THEME.textMuted,
  },
  modelCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: THEME.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

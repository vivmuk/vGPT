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
  LayoutAnimation,
  UIManager,
  Share,
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
  VENICE_API_KEY,
  VENICE_CHAT_COMPLETIONS_ENDPOINT,
  VENICE_MODELS_ENDPOINT,
  VENICE_IMAGE_GENERATIONS_ENDPOINT,
} from '@/constants/venice';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  id: string;
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

// Futuristic Indian Flag Color Palette
const THEME = {
  // Core colors from Indian flag
  saffron: '#FF6B35',      // Vibrant saffron (courage & sacrifice)
  white: '#FFFFFF',        // Pure white (peace & truth)
  navy: '#000080',         // Navy blue (Ashoka Chakra)
  green: '#138808',        // India green (fertility & growth)

  // Dark futuristic base
  background: '#0a0a0f',   // Deep space black
  surface: '#12121a',      // Elevated surface
  surfaceLight: '#1a1a24', // Lighter surface

  // Text hierarchy
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textMuted: 'rgba(255, 255, 255, 0.4)',

  // Borders & accents
  border: 'rgba(255, 107, 53, 0.2)',        // Saffron border
  borderLight: 'rgba(255, 255, 255, 0.08)',

  // Gradients (for glows)
  glowSaffron: 'rgba(255, 107, 53, 0.15)',
  glowNavy: 'rgba(0, 0, 128, 0.2)',
  glowGreen: 'rgba(19, 136, 8, 0.15)',
};

const isImageModel = (model?: VeniceModel | null): boolean => {
  if (!model) return false;
  const modelType = model.type?.toLowerCase() ?? '';
  if (modelType === 'image' || modelType.includes('image') || modelType.includes('diffusion')) {
    return true;
  }
  const capabilities = model.model_spec?.capabilities || {};
  if (capabilities.supportsImageGeneration === true || capabilities.image === true) {
    return true;
  }
  const modelId = model.id.toLowerCase();
  const imageKeywords = ['image', 'flux', 'sd', 'stable-diffusion', 'dalle', 'midjourney', 'imagen'];
  return imageKeywords.some(keyword => modelId.includes(keyword));
};

const resolveUsdPrice = (pricingSection: unknown): number | undefined => {
  if (pricingSection == null) return undefined;
  if (typeof pricingSection === 'number') return pricingSection;
  if (typeof pricingSection === 'object' && 'usd' in (pricingSection as Record<string, unknown>)) {
    const value = (pricingSection as Record<string, unknown>).usd;
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
};

const SUGGESTIONS = [
  "Explain quantum computing",
  "Write a futuristic haiku",
  "Debug this React code",
  "Plan a trip to India",
];

export default function FullAppScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<'chat' | 'image'>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<VeniceModel[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [showImageSettings, setShowImageSettings] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const responseStartTimeRef = useRef<number>(0);
  const tokenCountRef = useRef<number>(0);

  useEffect(() => {
    loadStoredSettings<AppSettings>(DEFAULT_SETTINGS).then((loadedSettings) => {
      if (loadedSettings.imageGuidanceScale !== undefined) {
        loadedSettings.imageGuidanceScale = Math.max(1, Math.min(20, loadedSettings.imageGuidanceScale));
      }
      setSettings(loadedSettings);
    });
    loadModels();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      loadStoredSettings<AppSettings>(DEFAULT_SETTINGS).then((loadedSettings) => {
        if (JSON.stringify(loadedSettings) !== JSON.stringify(settings)) {
          if (loadedSettings.imageGuidanceScale !== undefined) {
            loadedSettings.imageGuidanceScale = Math.max(1, Math.min(20, loadedSettings.imageGuidanceScale));
          }
          setSettings(loadedSettings);
        }
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [settings]);

  useEffect(() => {
    return () => {
      activeRequestControllerRef.current?.abort();
    };
  }, []);

  const textModels = useMemo(() =>
    models.filter((model: VeniceModel) => {
      const modelType = model.type?.toLowerCase() ?? '';
      return modelType !== 'image' && !isImageModel(model);
    }),
    [models]
  );

  const imageModels = useMemo(() => {
    return models.filter((model: VeniceModel) => isImageModel(model));
  }, [models]);

  const updateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings((prev: AppSettings) => {
      const updated = { ...prev, ...newSettings };
      if (updated.imageGuidanceScale !== undefined) {
        updated.imageGuidanceScale = Math.max(1, Math.min(20, updated.imageGuidanceScale));
      }
      void persistSettings(updated);
      return updated;
    });
  }, []);

  const loadModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const textResponse = await fetch(VENICE_MODELS_ENDPOINT, {
        method: 'GET',
        headers: { Authorization: `Bearer ${VENICE_API_KEY}` },
      });

      if (!textResponse.ok) throw new Error(`Venice API error: ${textResponse.status}`);

      const textData = await textResponse.json();
      const textModelsList: VeniceModel[] = Array.isArray(textData?.data)
        ? textData.data
        : Array.isArray(textData?.models)
          ? textData.models
          : [];

      const imageResponse = await fetch(`${VENICE_MODELS_ENDPOINT}?type=image`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${VENICE_API_KEY}` },
      });

      let imageModelsList: VeniceModel[] = [];
      if (imageResponse.ok) {
        const imageData = await imageResponse.json();
        imageModelsList = Array.isArray(imageData?.data)
          ? imageData.data
          : Array.isArray(imageData?.models)
            ? imageData.models
            : [];
      }

      const allModels = [...textModelsList, ...imageModelsList];
      setModels(allModels);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    if (textModels.length === 0) return;
    if (!settings.model || !textModels.some((model) => model.id === settings.model)) {
      updateSettings({ model: textModels[0].id });
    }
  }, [textModels, settings.model, updateSettings]);

  useEffect(() => {
    if (imageModels.length === 0) return;
    if (!settings.imageModel || !imageModels.some((model) => model.id === settings.imageModel)) {
      updateSettings({ imageModel: imageModels[0].id });
    }
  }, [imageModels, settings.imageModel, updateSettings]);

  const getModelDisplayName = useCallback((modelId: string) => {
    const model = models.find((m) => m.id === modelId);
    return model?.model_spec.name || modelId;
  }, [models]);

  const handleChatModelSelect = useCallback((modelId: string) => {
    updateSettings({ model: modelId });
    setShowModelPicker(false);
  }, [updateSettings]);

  const handleImageModelSelect = useCallback((modelId: string) => {
    updateSettings({ imageModel: modelId });
    setShowModelPicker(false);
  }, [updateSettings]);

  const scrollToBottom = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setShowScrollToBottom(false);
  };

  const handleScroll = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const contentHeight = event.nativeEvent.contentSize.height;
    const layoutHeight = event.nativeEvent.layoutMeasurement.height;

    if (contentHeight - layoutHeight - offsetY > 100) {
      setShowScrollToBottom(true);
    } else {
      setShowScrollToBottom(false);
    }
  };

  const handleClearChat = () => {
    Alert.alert(
      'Clear Chat',
      'Are you sure you want to clear the conversation history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setMessages([]);
          }
        }
      ]
    );
  };

  const handleSuggestionPress = (suggestion: string) => {
    setMessage(suggestion);
  };

  const downloadImage = async (imageUrl: string) => {
    try {
      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = `vgpt-image-${Date.now()}.webp`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        await Share.share({
          url: imageUrl,
          title: 'Generated Image',
        });
      }
    } catch (error) {
      console.error('Download failed:', error);
      Alert.alert('Error', 'Failed to download image.');
    }
  };

  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    const userMessageText = message.trim();
    setMessage('');
    setIsLoading(true);

    const newUserMessage: Message = {
      role: 'user',
      content: userMessageText,
      id: Date.now().toString(),
    };

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const conversationMessages = [...messages, newUserMessage];
    setMessages((prev) => [...prev, newUserMessage]);

    let assistantMessageId: string | null = null;

    try {
      const conversationHistory = conversationMessages.map((msg: Message) => ({
        role: msg.role,
        content: msg.content,
      }));

      const currentModel = models.find(m => m.id === settings.model);

      const veniceParameters: any = {
        include_venice_system_prompt: settings.includeVeniceSystemPrompt,
      };

      if (currentModel?.model_spec?.capabilities?.supportsWebSearch) {
        veniceParameters.enable_web_search = settings.webSearch;
        veniceParameters.enable_web_citations = settings.webCitations;
      }

      if (currentModel?.model_spec?.capabilities?.supportsReasoning) {
        if (settings.stripThinking !== undefined) veniceParameters.strip_thinking_response = settings.stripThinking;
        if (settings.disableThinking !== undefined) veniceParameters.disable_thinking = settings.disableThinking;
      }

      const requestBody: Record<string, any> = {
        model: settings.model,
        messages: conversationHistory,
        stream: true,
        venice_parameters: veniceParameters,
      };

      if (settings.temperature !== undefined) requestBody.temperature = settings.temperature;
      if (settings.topP !== undefined) requestBody.top_p = settings.topP;
      if (settings.minP !== undefined) requestBody.min_p = settings.minP;
      if (settings.maxTokens !== undefined) requestBody.max_completion_tokens = settings.maxTokens;
      if (settings.topK !== undefined) requestBody.top_k = settings.topK;
      if (settings.repetitionPenalty !== undefined) requestBody.repetition_penalty = settings.repetitionPenalty;

      const controller = new AbortController();
      activeRequestControllerRef.current?.abort();
      activeRequestControllerRef.current = controller;

      const response = await fetch(VENICE_CHAT_COMPLETIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VENICE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal as any,
      });

      activeRequestControllerRef.current = null;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Venice API error: ${response.status} - ${errorText}`);
      }

      assistantMessageId = `${Date.now()}-assistant`;
      responseStartTimeRef.current = Date.now();
      tokenCountRef.current = 0;

      const placeholderMessage: Message = {
        role: 'assistant',
        content: '',
        id: assistantMessageId,
      };

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMessages((prev) => [...prev, placeholderMessage]);

      const updateAssistantMessage = (partial: Partial<Message>) => {
        if (!assistantMessageId) return;
        setMessages((prev: Message[]) =>
          prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, ...partial } : msg))
        );
      };

      let rawAssistantContent = '';
      let finalUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;
      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = line.replace(/^data:\s*/, '').trim();
              if (data === '[DONE]') break;

              try {
                const parsed = JSON.parse(data);
                const choice = parsed?.choices?.[0];

                if (parsed?.usage) {
                  finalUsage = parsed.usage;
                  tokenCountRef.current = finalUsage?.total_tokens || finalUsage?.completion_tokens || tokenCountRef.current;
                }

                if (choice?.delta?.content) {
                  rawAssistantContent += choice.delta.content;
                  const newTokens = Math.ceil(choice.delta.content.length / 4);
                  tokenCountRef.current += newTokens;

                  const now = Date.now();
                  const elapsed = (now - responseStartTimeRef.current) / 1000;
                  const tokensPerSecond = elapsed > 0 ? tokenCountRef.current / elapsed : 0;

                  updateAssistantMessage({
                    content: rawAssistantContent,
                    metrics: {
                      tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
                      totalTokens: tokenCountRef.current,
                    }
                  });
                }
                if (choice?.message?.content) {
                  rawAssistantContent = choice.message.content;
                  updateAssistantMessage({ content: rawAssistantContent });
                }
              } catch (streamError) {
                console.error('Failed to parse stream chunk:', streamError);
              }
            }
          }
        }

        reader.releaseLock?.();

        const responseTime = (Date.now() - responseStartTimeRef.current) / 1000;
        const currentModel = models.find(m => m.id === settings.model);
        const inputPrice = resolveUsdPrice(currentModel?.model_spec.pricing?.input);
        const outputPrice = resolveUsdPrice(currentModel?.model_spec.pricing?.output);

        let inputTokens = finalUsage?.prompt_tokens;
        let outputTokens = finalUsage?.completion_tokens;
        let totalTokens = finalUsage?.total_tokens;

        if (!inputTokens || !outputTokens) {
          const estimatedOutputTokens = Math.ceil(rawAssistantContent.length / 4);
          const conversationText = conversationHistory.map(m => m.content).join(' ');
          const estimatedInputTokens = Math.ceil(conversationText.length / 4);

          inputTokens = inputTokens || estimatedInputTokens;
          outputTokens = outputTokens || estimatedOutputTokens;
          totalTokens = totalTokens || (inputTokens + outputTokens);
        }

        const tokensPerSecond = responseTime > 0 && totalTokens ? totalTokens / responseTime : 0;

        let cost = 0;
        if (inputPrice && inputTokens) cost += (inputPrice * inputTokens) / 1_000_000;
        if (outputPrice && outputTokens) cost += (outputPrice * outputTokens) / 1_000_000;

        updateAssistantMessage({
          metrics: {
            tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
            totalTokens: totalTokens,
            inputTokens: inputTokens,
            outputTokens: outputTokens,
            cost: cost > 0 ? Math.round(cost * 10000) / 10000 : undefined,
            responseTime: Math.round(responseTime * 10) / 10,
          }
        });
      } else {
        const data = await response.json();
        rawAssistantContent = data?.choices?.[0]?.message?.content ?? '';
        const responseTime = (Date.now() - responseStartTimeRef.current) / 1000;
        const usage = data?.usage;

        const currentModel = models.find(m => m.id === settings.model);
        const inputPrice = resolveUsdPrice(currentModel?.model_spec.pricing?.input);
        const outputPrice = resolveUsdPrice(currentModel?.model_spec.pricing?.output);

        let cost = 0;
        if (usage) {
          if (inputPrice && usage.prompt_tokens) cost += (inputPrice * usage.prompt_tokens) / 1_000_000;
          if (outputPrice && usage.completion_tokens) cost += (outputPrice * usage.completion_tokens) / 1_000_000;
        }

        const tokensPerSecond = usage && responseTime > 0 ? (usage.total_tokens || 0) / responseTime : 0;

        updateAssistantMessage({
          content: rawAssistantContent || "Sorry, I couldn't generate a response.",
          metrics: usage ? {
            tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
            totalTokens: usage.total_tokens,
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            cost: cost > 0 ? Math.round(cost * 10000) / 10000 : undefined,
            responseTime: Math.round(responseTime * 10) / 10,
          } : undefined,
        });
      }
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
              ? { ...msg, content: fallbackText }
              : msg
          )
        );
      }

      Alert.alert(isAbortError ? 'Request cancelled' : 'Error', fallbackText);
    } finally {
      setIsLoading(false);
      activeRequestControllerRef.current = null;
    }
  };

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim() || isGeneratingImage) return;

    const currentImageModel = imageModels.find((model) => model.id === settings.imageModel);
    if (!currentImageModel) {
      Alert.alert('No image model', 'Please select an image generation model.');
      return;
    }

    setIsGeneratingImage(true);
    setImageError(null);

    try {
      const payload: Record<string, any> = {
        model: currentImageModel.id,
        prompt: imagePrompt.trim(),
        width: settings.imageWidth,
        height: settings.imageHeight,
        format: 'webp',
        hide_watermark: false,
      };

      if (settings.imageSteps !== undefined) {
        payload.steps = Math.min(settings.imageSteps, 8);
      }
      if (settings.imageGuidanceScale !== undefined) {
        payload.cfg_scale = Math.max(1, Math.min(20, settings.imageGuidanceScale));
      }

      const response = await fetch(VENICE_IMAGE_GENERATIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VENICE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Venice image API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const imagesArray = data?.images;

      if (!imagesArray || !Array.isArray(imagesArray) || imagesArray.length === 0) {
        throw new Error('Image response did not include images array.');
      }

      const base64String = imagesArray[0];
      const imageData = `data:image/webp;base64,${base64String}`;

      const generated: GeneratedImage = {
        id: `${Date.now()}`,
        prompt: imagePrompt.trim(),
        modelId: currentImageModel.id,
        createdAt: Date.now(),
        imageData,
        width: payload.width,
        height: payload.height,
      };

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setGeneratedImages((prev: GeneratedImage[]) => [generated, ...prev]);
      setImagePrompt('');
    } catch (error) {
      console.error('Failed to generate image:', error);
      setImageError(error instanceof Error ? error.message : 'Failed to generate image.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const formatMessageContent = (content: string): React.ReactNode => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const codeContent = part.replace(/^```[a-z]*\n?/, '').replace(/```$/, '');
        return (
          <View key={index} style={styles.codeBlock}>
            <View style={styles.codeHeader}>
              <Text style={styles.codeHeaderText}>CODE</Text>
              <View style={styles.codeHeaderDot} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={styles.codeText}>{codeContent}</Text>
            </ScrollView>
          </View>
        );
      }
      return (
        <Text key={index} style={styles.messageText}>
          {part}
        </Text>
      );
    });
  };

  // ===== RENDER COMPONENTS =====

  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerLeft}>
        <View style={styles.logoMark}>
          <View style={styles.logoBar1} />
          <View style={styles.logoBar2} />
          <View style={styles.logoBar3} />
        </View>
        <Text style={styles.logoText}>vGPT</Text>
      </View>

      <TouchableOpacity onPress={() => setShowModelPicker(true)} style={styles.modelSelector}>
        <Text style={styles.modelSelectorText} numberOfLines={1}>
          {getModelDisplayName(settings.model)}
        </Text>
        <Feather name="chevron-down" size={14} color={THEME.saffron} />
      </TouchableOpacity>

      <View style={styles.headerRight}>
        <TouchableOpacity onPress={handleClearChat} style={styles.iconBtn}>
          <Feather name="trash-2" size={18} color={THEME.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.iconBtn}>
          <Feather name="sliders" size={18} color={THEME.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderTabBar = () => (
    <View style={styles.tabBar}>
      <TouchableOpacity
        onPress={() => setActiveTab('chat')}
        style={[styles.tab, activeTab === 'chat' && styles.activeTab]}
      >
        <Feather name="message-circle" size={16} color={activeTab === 'chat' ? THEME.saffron : THEME.textMuted} />
        <Text style={[styles.tabText, activeTab === 'chat' && styles.activeTabText]}>Chat</Text>
        {activeTab === 'chat' && <View style={styles.tabIndicator} />}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setActiveTab('image')}
        style={[styles.tab, activeTab === 'image' && styles.activeTab]}
      >
        <Feather name="image" size={16} color={activeTab === 'image' ? THEME.green : THEME.textMuted} />
        <Text style={[styles.tabText, activeTab === 'image' && styles.activeTabTextGreen]}>Create</Text>
        {activeTab === 'image' && <View style={styles.tabIndicatorGreen} />}
      </TouchableOpacity>
    </View>
  );

  const renderWelcome = () => (
    <View style={styles.welcomeContainer}>
      <View style={styles.welcomeGlow} />
      <View style={styles.welcomeIcon}>
        <Feather name="zap" size={32} color={THEME.saffron} />
      </View>
      <Text style={styles.welcomeTitle}>What can I help you with?</Text>
      <Text style={styles.welcomeSubtitle}>Ask anything or try a suggestion below</Text>

      <View style={styles.suggestionsContainer}>
        {SUGGESTIONS.map((suggestion, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => handleSuggestionPress(suggestion)}
            style={[
              styles.suggestionChip,
              index % 2 === 0 ? styles.suggestionChipSaffron : styles.suggestionChipNavy
            ]}
          >
            <Text style={styles.suggestionText}>{suggestion}</Text>
            <Feather name="arrow-up-right" size={14} color={THEME.textSecondary} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderMessages = () => (
    <FlatList
      ref={flatListRef}
      data={messages}
      renderItem={({ item }) => (
        <View style={[styles.messageRow, item.role === 'assistant' && styles.assistantRow]}>
          <View style={[styles.avatar, item.role === 'user' ? styles.userAvatar : styles.assistantAvatar]}>
            <Feather
              name={item.role === 'user' ? 'user' : 'cpu'}
              size={14}
              color={item.role === 'user' ? THEME.navy : THEME.saffron}
            />
          </View>
          <View style={styles.messageContent}>
            <Text style={styles.roleLabel}>
              {item.role === 'user' ? 'You' : 'vGPT'}
            </Text>
            {formatMessageContent(item.content)}
            {item.metrics && item.role === 'assistant' && (
              <View style={styles.metricsRow}>
                <View style={styles.metricBadge}>
                  <Text style={styles.metricText}>
                    {item.metrics.tokensPerSecond?.toFixed(1)} tok/s
                  </Text>
                </View>
                <View style={styles.metricBadge}>
                  <Text style={styles.metricText}>
                    {item.metrics.totalTokens} tokens
                  </Text>
                </View>
                {item.metrics.cost && (
                  <View style={styles.metricBadge}>
                    <Text style={styles.metricText}>
                      ${item.metrics.cost.toFixed(4)}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      )}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      ListEmptyComponent={renderWelcome()}
    />
  );

  const renderComposer = () => (
    <View style={[styles.composerOuter, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.composerContainer}>
        <TextInput
          style={styles.input}
          placeholder="Message vGPT..."
          placeholderTextColor={THEME.textMuted}
          value={message}
          onChangeText={setMessage}
          multiline
          editable={!isLoading}
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={isLoading || !message.trim()}
          style={[styles.sendBtn, (isLoading || !message.trim()) && styles.sendBtnDisabled]}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={THEME.background} />
          ) : (
            <Feather name="arrow-up" size={18} color={THEME.background} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderImageTab = () => (
    <View style={styles.imageTabContainer}>
      <ScrollView contentContainerStyle={styles.imageScrollContent}>
        {generatedImages.length === 0 ? (
          <View style={styles.imageWelcome}>
            <View style={styles.imageWelcomeIcon}>
              <Feather name="image" size={32} color={THEME.green} />
            </View>
            <Text style={styles.welcomeTitle}>Create with AI</Text>
            <Text style={styles.welcomeSubtitle}>Generate stunning images from text</Text>
          </View>
        ) : (
          <View style={styles.imageGrid}>
            {generatedImages.map((img) => (
              <View key={img.id} style={styles.imageCard}>
                <Image
                  source={{ uri: img.imageData }}
                  style={[styles.genImage, { aspectRatio: (img.width || 1024) / (img.height || 1024) }]}
                  contentFit="cover"
                />
                <View style={styles.imageOverlay}>
                  <Text style={styles.imagePromptText} numberOfLines={2}>{img.prompt}</Text>
                  <TouchableOpacity onPress={() => downloadImage(img.imageData)} style={styles.downloadBtn}>
                    <Feather name="download" size={16} color={THEME.white} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {showImageSettings && (
        <View style={styles.settingsPanel}>
          <View style={styles.settingsPanelHeader}>
            <Text style={styles.settingsPanelTitle}>Generation Settings</Text>
            <TouchableOpacity onPress={() => setShowImageSettings(false)}>
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
            onValueChange={(v) => updateSettings({ imageSteps: v })}
            minimumTrackTintColor={THEME.green}
            maximumTrackTintColor={THEME.borderLight}
            thumbTintColor={THEME.green}
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
            onValueChange={(v) => updateSettings({ imageGuidanceScale: v })}
            minimumTrackTintColor={THEME.green}
            maximumTrackTintColor={THEME.borderLight}
            thumbTintColor={THEME.green}
          />

          <View style={styles.sizeSelector}>
            {[
              { label: 'Square', w: 1024, h: 1024 },
              { label: 'Portrait', w: 576, h: 1024 },
              { label: 'Landscape', w: 1024, h: 576 },
            ].map((size) => (
              <TouchableOpacity
                key={size.label}
                onPress={() => updateSettings({ imageWidth: size.w, imageHeight: size.h })}
                style={[
                  styles.sizeBtn,
                  settings.imageWidth === size.w && settings.imageHeight === size.h && styles.sizeBtnActive
                ]}
              >
                <Text style={[
                  styles.sizeBtnText,
                  settings.imageWidth === size.w && settings.imageHeight === size.h && styles.sizeBtnTextActive
                ]}>{size.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <View style={[styles.composerOuter, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.composerContainer}>
          <TouchableOpacity onPress={() => setShowImageSettings(!showImageSettings)} style={styles.settingsToggle}>
            <Feather name="sliders" size={18} color={showImageSettings ? THEME.green : THEME.textMuted} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Describe an image..."
            placeholderTextColor={THEME.textMuted}
            value={imagePrompt}
            onChangeText={setImagePrompt}
            multiline
            editable={!isGeneratingImage}
          />
          <TouchableOpacity
            onPress={handleGenerateImage}
            disabled={isGeneratingImage || !imagePrompt.trim()}
            style={[styles.sendBtnGreen, (isGeneratingImage || !imagePrompt.trim()) && styles.sendBtnDisabled]}
          >
            {isGeneratingImage ? (
              <ActivityIndicator size="small" color={THEME.background} />
            ) : (
              <Feather name="zap" size={18} color={THEME.background} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderModelPicker = () => (
    <Modal visible={showModelPicker} animationType="slide" presentationStyle="formSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Select Model</Text>
          <TouchableOpacity onPress={() => setShowModelPicker(false)} style={styles.modalClose}>
            <Feather name="x" size={24} color={THEME.textPrimary} />
          </TouchableOpacity>
        </View>
        <FlatList
          data={activeTab === 'chat' ? textModels : imageModels}
          renderItem={({ item }) => {
            const isSelected = (activeTab === 'chat' ? settings.model : settings.imageModel) === item.id;
            return (
              <TouchableOpacity
                onPress={() => activeTab === 'chat' ? handleChatModelSelect(item.id) : handleImageModelSelect(item.id)}
                style={[styles.modelItem, isSelected && styles.modelItemSelected]}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelName}>{item.model_spec.name || item.id}</Text>
                  <Text style={styles.modelId}>{item.id}</Text>
                </View>
                {isSelected && (
                  <View style={styles.checkMark}>
                    <Feather name="check" size={16} color={THEME.saffron} />
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.modalList}
        />
      </View>
    </Modal>
  );

  // ===== LOADING STATE =====
  if (isLoadingModels) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingSpinner}>
          <ActivityIndicator size="large" color={THEME.saffron} />
        </View>
        <Text style={styles.loadingText}>Initializing...</Text>
      </View>
    );
  }

  // ===== MAIN RENDER =====
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="light" />
      {renderHeader()}
      {renderTabBar()}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex1}
      >
        {activeTab === 'chat' ? (
          <View style={styles.flex1}>
            {renderMessages()}
            {renderComposer()}
            {showScrollToBottom && (
              <TouchableOpacity onPress={scrollToBottom} style={styles.scrollToBottom}>
                <Feather name="chevron-down" size={20} color={THEME.textPrimary} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          renderImageTab()
        )}
      </KeyboardAvoidingView>

      {renderModelPicker()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },

  container: {
    flex: 1,
    backgroundColor: THEME.background,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    backgroundColor: THEME.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingSpinner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: THEME.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  loadingText: {
    color: THEME.textSecondary,
    fontSize: 14,
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
    borderBottomColor: THEME.borderLight,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoMark: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  logoBar1: {
    width: 16,
    height: 3,
    backgroundColor: THEME.saffron,
    borderRadius: 1,
  },
  logoBar2: {
    width: 16,
    height: 3,
    backgroundColor: THEME.white,
    borderRadius: 1,
  },
  logoBar3: {
    width: 16,
    height: 3,
    backgroundColor: THEME.green,
    borderRadius: 1,
  },
  logoText: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.textPrimary,
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.border,
    maxWidth: 180,
    gap: 6,
  },
  modelSelectorText: {
    color: THEME.textPrimary,
    fontSize: 13,
    fontWeight: '500',
  },

  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
    position: 'relative',
  },
  activeTab: {
    backgroundColor: THEME.surface,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: THEME.textMuted,
  },
  activeTabText: {
    color: THEME.saffron,
  },
  activeTabTextGreen: {
    color: THEME.green,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 4,
    left: '50%',
    marginLeft: -8,
    width: 16,
    height: 2,
    backgroundColor: THEME.saffron,
    borderRadius: 1,
  },
  tabIndicatorGreen: {
    position: 'absolute',
    bottom: 4,
    left: '50%',
    marginLeft: -8,
    width: 16,
    height: 2,
    backgroundColor: THEME.green,
    borderRadius: 1,
  },

  // Welcome
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  welcomeGlow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: THEME.glowSaffron,
    opacity: 0.5,
  },
  welcomeIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: THEME.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: THEME.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: 15,
    color: THEME.textSecondary,
    marginBottom: 32,
    textAlign: 'center',
  },
  suggestionsContainer: {
    width: '100%',
    maxWidth: 400,
    gap: 10,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  suggestionChipSaffron: {
    backgroundColor: THEME.glowSaffron,
    borderColor: THEME.border,
  },
  suggestionChipNavy: {
    backgroundColor: THEME.glowNavy,
    borderColor: 'rgba(0, 0, 128, 0.3)',
  },
  suggestionText: {
    fontSize: 14,
    color: THEME.textPrimary,
    flex: 1,
  },

  // Messages
  listContent: {
    paddingBottom: 120,
  },
  messageRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  assistantRow: {
    backgroundColor: THEME.surface,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatar: {
    backgroundColor: THEME.white,
  },
  assistantAvatar: {
    backgroundColor: THEME.surfaceLight,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  messageContent: {
    flex: 1,
  },
  roleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 24,
    color: THEME.textPrimary,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  metricBadge: {
    backgroundColor: THEME.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  metricText: {
    fontSize: 11,
    color: THEME.textMuted,
    fontWeight: '500',
  },

  // Code Block
  codeBlock: {
    backgroundColor: '#0d0d12',
    borderRadius: 8,
    marginVertical: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: THEME.borderLight,
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: THEME.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.borderLight,
  },
  codeHeaderText: {
    fontSize: 10,
    fontWeight: '600',
    color: THEME.textMuted,
    letterSpacing: 1,
  },
  codeHeaderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: THEME.green,
  },
  codeText: {
    color: THEME.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    padding: 16,
  },

  // Composer
  composerOuter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: THEME.background,
  },
  composerContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: THEME.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: THEME.borderLight,
    gap: 8,
  },
  input: {
    flex: 1,
    color: THEME.textPrimary,
    fontSize: 15,
    maxHeight: 120,
    paddingVertical: 8,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: THEME.saffron,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnGreen: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: THEME.green,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.3,
  },
  settingsToggle: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Scroll to bottom
  scrollToBottom: {
    position: 'absolute',
    bottom: 100,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.borderLight,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Image Tab
  imageTabContainer: {
    flex: 1,
  },
  imageScrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  imageWelcome: {
    alignItems: 'center',
    paddingTop: 60,
  },
  imageWelcomeIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: THEME.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(19, 136, 8, 0.3)',
  },
  imageGrid: {
    gap: 16,
  },
  imageCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.borderLight,
  },
  genImage: {
    width: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  imagePromptText: {
    flex: 1,
    color: THEME.textPrimary,
    fontSize: 13,
    marginRight: 12,
  },
  downloadBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Settings Panel
  settingsPanel: {
    backgroundColor: THEME.surface,
    margin: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.borderLight,
  },
  settingsPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  settingsPanelTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.textPrimary,
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
    color: THEME.green,
    fontWeight: '600',
  },
  sizeSelector: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  sizeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: THEME.surfaceLight,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sizeBtnActive: {
    borderColor: THEME.green,
    backgroundColor: THEME.glowGreen,
  },
  sizeBtnText: {
    fontSize: 12,
    color: THEME.textSecondary,
    fontWeight: '500',
  },
  sizeBtnTextActive: {
    color: THEME.green,
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: THEME.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: THEME.borderLight,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 8,
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
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modelItemSelected: {
    borderColor: THEME.saffron,
    backgroundColor: THEME.glowSaffron,
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    fontSize: 15,
    fontWeight: '500',
    color: THEME.textPrimary,
    marginBottom: 4,
  },
  modelId: {
    fontSize: 12,
    color: THEME.textMuted,
  },
  checkMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: THEME.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

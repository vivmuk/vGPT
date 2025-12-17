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
  Linking,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  LayoutAnimation,
  UIManager,
  Share,
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
import { swissTheme } from '@/constants/swissTheme';
import SwissText from '@/components/swiss/SwissText';
import SwissCard from '@/components/swiss/SwissCard';
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
  "Write a cyberpunk haiku",
  "Debug this React code",
  "Plan a trip to Venice",
];

export default function FullAppScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

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
    }, 1000);
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
    const filtered = models.filter((model: VeniceModel) => isImageModel(model));
    if (filtered.length === 0 && models.length > 0) {
      console.log('No image models found.');
    }
    return filtered;
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
                  tokenCountRef.current = finalUsage.total_tokens || finalUsage.completion_tokens || tokenCountRef.current;
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
      if (!base64String || typeof base64String !== 'string') {
        throw new Error('Image data is not a valid base64 string.');
      }

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
            <SwissText variant="xs" color="white" style={styles.codeText}>
              {codeContent}
            </SwissText>
          </View>
        );
      }
      return (
        <SwissText key={index} variant="body" color="primary">
          {part}
        </SwissText>
      );
    });
  };

  // ===== RENDER FUNCTIONS =====

  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <SwissText variant="h3" weight="semibold" color="primary">
        vGPT
      </SwissText>
      <TouchableOpacity
        onPress={() => setShowModelPicker(true)}
        style={styles.modelSelector}
      >
        <SwissText variant="small" color="secondary" numberOfLines={1}>
          {getModelDisplayName(settings.model)}
        </SwissText>
        <Feather name="chevron-down" size={16} color={swissTheme.colors.text.secondary} />
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', gap: swissTheme.spacing[2] }}>
        <TouchableOpacity onPress={handleClearChat} style={styles.iconButton}>
          <Feather name="trash-2" size={20} color={swissTheme.colors.text.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.iconButton}>
          <Feather name="settings" size={20} color={swissTheme.colors.text.primary} />
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
        <SwissText
          variant="small"
          weight="medium"
          color={activeTab === 'chat' ? 'accent' : 'secondary'}
        >
          Chat
        </SwissText>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setActiveTab('image')}
        style={[styles.tab, activeTab === 'image' && styles.activeTab]}
      >
        <SwissText
          variant="small"
          weight="medium"
          color={activeTab === 'image' ? 'accent' : 'secondary'}
        >
          Create
        </SwissText>
      </TouchableOpacity>
    </View>
  );

  const renderChatWelcome = () => (
    <ScrollView
      contentContainerStyle={styles.welcomeScroll}
      scrollEnabled={true}
    >
      <View style={styles.welcomeContainer}>
        <View style={styles.welcomeHero}>
          <SwissText variant="h1" weight="semibold" color="primary">
            Chat
          </SwissText>
          <SwissText variant="body" color="secondary">
            Start a conversation
          </SwissText>
        </View>
        <View style={styles.suggestionsGrid}>
          {SUGGESTIONS.map((suggestion, index) => (
            <TouchableOpacity
              key={index}
              onPress={() => handleSuggestionPress(suggestion)}
              style={styles.suggestionChip}
            >
              <SwissText variant="small" color="secondary">
                {suggestion}
              </SwissText>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );

  const renderMessages = () => (
    <FlatList
      ref={flatListRef}
      data={messages}
      renderItem={({ item }) => (
        <View style={[styles.messageRow, item.role === 'user' ? styles.userMessageRow : styles.assistantMessageRow]}>
          <SwissCard
            variant={item.role === 'user' ? 'elevated' : 'default'}
            padding={4}
            style={[
              styles.messageBubble,
              item.role === 'user' ? styles.userMessageBubble : styles.assistantMessageBubble,
            ]}
          >
            {formatMessageContent(item.content)}
            {item.metrics && item.role === 'assistant' && (
              <View style={styles.metricsContainer}>
                <SwissText variant="xs" color="tertiary">
                  {item.metrics.inputTokens || 0} in •{' '}
                  {item.metrics.outputTokens || 0} out •{' '}
                  {item.metrics.tokensPerSecond?.toFixed(1) || '0'} tok/s •{' '}
                  {item.metrics.responseTime?.toFixed(1) || '0'}s
                  {item.metrics.cost ? ` • $${item.metrics.cost.toFixed(4)}` : ''}
                </SwissText>
              </View>
            )}
          </SwissCard>
        </View>
      )}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContentContainer}
      scrollEnabled={true}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      ListEmptyComponent={renderChatWelcome()}
    />
  );

  const renderComposer = () => (
    <View style={[styles.composerContainer, { paddingBottom: insets.bottom + swissTheme.spacing[4] }]}>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor={swissTheme.colors.text.tertiary}
          value={message}
          onChangeText={setMessage}
          multiline
          editable={!isLoading}
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={isLoading || !message.trim()}
          style={[styles.sendButton, isLoading && { opacity: 0.5 }]}
        >
          <Feather
            name="send"
            size={20}
            color={swissTheme.colors.white}
          />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderImageWelcome = () => (
    <ScrollView contentContainerStyle={styles.welcomeScroll}>
      <View style={styles.welcomeContainer}>
        <View style={styles.welcomeHero}>
          <SwissText variant="h1" weight="semibold" color="primary">
            Create
          </SwissText>
          <SwissText variant="body" color="secondary">
            Generate images from text
          </SwissText>
        </View>
      </View>
    </ScrollView>
  );

  const renderImageGallery = () => (
    <ScrollView style={styles.imageContainer} contentContainerStyle={styles.imageContent}>
      {generatedImages.map((img) => (
        <View key={img.id} style={styles.generatedCard}>
          <Image
            source={{ uri: img.imageData }}
            style={[styles.generatedImage, { aspectRatio: (img.width || 1024) / (img.height || 1024) }]}
            contentFit="cover"
          />
          <View style={styles.cardOverlay}>
            <View style={{ flex: 1 }}>
              <SwissText variant="small" weight="medium" color="inverted" numberOfLines={2}>
                {img.prompt}
              </SwissText>
              <SwissText variant="xs" color="tertiary" style={{ marginTop: swissTheme.spacing[1] }}>
                {getModelDisplayName(img.modelId)}
              </SwissText>
            </View>
            <TouchableOpacity
              onPress={() => downloadImage(img.imageData)}
              style={styles.downloadButton}
            >
              <Feather name="download" size={18} color={swissTheme.colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );

  const renderImageTab = () => (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
      keyboardVerticalOffset={0}
    >
      <View style={{ flex: 1 }}>
        {generatedImages.length === 0 ? renderImageWelcome() : renderImageGallery()}

        {showImageSettings && (
          <SwissCard padding={4} style={styles.imageSettingsPanel}>
            {/* Size selection */}
            <View style={styles.settingGroup}>
              <SwissText variant="label" color="primary" style={{ marginBottom: swissTheme.spacing[2] }}>
                Size
              </SwissText>
              <View style={{ flexDirection: 'row', gap: swissTheme.spacing[2] }}>
                {[
                  { label: 'Square', width: 1024, height: 1024 },
                  { label: 'Portrait', width: 576, height: 1024 },
                  { label: 'Landscape', width: 1024, height: 576 },
                ].map((size) => (
                  <TouchableOpacity
                    key={size.label}
                    onPress={() => updateSettings({ imageWidth: size.width, imageHeight: size.height })}
                    style={[
                      styles.sizeChip,
                      settings.imageWidth === size.width && settings.imageHeight === size.height && styles.activeSizeChip,
                    ]}
                  >
                    <SwissText
                      variant="xs"
                      color={settings.imageWidth === size.width && settings.imageHeight === size.height ? 'inverted' : 'primary'}
                    >
                      {size.label}
                    </SwissText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Steps slider */}
            <View style={{ marginTop: swissTheme.spacing[4] }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: swissTheme.spacing[2] }}>
                <SwissText variant="label" color="primary">
                  Steps
                </SwissText>
                <SwissText variant="label" weight="semibold" color="accent">
                  {settings.imageSteps || 8}
                </SwissText>
              </View>
              <Slider
                style={{ height: 40 }}
                minimumValue={1}
                maximumValue={8}
                step={1}
                value={settings.imageSteps || 8}
                onValueChange={(value) => updateSettings({ imageSteps: value })}
                minimumTrackTintColor={swissTheme.colors.accent.primary}
                maximumTrackTintColor={swissTheme.colors.gray[300]}
                thumbTintColor={swissTheme.colors.accent.primary}
              />
            </View>

            {/* CFG Scale slider */}
            <View style={{ marginTop: swissTheme.spacing[4] }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: swissTheme.spacing[2] }}>
                <SwissText variant="label" color="primary">
                  Guidance
                </SwissText>
                <SwissText variant="label" weight="semibold" color="accent">
                  {(settings.imageGuidanceScale || 7.5).toFixed(1)}
                </SwissText>
              </View>
              <Slider
                style={{ height: 40 }}
                minimumValue={1}
                maximumValue={20}
                step={0.5}
                value={settings.imageGuidanceScale || 7.5}
                onValueChange={(value) => updateSettings({ imageGuidanceScale: value })}
                minimumTrackTintColor={swissTheme.colors.accent.primary}
                maximumTrackTintColor={swissTheme.colors.gray[300]}
                thumbTintColor={swissTheme.colors.accent.primary}
              />
            </View>
          </SwissCard>
        )}

        {imageError && (
          <View style={styles.errorBanner}>
            <SwissText variant="small" color="error">
              {imageError}
            </SwissText>
          </View>
        )}

        <View style={[styles.composerContainer, { paddingBottom: insets.bottom + swissTheme.spacing[4] }]}>
          <View style={styles.composer}>
            <TouchableOpacity
              onPress={() => setShowImageSettings(!showImageSettings)}
              style={{ marginLeft: swissTheme.spacing[2] }}
            >
              <Feather name="sliders" size={20} color={swissTheme.colors.text.primary} />
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder="Describe an image..."
              placeholderTextColor={swissTheme.colors.text.tertiary}
              value={imagePrompt}
              onChangeText={setImagePrompt}
              multiline
              editable={!isGeneratingImage}
            />
            <TouchableOpacity
              onPress={handleGenerateImage}
              disabled={isGeneratingImage || !imagePrompt.trim()}
              style={[styles.sendButton, isGeneratingImage && { opacity: 0.5 }]}
            >
              {isGeneratingImage ? (
                <ActivityIndicator size="small" color={swissTheme.colors.white} />
              ) : (
                <Feather name="zap" size={20} color={swissTheme.colors.white} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );

  const renderModelPickerModal = () => (
    <Modal
      visible={showModelPicker}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={() => setShowModelPicker(false)}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: swissTheme.colors.background }}>
        <View style={styles.modalHeader}>
          <SwissText variant="h3" weight="semibold" color="primary">
            {activeTab === 'chat' ? 'Select Model' : 'Select Image Model'}
          </SwissText>
          <TouchableOpacity onPress={() => setShowModelPicker(false)}>
            <Feather name="x" size={24} color={swissTheme.colors.text.primary} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={activeTab === 'chat' ? textModels : imageModels}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() =>
                activeTab === 'chat'
                  ? handleChatModelSelect(item.id)
                  : handleImageModelSelect(item.id)
              }
              style={[
                styles.modelCard,
                (activeTab === 'chat' ? settings.model : settings.imageModel) === item.id &&
                  styles.selectedModelCard,
              ]}
            >
              <View style={{ flex: 1 }}>
                <SwissText variant="body" weight="semibold" color="primary">
                  {item.model_spec.name || item.id}
                </SwissText>
                <SwissText variant="xs" color="secondary" style={{ marginTop: swissTheme.spacing[1] }}>
                  {item.id}
                </SwissText>
                {item.model_spec.capabilities && (
                  <View style={{ flexDirection: 'row', gap: swissTheme.spacing[2], marginTop: swissTheme.spacing[2] }}>
                    {item.model_spec.capabilities.supportsWebSearch && (
                      <View style={styles.capabilityBadge}>
                        <SwissText variant="xs" color="secondary">
                          Web Search
                        </SwissText>
                      </View>
                    )}
                    {item.model_spec.capabilities.supportsReasoning && (
                      <View style={styles.capabilityBadge}>
                        <SwissText variant="xs" color="secondary">
                          Reasoning
                        </SwissText>
                      </View>
                    )}
                  </View>
                )}
              </View>
              {(activeTab === 'chat' ? settings.model : settings.imageModel) === item.id && (
                <Feather name="check" size={24} color={swissTheme.colors.accent.primary} />
              )}
            </TouchableOpacity>
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: swissTheme.spacing[4], gap: swissTheme.spacing[3] }}
          scrollEnabled={true}
        />
      </SafeAreaView>
    </Modal>
  );

  const renderScrollToBottomButton = () => (
    showScrollToBottom && (
      <TouchableOpacity onPress={scrollToBottom} style={styles.scrollToBottomButton}>
        <Feather name="arrow-down" size={20} color={swissTheme.colors.text.primary} />
      </TouchableOpacity>
    )
  );

  // ===== MAIN RENDER =====

  if (isLoadingModels) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={swissTheme.colors.accent.primary} />
        <SwissText variant="body" color="secondary" style={{ marginTop: swissTheme.spacing[4] }}>
          Loading models...
        </SwissText>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark" backgroundColor={swissTheme.colors.background} />
      {renderHeader()}
      {renderTabBar()}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        {activeTab === 'chat' ? (
          <View style={styles.chatContainer}>
            {renderMessages()}
            {renderScrollToBottomButton()}
            {renderComposer()}
          </View>
        ) : (
          renderImageTab()
        )}
      </KeyboardAvoidingView>

      {renderModelPickerModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: swissTheme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: swissTheme.spacing[4],
    paddingVertical: swissTheme.spacing[3],
    borderBottomWidth: swissTheme.borders.width.thin,
    borderBottomColor: swissTheme.colors.border,
    height: 56,
  },
  modelSelector: {
    flex: 1,
    marginHorizontal: swissTheme.spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: swissTheme.spacing[2],
  },
  iconButton: {
    padding: swissTheme.spacing[2],
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: swissTheme.borders.width.thin,
    borderBottomColor: swissTheme.colors.border,
    paddingHorizontal: swissTheme.spacing[4],
  },
  tab: {
    paddingVertical: swissTheme.spacing[3],
    paddingHorizontal: swissTheme.spacing[3],
    marginRight: swissTheme.spacing[2],
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: swissTheme.colors.accent.primary,
  },
  chatContainer: {
    flex: 1,
  },
  welcomeScroll: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: swissTheme.spacing[4],
    gap: swissTheme.spacing[6],
  },
  welcomeHero: {
    alignItems: 'center',
    gap: swissTheme.spacing[2],
  },
  suggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: swissTheme.spacing[2],
    maxWidth: 600,
  },
  suggestionChip: {
    backgroundColor: swissTheme.colors.white,
    paddingVertical: swissTheme.spacing[2],
    paddingHorizontal: swissTheme.spacing[3],
    borderRadius: swissTheme.borders.radius.md,
    borderWidth: swissTheme.borders.width.thin,
    borderColor: swissTheme.colors.border,
  },
  listContentContainer: {
    paddingHorizontal: swissTheme.spacing[4],
    paddingVertical: swissTheme.spacing[3],
    gap: swissTheme.spacing[2],
  },
  messageRow: {
    flexDirection: 'row',
    width: '100%',
  },
  userMessageRow: {
    justifyContent: 'flex-end',
  },
  assistantMessageRow: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '100%',
    borderRadius: swissTheme.borders.radius.md,
  },
  userMessageBubble: {
    backgroundColor: swissTheme.colors.white,
    borderColor: swissTheme.colors.gray[300],
  },
  assistantMessageBubble: {
    backgroundColor: swissTheme.colors.surface,
    borderColor: swissTheme.colors.gray[200],
  },
  metricsContainer: {
    marginTop: swissTheme.spacing[2],
    opacity: 0.7,
  },
  codeBlock: {
    backgroundColor: swissTheme.colors.gray[900],
    borderRadius: swissTheme.borders.radius.md,
    padding: swissTheme.spacing[3],
    marginVertical: swissTheme.spacing[2],
    borderWidth: swissTheme.borders.width.thin,
    borderColor: swissTheme.colors.gray[800],
  },
  codeText: {
    fontFamily: swissTheme.typography.fontFamily.mono,
    fontSize: swissTheme.typography.fontSize.xs,
    color: swissTheme.colors.gray[100],
  },
  composerContainer: {
    backgroundColor: swissTheme.colors.background,
    borderTopWidth: swissTheme.borders.width.thin,
    borderTopColor: swissTheme.colors.border,
    paddingHorizontal: swissTheme.spacing[4],
    paddingTop: swissTheme.spacing[3],
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: swissTheme.colors.white,
    borderRadius: swissTheme.borders.radius.md,
    borderWidth: swissTheme.borders.width.thin,
    borderColor: swissTheme.colors.gray[300],
    paddingHorizontal: swissTheme.spacing[3],
    minHeight: 44,
  },
  input: {
    flex: 1,
    color: swissTheme.colors.text.primary,
    fontSize: swissTheme.typography.fontSize.base,
    fontFamily: swissTheme.typography.fontFamily.primary,
    paddingVertical: swissTheme.spacing[3],
    paddingHorizontal: swissTheme.spacing[2],
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: swissTheme.colors.accent.primary,
    justifyContent: 'center',
    alignItems: 'center',
    margin: swissTheme.spacing[1],
  },
  imageContainer: {
    flex: 1,
  },
  imageContent: {
    paddingHorizontal: swissTheme.spacing[4],
    paddingVertical: swissTheme.spacing[4],
    gap: swissTheme.spacing[4],
  },
  imageSettingsPanel: {
    marginHorizontal: swissTheme.spacing[4],
    marginBottom: swissTheme.spacing[4],
  },
  settingGroup: {
    gap: swissTheme.spacing[2],
  },
  sizeChip: {
    paddingVertical: swissTheme.spacing[2],
    paddingHorizontal: swissTheme.spacing[3],
    borderRadius: swissTheme.borders.radius.md,
    backgroundColor: swissTheme.colors.white,
    borderWidth: swissTheme.borders.width.thin,
    borderColor: swissTheme.colors.border,
  },
  activeSizeChip: {
    backgroundColor: swissTheme.colors.accent.primary,
    borderColor: swissTheme.colors.accent.primary,
  },
  generatedCard: {
    borderRadius: swissTheme.borders.radius.md,
    overflow: 'hidden',
    backgroundColor: swissTheme.colors.surface,
    borderWidth: swissTheme.borders.width.thin,
    borderColor: swissTheme.colors.border,
    minHeight: 300,
  },
  generatedImage: {
    width: '100%',
    backgroundColor: swissTheme.colors.gray[900],
  },
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: swissTheme.spacing[3],
    paddingVertical: swissTheme.spacing[3],
    backgroundColor: 'rgba(0,0,0,0.6)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  downloadButton: {
    padding: swissTheme.spacing[2],
  },
  errorBanner: {
    backgroundColor: swissTheme.colors.error,
    opacity: 0.1,
    borderWidth: swissTheme.borders.width.thin,
    borderColor: swissTheme.colors.error,
    padding: swissTheme.spacing[3],
    borderRadius: swissTheme.borders.radius.md,
    marginHorizontal: swissTheme.spacing[4],
    marginTop: swissTheme.spacing[3],
  },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: 120,
    right: swissTheme.spacing[4],
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: swissTheme.colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: swissTheme.borders.width.thin,
    borderColor: swissTheme.colors.border,
    ...swissTheme.shadows.subtle,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: swissTheme.colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: swissTheme.spacing[4],
    paddingVertical: swissTheme.spacing[3],
    borderBottomWidth: swissTheme.borders.width.thin,
    borderBottomColor: swissTheme.colors.border,
  },
  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: swissTheme.spacing[3],
    backgroundColor: swissTheme.colors.white,
    borderWidth: swissTheme.borders.width.thin,
    borderColor: swissTheme.colors.border,
    borderRadius: swissTheme.borders.radius.md,
  },
  selectedModelCard: {
    borderColor: swissTheme.colors.accent.primary,
    borderWidth: swissTheme.borders.width.medium,
  },
  capabilityBadge: {
    backgroundColor: swissTheme.colors.gray[100],
    paddingVertical: swissTheme.spacing[1],
    paddingHorizontal: swissTheme.spacing[2],
    borderRadius: swissTheme.borders.radius.sm,
  },
});

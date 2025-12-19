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

const COLORS = {
  background: '#212121', // ChatGPT dark background
  sidebar: '#171717',
  textPrimary: '#ececec',
  textSecondary: '#b4b4b4',
  border: '#3c3c3c',
  accent: '#10a37f', // ChatGPT green
  userBubble: '#2f2f2f',
  assistantBubble: 'transparent',
  surface: '#2f2f2f',
  error: '#ef4444',
  warning: '#f59e0b',
  success: '#10b981',
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
  "Write a cyberpunk haiku",
  "Debug this React code",
  "Plan a trip to Venice",
];

export default function FullAppScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

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
    }, 5000); // Polling settings less frequently
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
              <Text style={styles.codeHeaderText}>Code</Text>
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

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => setShowModelPicker(true)} style={styles.modelSelector}>
        <Text style={styles.modelSelectorText} numberOfLines={1}>
          {getModelDisplayName(settings.model)}
        </Text>
        <Feather name="chevron-down" size={14} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <View style={styles.headerActions}>
        <TouchableOpacity onPress={handleClearChat} style={styles.iconButton}>
          <Feather name="trash-2" size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.iconButton}>
          <Feather name="settings" size={20} color={COLORS.textPrimary} />
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
        <Text style={[styles.tabText, activeTab === 'chat' && styles.activeTabText]}>Chat</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setActiveTab('image')}
        style={[styles.tab, activeTab === 'image' && styles.activeTab]}
      >
        <Text style={[styles.tabText, activeTab === 'image' && styles.activeTabText]}>Create</Text>
      </TouchableOpacity>
    </View>
  );

  const renderChatWelcome = () => (
    <View style={styles.welcomeContainer}>
      <View style={styles.logoContainer}>
        <Feather name="command" size={48} color={COLORS.textPrimary} />
      </View>
      <Text style={styles.welcomeTitle}>How can I help you today?</Text>
      <View style={styles.suggestionsGrid}>
        {SUGGESTIONS.map((suggestion, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => handleSuggestionPress(suggestion)}
            style={styles.suggestionChip}
          >
            <Text style={styles.suggestionText}>{suggestion}</Text>
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
        <View style={[styles.messageRow, item.role === 'user' ? styles.userRow : styles.assistantRow]}>
          <View style={item.role === 'user' ? styles.userAvatar : styles.assistantAvatar}>
            <Feather name={item.role === 'user' ? 'user' : 'cpu'} size={14} color="#fff" />
          </View>
          <View style={styles.messageContent}>
            <Text style={styles.roleLabel}>{item.role === 'user' ? 'You' : 'vGPT'}</Text>
            <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
              {formatMessageContent(item.content)}
            </View>
            {item.metrics && item.role === 'assistant' && (
              <Text style={styles.metricsText}>
                {item.metrics.tokensPerSecond?.toFixed(1)} tok/s • {item.metrics.cost ? `$${item.metrics.cost.toFixed(4)}` : `${item.metrics.totalTokens} tokens`}
              </Text>
            )}
          </View>
        </View>
      )}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      ListEmptyComponent={renderChatWelcome()}
    />
  );

  const renderComposer = () => (
    <View style={[styles.composerContainer, { paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.composerInner}>
        <TextInput
          style={styles.input}
          placeholder="Message vGPT..."
          placeholderTextColor={COLORS.textSecondary}
          value={message}
          onChangeText={setMessage}
          multiline
          editable={!isLoading}
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={isLoading || !message.trim()}
          style={[styles.sendButton, (isLoading || !message.trim()) && { opacity: 0.3 }]}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="arrow-up" size={20} color="#fff" />
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
            <Text style={styles.welcomeTitle}>Create images</Text>
            <Text style={styles.welcomeSubtitle}>Generate stunning visuals with AI</Text>
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
                <TouchableOpacity onPress={() => downloadImage(img.imageData)} style={styles.imgDownloadBtn}>
                  <Feather name="download" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {showImageSettings && (
        <View style={styles.imageSettingsPanel}>
          <Text style={styles.settingsPanelTitle}>Generation Settings</Text>
          {/* Reuse slider logic here or simple buttons for size */}
          <Text style={styles.settingLabel}>Steps: {settings.imageSteps}</Text>
          <Slider
            value={settings.imageSteps}
            minimumValue={1}
            maximumValue={8}
            step={1}
            onValueChange={(v) => updateSettings({ imageSteps: v })}
            minimumTrackTintColor={COLORS.accent}
          />
        </View>
      )}

      <View style={[styles.composerContainer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.composerInner}>
          <TouchableOpacity onPress={() => setShowImageSettings(!showImageSettings)} style={styles.settingsToggle}>
            <Feather name="sliders" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Describe an image..."
            placeholderTextColor={COLORS.textSecondary}
            value={imagePrompt}
            onChangeText={setImagePrompt}
            multiline
            editable={!isGeneratingImage}
          />
          <TouchableOpacity
            onPress={handleGenerateImage}
            disabled={isGeneratingImage || !imagePrompt.trim()}
            style={[styles.sendButton, { backgroundColor: COLORS.accent }, (isGeneratingImage || !imagePrompt.trim()) && { opacity: 0.3 }]}
          >
            {isGeneratingImage ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="zap" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (isLoadingModels) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="light" />
      {renderHeader()}
      {renderTabBar()}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {activeTab === 'chat' ? (
          <View style={{ flex: 1 }}>
            {renderMessages()}
            {renderComposer()}
            {showScrollToBottom && (
              <TouchableOpacity onPress={scrollToBottom} style={styles.scrollBtn}>
                <Feather name="arrow-down" size={20} color={COLORS.textPrimary} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          renderImageTab()
        )}
      </KeyboardAvoidingView>

      <Modal visible={showModelPicker} animationType="slide" presentationStyle="formSheet">
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Model</Text>
            <TouchableOpacity onPress={() => setShowModelPicker(false)}>
              <Feather name="x" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={activeTab === 'chat' ? textModels : imageModels}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => activeTab === 'chat' ? handleChatModelSelect(item.id) : handleImageModelSelect(item.id)}
                style={[styles.modelItem, (activeTab === 'chat' ? settings.model : settings.imageModel) === item.id && styles.selectedModel]}
              >
                <Text style={styles.modelName}>{item.model_spec.name || item.id}</Text>
                <Text style={styles.modelIdText}>{item.id}</Text>
              </TouchableOpacity>
            )}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.modalList}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    maxWidth: '60%',
  },
  modelSelectorText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginRight: 6,
  },
  headerActions: {
    flexDirection: 'row',
  },
  iconButton: {
    padding: 8,
    marginLeft: 8,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.textPrimary,
  },
  tabText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  activeTabText: {
    color: COLORS.textPrimary,
  },
  listContent: {
    paddingBottom: 100,
  },
  messageRow: {
    flexDirection: 'row',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  userRow: {
    backgroundColor: 'transparent',
  },
  assistantRow: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  userAvatar: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  assistantAvatar: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  messageContent: {
    flex: 1,
    marginLeft: 16,
  },
  roleLabel: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  messageText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    lineHeight: 24,
  },
  bubble: {
    marginTop: 4,
  },
  metricsText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 12,
  },
  codeBlock: {
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    marginVertical: 12,
    overflow: 'hidden',
  },
  codeHeader: {
    backgroundColor: '#2d2d2d',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  codeHeaderText: {
    color: '#b4b4b4',
    fontSize: 12,
    fontWeight: '500',
  },
  codeText: {
    color: '#fff',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    padding: 16,
    fontSize: 13,
  },
  composerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  composerInner: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  input: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 16,
    maxHeight: 200,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    marginBottom: 4,
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  welcomeTitle: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 32,
  },
  suggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  suggestionChip: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  suggestionText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  scrollBtn: {
    position: 'absolute',
    bottom: 120,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageTabContainer: {
    flex: 1,
  },
  imageScrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  imageWelcome: {
    alignItems: 'center',
    marginTop: 60,
  },
  welcomeSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 16,
  },
  imageGrid: {
    gap: 16,
  },
  imageCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  genImage: {
    width: '100%',
  },
  imgDownloadBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageSettingsPanel: {
    backgroundColor: COLORS.surface,
    margin: 16,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  settingsPanelTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  settingLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginBottom: 8,
  },
  settingsToggle: {
    padding: 8,
    marginRight: 4,
    marginBottom: 4,
  },
  modalContent: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  modalList: {
    padding: 16,
  },
  modelItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  selectedModel: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  modelIdText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
});

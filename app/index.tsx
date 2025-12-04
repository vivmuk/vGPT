import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
  ActivityIndicator,
  useWindowDimensions,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import Slider from '@react-native-community/slider';
import { BlurView } from 'expo-blur';
import { DEFAULT_SETTINGS } from '@/constants/settings';
import { AppSettings } from '@/types/settings';
import { VeniceModel } from '@/types/venice';
import { loadStoredSettings, persistSettings } from '@/utils/settingsStorage';
import { theme } from '@/constants/theme';
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

const palette = theme.colors;
const space = theme.spacing;
const radii = theme.radius;
const fonts = theme.fonts;

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
      // Validate and clamp imageGuidanceScale to valid range (1-20)
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

      const requestBody: Record<string, any> = {
        model: settings.model,
        messages: conversationHistory,
        stream: true,
        venice_parameters: {
          strip_thinking_response: settings.stripThinking,
          disable_thinking: settings.disableThinking,
          enable_web_search: settings.webSearch,
          enable_web_citations: settings.webCitations,
          include_venice_system_prompt: settings.includeVeniceSystemPrompt,
        },
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
            <Text style={styles.codeText}>{codeContent}</Text>
          </View>
        );
      }
      
      const text = part
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .replace(/#{1,6}\s+(.*?)$/gm, '$1')
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
        .trim();
      
      if (!text) return null;
      return <Text key={index} style={styles.messageText}>{text}</Text>;
    });
  };

  const renderMessageItem = ({ item }: { item: Message }) => {
    return (
      <View style={[styles.messageRow, item.role === 'user' ? styles.userMessageRow : styles.assistantMessageRow]}>
        <View style={[styles.messageBubble, item.role === 'user' ? styles.userMessageBubble : styles.assistantMessageBubble]}>
          <View>
             {formatMessageContent(item.content)}
          </View>
          
          {item.role === 'assistant' && item.metrics && (
            <View style={styles.metricsContainer}>
              {item.metrics.inputTokens !== undefined && (
                <Text style={styles.metricText}>📥 {item.metrics.inputTokens}</Text>
              )}
              {item.metrics.outputTokens !== undefined && (
                <Text style={styles.metricText}>📤 {item.metrics.outputTokens}</Text>
              )}
              {item.metrics.tokensPerSecond !== undefined && (
                <Text style={styles.metricText}>⚡ {item.metrics.tokensPerSecond}/s</Text>
              )}
              {item.metrics.responseTime !== undefined && (
                <Text style={styles.metricText}>⏱️ {item.metrics.responseTime}s</Text>
              )}
              {item.metrics.cost !== undefined && item.metrics.cost > 0 && (
                <Text style={styles.metricText}>💰 ${item.metrics.cost.toFixed(4)}</Text>
              )}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      {/* Glass Header */}
      <BlurView intensity={80} tint="dark" style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.headerContent}>
          <View style={styles.logo}>
            <Text style={styles.logoIcon}>✨</Text>
            <Text style={styles.logoText}>vGPT</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity 
              style={styles.modelSelector} 
              onPress={() => setShowModelPicker(true)}
            >
              <Text style={styles.modelText} numberOfLines={1}>
                {activeTab === 'chat' 
                  ? getModelDisplayName(settings.model)
                  : getModelDisplayName(settings.imageModel)}
              </Text>
              <Ionicons name="chevron-down" size={14} color={palette.neon.cyan} />
            </TouchableOpacity>
            
            {activeTab === 'chat' && messages.length > 0 && (
              <TouchableOpacity style={styles.iconButton} onPress={handleClearChat}>
                <Ionicons name="trash-outline" size={20} color={palette.danger} />
              </TouchableOpacity>
            )}
            
            <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/settings')}>
              <Ionicons name="settings-outline" size={20} color={palette.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
        
        <View style={styles.tabSwitcher}>
          <TouchableOpacity style={[styles.tab, activeTab === 'chat' && styles.activeTab]} onPress={() => setActiveTab('chat')}>
            <Text style={[styles.tabText, activeTab === 'chat' && styles.activeTabText]}>Chat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'image' && styles.activeTab]} onPress={() => setActiveTab('image')}>
            <Text style={[styles.tabText, activeTab === 'image' && styles.activeTabText]}>Create</Text>
          </TouchableOpacity>
        </View>
      </BlurView>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={{ flex: 1 }}>
          {activeTab === 'chat' && (
            <View style={styles.chatContainer}>
              {messages.length === 0 ? (
                <ScrollView contentContainerStyle={styles.welcomeScroll}>
                  <View style={styles.welcomeContainer}>
                    <View style={styles.welcomeHero}>
                      <Text style={styles.welcomeIcon}>💬</Text>
                      <Text style={styles.welcomeTitle}>How can I help?</Text>
                    </View>
                    <View style={styles.suggestionsGrid}>
                      {SUGGESTIONS.map((suggestion, index) => (
                        <TouchableOpacity 
                          key={index} 
                          style={styles.suggestionChip}
                          onPress={() => handleSuggestionPress(suggestion)}
                        >
                          <Text style={styles.suggestionText}>{suggestion}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </ScrollView>
              ) : (
                <FlatList
                  ref={flatListRef}
                  data={messages}
                  renderItem={renderMessageItem}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={[
                    styles.listContentContainer, 
                    { paddingTop: 140, paddingBottom: 120 } // Adjust for header/composer
                  ]}
                  onScroll={handleScroll}
                  scrollEventThrottle={16}
                />
              )}
              
              {showScrollToBottom && (
                <TouchableOpacity style={styles.scrollToBottomButton} onPress={scrollToBottom}>
                  <Ionicons name="arrow-down" size={20} color={palette.textPrimary} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {activeTab === 'image' && (
            <ScrollView 
              style={styles.imageContainer} 
              contentContainerStyle={[
                styles.imageContent,
                { paddingTop: 140, paddingBottom: 120 }
              ]}
            >
              {imageError && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{imageError}</Text>
                </View>
              )}
              {generatedImages.length === 0 ? (
                <View style={styles.welcomeContainer}>
                  <View style={styles.welcomeHero}>
                    <Text style={styles.welcomeIcon}>🎨</Text>
                    <Text style={styles.welcomeTitle}>Imagine anything</Text>
                    <Text style={styles.welcomeSubtitle}>Describe your vision below</Text>
                  </View>
                </View>
              ) : (
                generatedImages.map((item: GeneratedImage) => (
                  <View key={item.id} style={styles.generatedCard}>
                    <Image source={{ uri: item.imageData }} style={styles.generatedImage} contentFit="cover" />
                    <View style={styles.cardOverlay}>
                      <Text style={styles.generatedPrompt} numberOfLines={2}>{item.prompt}</Text>
                      <Text style={styles.generatedDetails}>
                        {getModelDisplayName(item.modelId)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </View>

        {/* Floating Composer */}
        <BlurView intensity={95} tint="dark" style={[styles.composerContainer, { paddingBottom: insets.bottom + space.sm }]}>
          {activeTab === 'image' && showImageSettings && (
            <View style={styles.quickSettings}>
               {/* Simplified inline settings for quick access */}
               <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.settingsScroll}>
                  <View style={styles.settingChip}>
                    <Text style={styles.settingChipLabel}>Size</Text>
                    <TouchableOpacity onPress={() => updateSettings({ imageWidth: 1024, imageHeight: 1024 })}>
                      <Text style={[styles.settingChipValue, settings.imageWidth === 1024 && styles.activeSetting]}>1:1</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => updateSettings({ imageWidth: 576, imageHeight: 1024 })}>
                      <Text style={[styles.settingChipValue, settings.imageWidth === 576 && styles.activeSetting]}>9:16</Text>
                    </TouchableOpacity>
                  </View>
               </ScrollView>
            </View>
          )}

          <View style={styles.composer}>
            {activeTab === 'image' && (
              <TouchableOpacity 
                style={styles.composerIconLeft}
                onPress={() => setShowImageSettings(!showImageSettings)}
              >
                <Ionicons name={showImageSettings ? "options" : "options-outline"} size={24} color={palette.textSecondary} />
              </TouchableOpacity>
            )}
            
            <TextInput
              style={styles.input}
              placeholder={activeTab === 'chat' ? "Message vGPT..." : "Describe an image..."}
              placeholderTextColor={palette.textMuted}
              value={activeTab === 'chat' ? message : imagePrompt}
              onChangeText={activeTab === 'chat' ? setMessage : setImagePrompt}
              multiline
              editable={!isLoading && !isGeneratingImage}
            />
            
            <TouchableOpacity 
              style={[
                styles.sendButton, 
                { backgroundColor: activeTab === 'chat' ? palette.neon.cyan : palette.neon.pink }
              ]} 
              onPress={activeTab === 'chat' ? handleSend : handleGenerateImage}
              disabled={activeTab === 'chat' ? (!message.trim() || isLoading) : (!imagePrompt.trim() || isGeneratingImage)}
            >
              {isLoading || isGeneratingImage ? (
                <ActivityIndicator size="small" color={palette.black} />
              ) : (
                <Ionicons name="arrow-up" size={20} color={palette.black} />
              )}
            </TouchableOpacity>
          </View>
        </BlurView>
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
              {activeTab === 'chat' ? 'Select Model' : 'Select Image Model'}
            </Text>
            <View style={styles.headerSpacer} />
          </View>
          
          {isLoadingModels ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={palette.accent} />
              <Text style={styles.loadingText}>Loading models...</Text>
            </View>
          ) : (
            <FlatList
              data={activeTab === 'chat' ? textModels : imageModels}
              renderItem={({ item }: { item: VeniceModel }) => {
                const isSelected = (activeTab === 'chat' ? settings.model : settings.imageModel) === item.id;
                const inputUsd = resolveUsdPrice(item.model_spec.pricing?.input);
                const generationUsd = resolveUsdPrice(item.model_spec.pricing?.generation);

                return (
                  <TouchableOpacity
                    style={[styles.modelItem, isSelected && styles.selectedModelItem]}
                    onPress={() => activeTab === 'chat' ? handleChatModelSelect(item.id) : handleImageModelSelect(item.id)}
                  >
                    <View style={styles.modelInfo}>
                      <View style={styles.modelHeader}>
                        <Text style={styles.modelName}>{item.model_spec.name}</Text>
                        {item.model_spec.beta && <Text style={styles.betaTag}>BETA</Text>}
                      </View>
                      <Text style={styles.modelId}>{item.id}</Text>
                    </View>
                    <View style={styles.modelPricing}>
                      {activeTab === 'chat' ? (
                        <Text style={styles.pricingText}>{inputUsd != null ? `$${inputUsd}/1M` : ''}</Text>
                      ) : (
                        <Text style={styles.pricingText}>{generationUsd != null ? `$${generationUsd}/img` : ''}</Text>
                      )}
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={24} color={palette.accent} />}
                  </TouchableOpacity>
                );
              }}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.modelList}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  logoIcon: { fontSize: 20 },
  logoText: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: palette.textPrimary,
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    gap: space.xs,
    maxWidth: 160,
  },
  modelText: {
    fontSize: 12,
    color: palette.textPrimary,
    fontFamily: fonts.medium,
    flexShrink: 1,
  },
  iconButton: {
    padding: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  tabSwitcher: {
    flexDirection: 'row',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    gap: space.lg,
  },
  tab: {
    paddingBottom: space.xs,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: palette.accent,
  },
  tabText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: palette.textMuted,
  },
  activeTabText: {
    color: palette.textPrimary,
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
    padding: space.xl,
    gap: space.xl,
  },
  welcomeHero: {
    alignItems: 'center',
    gap: space.sm,
  },
  welcomeIcon: {
    fontSize: 48,
    marginBottom: space.sm,
  },
  welcomeTitle: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: palette.textPrimary,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: 16,
    fontFamily: fonts.regular,
    color: palette.textSecondary,
    textAlign: 'center',
  },
  suggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.sm,
    maxWidth: 400,
  },
  suggestionChip: {
    backgroundColor: palette.surfaceElevated,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.borderMuted,
  },
  suggestionText: {
    fontSize: 14,
    color: palette.textSecondary,
    fontFamily: fonts.medium,
  },
  listContentContainer: {
    paddingHorizontal: space.md,
  },
  messageRow: {
    marginVertical: space.sm,
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
    maxWidth: '85%',
    padding: space.md,
    borderRadius: 20,
  },
  userMessageBubble: {
    backgroundColor: 'rgba(0, 255, 255, 0.15)', // Subtle cyan tint
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 255, 0.3)',
    borderBottomRightRadius: 4,
  },
  assistantMessageBubble: {
    backgroundColor: palette.surfaceElevated,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    color: palette.textPrimary,
    lineHeight: 24,
    fontFamily: fonts.regular,
  },
  metricsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space.sm,
    gap: space.sm,
    opacity: 0.7,
  },
  metricText: {
    fontSize: 10,
    color: palette.textMuted,
    fontFamily: fonts.medium,
  },
  codeBlock: {
    backgroundColor: '#000',
    borderRadius: radii.md,
    padding: space.md,
    marginVertical: space.sm,
    borderWidth: 1,
    borderColor: palette.border,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: '#ddd',
  },
  composerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.borderMuted,
    padding: space.xs,
  },
  composerIconLeft: {
    padding: space.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  input: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 16,
    fontFamily: fonts.regular,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    maxHeight: 100,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 4,
  },
  quickSettings: {
    marginBottom: space.sm,
  },
  settingsScroll: {
    maxHeight: 40,
  },
  settingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.md,
    padding: space.sm,
    gap: space.md,
  },
  settingChipLabel: {
    fontSize: 12,
    color: palette.textMuted,
    fontFamily: fonts.medium,
  },
  settingChipValue: {
    fontSize: 12,
    color: palette.textSecondary,
    fontFamily: fonts.medium,
  },
  activeSetting: {
    color: palette.accent,
    fontFamily: fonts.bold,
  },
  imageContainer: {
    flex: 1,
  },
  imageContent: {
    paddingHorizontal: space.lg,
    gap: space.lg,
  },
  generatedCard: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: palette.surface,
    height: 400,
    borderWidth: 1,
    borderColor: palette.border,
  },
  generatedImage: {
    width: '100%',
    height: '100%',
  },
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: space.lg,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  generatedPrompt: {
    fontSize: 14,
    color: palette.white,
    fontFamily: fonts.medium,
    marginBottom: space.xs,
  },
  generatedDetails: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  errorBanner: {
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    borderWidth: 1,
    borderColor: palette.danger,
    padding: space.md,
    borderRadius: radii.md,
    marginHorizontal: space.lg,
    marginTop: space.md,
  },
  errorText: {
    color: palette.danger,
    fontSize: 14,
  },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: 100,
    right: space.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.background,
  },
  loadingText: {
    color: palette.textSecondary,
    marginTop: space.md,
  },
  emptyModelsText: {
    color: palette.textMuted,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: palette.backgroundMuted,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: palette.divider,
  },
  modalTitle: {
    fontSize: 18,
    color: palette.textPrimary,
    fontFamily: fonts.semibold,
  },
  modalCancelText: {
    color: palette.accent,
    fontSize: 16,
  },
  headerSpacer: { width: 50 },
  modelList: {
    padding: space.md,
  },
  modelItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: space.lg,
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.lg,
    marginBottom: space.sm,
    borderWidth: 1,
    borderColor: palette.border,
  },
  selectedModelItem: {
    borderColor: palette.accent,
    backgroundColor: 'rgba(0, 255, 255, 0.05)',
  },
  modelInfo: { flex: 1 },
  modelHeader: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  modelName: { fontSize: 16, color: palette.textPrimary, fontFamily: fonts.medium },
  betaTag: {
    fontSize: 10,
    color: palette.black,
    backgroundColor: palette.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  modelId: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
  modelPricing: { alignItems: 'flex-end' },
  pricingText: { fontSize: 12, color: palette.textMuted },
  typingIndicator: {
    flexDirection: 'row',
    padding: space.lg,
    gap: 4,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.accent,
    opacity: 0.6,
  },
});

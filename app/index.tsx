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
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
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

interface Message {
  role: 'user' | 'assistant';
  content: string;
  id: string;
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
  const flatListRef = useRef<FlatList>(null);
  const activeRequestControllerRef = useRef<AbortController | null>(null);

  const composerY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadStoredSettings<AppSettings>(DEFAULT_SETTINGS).then(setSettings);
    loadModels();
  }, []);

  useEffect(() => {
    return () => {
      activeRequestControllerRef.current?.abort();
    };
  }, []);

  const textModels = useMemo(() => 
    models.filter((model) => {
      const modelType = model.type?.toLowerCase() ?? '';
      return modelType !== 'image' && !isImageModel(model);
    }), 
    [models]
  );

  const imageModels = useMemo(() => 
    models.filter((model) => isImageModel(model)), 
    [models]
  );

  const updateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      void persistSettings(updated);
      return updated;
    });
  }, []);

  const loadModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const response = await fetch(VENICE_MODELS_ENDPOINT, {
        method: 'GET',
        headers: { Authorization: `Bearer ${VENICE_API_KEY}` },
      });

      if (!response.ok) {
        throw new Error(`Venice API error: ${response.status}`);
      }

      const data = await response.json();
      const incomingModels: VeniceModel[] = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.models)
        ? data.models
        : [];

      setModels(incomingModels);
    } catch (error) {
      console.error('Failed to load models:', error);
      Alert.alert('Error', 'Failed to load available models');
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

  useEffect(() => {
    // Animate composer to its place based on messages
    Animated.timing(composerY, {
      toValue: messages.length > 0 ? 0 : -(height / 2) + 150,
      duration: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [messages.length, height]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

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

    const conversationMessages = [...messages, newUserMessage];
    setMessages((prev) => [...prev, newUserMessage]);

    let assistantMessageId: string | null = null;

    try {
      const conversationHistory = conversationMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

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

      if (settings.temperature !== undefined) requestBody.temperature = settings.temperature;
      if (settings.topP !== undefined) requestBody.top_p = settings.topP;
      if (settings.minP !== undefined) requestBody.min_p = settings.minP;
      if (settings.maxTokens !== undefined) requestBody.max_tokens = settings.maxTokens;
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
      const placeholderMessage: Message = {
        role: 'assistant',
        content: '',
        id: assistantMessageId,
      };

      setMessages((prev) => [...prev, placeholderMessage]);

      const updateAssistantMessage = (partial: Partial<Message>) => {
        if (!assistantMessageId) return;
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, ...partial } : msg))
        );
      };

      let rawAssistantContent = '';

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
                if (choice?.delta?.content) {
                  rawAssistantContent += choice.delta.content;
                  updateAssistantMessage({ content: rawAssistantContent });
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
      } else {
        const data = await response.json();
        rawAssistantContent = data?.choices?.[0]?.message?.content ?? '';
        updateAssistantMessage({ content: rawAssistantContent || "Sorry, I couldn't generate a response." });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      const fallbackText = isAbortError
        ? 'The request was cancelled. Please try again.'
        : 'Something went wrong. Please try again.';

      if (assistantMessageId) {
        setMessages((prev) =>
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
        format: 'png',
        hide_watermark: true,
      };

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

      const imageData = `data:image/png;base64,${base64String}`;
      const generated: GeneratedImage = {
        id: `${Date.now()}`,
        prompt: imagePrompt.trim(),
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
  };

  const renderMessageItem = ({ item }: { item: Message }) => (
    <View style={[styles.messageRow, item.role === 'user' ? styles.userMessageRow : styles.assistantMessageRow]}>
      <View style={[styles.messageBubble, item.role === 'user' ? styles.userMessageBubble : styles.assistantMessageBubble]}>
        <Text style={item.role === 'user' ? styles.userMessageText : styles.assistantMessageText}>{item.content}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      
      {/* Header is now always visible */}
      <View style={styles.header}>
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
            <Ionicons name="chevron-down" size={16} color={palette.neon.cyan} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={22} color={palette.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.tabSwitcher}>
        <TouchableOpacity style={[styles.tab, activeTab === 'chat' && styles.activeTab]} onPress={() => setActiveTab('chat')}>
          <Text style={styles.tabText}>Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'image' && styles.activeTab]} onPress={() => setActiveTab('image')}>
          <Text style={styles.tabText}>Images</Text>
        </TouchableOpacity>
      </View>

      {/* KeyboardAvoidingView now only wraps the content that needs to move */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0} // Adjust this offset as needed
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          {activeTab === 'chat' && (
            <View style={styles.chatContainer}>
              {messages.length === 0 && !isLoading ? (
                <View style={styles.welcomeContainer}>
                  <Text style={styles.welcomeTitle}>Ready to Chat?</Text>
                  <Text style={styles.welcomeSubtitle}>Start a conversation below.</Text>
                </View>
              ) : (
                <FlatList
                  ref={flatListRef}
                  data={messages}
                  renderItem={renderMessageItem}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContentContainer}
                  onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                />
              )}
              {isLoading && (
                <View style={styles.typingIndicator}>
                  <View style={styles.typingDot} />
                  <View style={styles.typingDot} />
                  <View style={styles.typingDot} />
                </View>
              )}
            </View>
          )}

          {activeTab === 'image' && (
            <ScrollView style={styles.imageContainer} contentContainerStyle={styles.imageContent}>
              {imageError && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{imageError}</Text>
                </View>
              )}
              {generatedImages.length === 0 ? (
                <View style={styles.welcomeContainer}>
                  <Ionicons name="image-outline" size={48} color={palette.neon.pink} />
                  <Text style={styles.welcomeTitle}>Image Generation</Text>
                  <Text style={styles.welcomeSubtitle}>Describe the image you want to create.</Text>
                </View>
              ) : (
                generatedImages.map((item) => (
                  <View key={item.id} style={styles.generatedCard}>
                    <Image source={{ uri: item.imageData }} style={styles.generatedImage} contentFit="contain" />
                    <View style={styles.generatedMeta}>
                      <Text style={styles.generatedPrompt} numberOfLines={2}>{item.prompt}</Text>
                      <Text style={styles.generatedDetails}>
                        {getModelDisplayName(item.modelId)} • {new Date(item.createdAt).toLocaleTimeString()}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          )}

          <Animated.View style={[styles.composer, { transform: [{ translateY: activeTab === 'chat' ? composerY : 0 }] }]}>
            {activeTab === 'chat' ? (
              <>
                <TextInput
                  style={styles.textInput}
                  placeholder="Message vGPT..."
                  placeholderTextColor={palette.textMuted}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                />
                <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
                  <Ionicons name="arrow-up-circle" size={32} color={palette.neon.cyan} />
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.textInput}
                  placeholder="Describe an image..."
                  placeholderTextColor={palette.textMuted}
                  value={imagePrompt}
                  onChangeText={setImagePrompt}
                  multiline
                  editable={!isGeneratingImage}
                />
                <TouchableOpacity 
                  style={styles.sendButton}
                  onPress={handleGenerateImage}
                  disabled={!imagePrompt.trim() || isGeneratingImage}
                >
                  {isGeneratingImage ? (
                    <ActivityIndicator size="small" color={palette.neon.pink} />
                  ) : (
                    <Ionicons name="sparkles-outline" size={32} color={palette.neon.pink} />
                  )}
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </View>
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
              <ActivityIndicator size="small" color={palette.neon.cyan} />
              <Text style={styles.loadingText}>Loading models...</Text>
            </View>
          ) : (
            <FlatList
              data={activeTab === 'chat' ? textModels : imageModels}
              renderItem={({ item }) => {
                const isSelected = (activeTab === 'chat' ? settings.model : settings.imageModel) === item.id;
                const capabilities = item.model_spec.capabilities || {};
                const inputUsd = resolveUsdPrice(item.model_spec.pricing?.input);
                const outputUsd = resolveUsdPrice(item.model_spec.pricing?.output);
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
                      <View style={styles.modelCapabilities}>
                        {capabilities.supportsWebSearch && <Text style={styles.capabilityTag}>🌐 Web</Text>}
                        {capabilities.supportsReasoning && <Text style={styles.capabilityTag}>🧠 Reasoning</Text>}
                        {capabilities.optimizedForCode && <Text style={styles.capabilityTag}>💻 Code</Text>}
                        {capabilities.supportsVision && <Text style={styles.capabilityTag}>👁️ Vision</Text>}
                        {capabilities.supportsImageGeneration && <Text style={styles.capabilityTag}>🎨 Image</Text>}
                      </View>
                    </View>
                    <View style={styles.modelPricing}>
                      {activeTab === 'chat' ? (
                        <>
                          <Text style={styles.pricingText}>
                            {inputUsd != null ? `$${inputUsd}/1M in` : '—'}
                          </Text>
                          <Text style={styles.pricingText}>
                            {outputUsd != null ? `$${outputUsd}/1M out` : '—'}
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.pricingText}>
                          {generationUsd != null ? `$${generationUsd}/image` : '—'}
                        </Text>
                      )}
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={24} color={palette.neon.cyan} />}
                  </TouchableOpacity>
                );
              }}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.modelList}
              ListEmptyComponent={
                <View style={styles.loadingContainer}>
                  <Text style={styles.emptyModelsText}>
                    {activeTab === 'chat' ? 'No chat models available.' : 'No image models available.'}
                  </Text>
                </View>
              }
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: palette.background,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: 1,
        borderBottomColor: palette.divider,
    },
    logo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
    },
    logoIcon: { fontSize: 24 },
    logoText: {
        fontSize: 20,
        fontFamily: fonts.semibold,
        color: palette.textPrimary,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
    },
    modelSelector: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: palette.surface,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: palette.neon.cyan,
        gap: space.xs,
    },
    modelText: {
        fontSize: 14,
        color: palette.textPrimary,
        fontFamily: fonts.medium,
        maxWidth: 120,
    },
    headerButton: { padding: space.sm },
    tabSwitcher: {
        flexDirection: 'row',
        justifyContent: 'center',
        padding: space.sm,
        gap: space.sm,
    },
    tab: {
        paddingVertical: space.sm,
        paddingHorizontal: space.lg,
        borderRadius: radii.pill,
    },
    activeTab: {
        backgroundColor: palette.surface,
    },
    tabText: {
        fontFamily: fonts.medium,
        color: palette.textSecondary,
    },
    chatContainer: {
        flex: 1,
    },
    imageContainer: {
        flex: 1,
    },
    imageContent: {
        padding: space.lg,
        gap: space.lg,
    },
    errorBanner: {
        backgroundColor: palette.danger,
        padding: space.md,
        borderRadius: radii.md,
        marginBottom: space.md,
    },
    errorText: {
        color: palette.textPrimary,
        fontFamily: fonts.medium,
    },
    generatedCard: {
        borderRadius: radii.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
    },
    generatedImage: {
        width: '100%',
        minHeight: 200,
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
    typingIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: space.md,
        gap: space.xs,
    },
    typingDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: palette.neon.pink,
    },
    listContentContainer: {
        paddingTop: space.lg,
        paddingBottom: 100, // Safe area for composer
        paddingHorizontal: space.lg,
    },
    welcomeContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: space.lg,
    },
    welcomeTitle: {
        fontSize: 32,
        fontFamily: fonts.bold,
        color: palette.textPrimary,
        marginBottom: space.sm,
        textShadowColor: palette.neon.cyan,
        textShadowRadius: 10,
        textAlign: 'center',
    },
    welcomeSubtitle: {
        fontSize: 16,
        fontFamily: fonts.regular,
        color: palette.textSecondary,
        textAlign: 'center',
    },
    messageRow: {
        marginVertical: space.sm,
        flexDirection: 'row',
    },
    userMessageRow: { justifyContent: 'flex-end' },
    assistantMessageRow: { justifyContent: 'flex-start' },
    messageBubble: {
        maxWidth: '85%',
        padding: space.md,
        borderRadius: radii.lg,
    },
    userMessageBubble: {
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.neon.cyan,
        borderBottomRightRadius: radii.sm,
    },
    assistantMessageBubble: {
        backgroundColor: palette.surface,
        borderBottomLeftRadius: radii.sm,
    },
    userMessageText: {
        fontSize: 16,
        color: palette.textPrimary,
        fontFamily: fonts.regular,
    },
    assistantMessageText: {
        fontSize: 16,
        color: palette.textPrimary,
        fontFamily: fonts.regular,
    },
    composer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: space.md,
        paddingBottom: space.md,
        paddingTop: space.sm,
        width: '100%',
    },
    textInput: {
        flex: 1,
        minHeight: 48,
        maxHeight: 120,
        backgroundColor: palette.surface,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: palette.border,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        fontSize: 16,
        color: palette.textPrimary,
        marginRight: space.sm,
    },
    sendButton: {},
    modalContainer: {
        flex: 1,
        backgroundColor: palette.background,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: 1,
        borderBottomColor: palette.divider,
    },
    modalCancelText: {
        fontSize: 16,
        color: palette.neon.cyan,
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
        width: 60,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: space.xl,
    },
    loadingText: {
        marginTop: space.md,
        fontSize: 14,
        color: palette.textSecondary,
        fontFamily: fonts.medium,
    },
    emptyModelsText: {
        fontSize: 16,
        color: palette.textMuted,
        fontFamily: fonts.medium,
    },
    modelList: {
        paddingVertical: space.md,
    },
    modelItem: {
        backgroundColor: palette.surface,
        marginHorizontal: space.lg,
        marginVertical: space.xs,
        padding: space.lg,
        borderRadius: radii.lg,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: palette.border,
    },
    selectedModelItem: {
        borderColor: palette.neon.cyan,
    },
    modelInfo: {
        flex: 1,
    },
    modelHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: space.xs,
        gap: space.sm,
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
        color: palette.neon.cyan,
        backgroundColor: palette.accentSoft,
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: palette.neon.cyan,
    },
    modelId: {
        fontSize: 13,
        color: palette.textMuted,
        marginBottom: space.xs,
        fontFamily: fonts.medium,
    },
    modelCapabilities: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: space.xs,
    },
    capabilityTag: {
        fontSize: 12,
        color: palette.neon.cyan,
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
});

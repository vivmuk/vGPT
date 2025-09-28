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
  Linking
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

type WebSearchMode = 'off' | 'auto' | 'on';

interface AppSettings {
  model: string;
  temperature: number;
  topP: number;
  minP: number;
  maxTokens: number;
  topK: number;
  repetitionPenalty: number;
  webSearch: WebSearchMode;
  webCitations: boolean;
  includeSearchResults: boolean;
  stripThinking: boolean;
  disableThinking: boolean;
}

interface VeniceModel {
  id: string;
  model_spec: {
    name: string;
    pricing: {
      input: { usd: number; vcu: number; diem: number };
      output: { usd: number; vcu: number; diem: number };
    };
    availableContextTokens: number;
    capabilities: {
      optimizedForCode: boolean;
      quantization: string;
      supportsFunctionCalling: boolean;
      supportsReasoning: boolean;
      supportsResponseSchema: boolean;
      supportsVision: boolean;
      supportsWebSearch: boolean;
      supportsLogProbs: boolean;
    };
    constraints: {
      temperature: { default: number };
      top_p: { default: number };
      max_output_tokens?: { default?: number; max?: number };
      maxOutputTokens?: { default?: number; max?: number };
      max_tokens?: { default?: number; max?: number };
      response_tokens?: { default?: number; max?: number };
      [key: string]: any;
    };
    modelSource: string;
    offline: boolean;
    traits: string[];
    beta?: boolean;
  };
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

export default function ChatScreen() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<VeniceModel[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);
  const [attachedImages, setAttachedImages] = useState<{ uri: string; mimeType: string }[]>([]);
  
  // Settings with localStorage persistence
  const [settings, setSettings] = useState<AppSettings>({
    model: "llama-3.3-70b",
    temperature: 0.7,
    topP: 0.9,
    minP: 0.05,
    maxTokens: 4096, // Increased for longer responses
    topK: 40,
    repetitionPenalty: 1.2,
    webSearch: "auto" as const,
    webCitations: true,
    includeSearchResults: true,
    stripThinking: false,
    disableThinking: false,
  });

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('vgpt-settings');
      if (savedSettings) {
        setSettings(JSON.parse(savedSettings));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }, []);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    const updatedSettings = { ...settings, ...newSettings };
    setSettings(updatedSettings);
    
    // Save to localStorage
    try {
      localStorage.setItem('vgpt-settings', JSON.stringify(updatedSettings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

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

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    setIsLoadingModels(true);
    try {
      const apiKey = "ntmhtbP2fr_pOQsmuLPuN_nm6lm2INWKiNcvrdEfEC";
      
      const response = await fetch("https://api.venice.ai/api/v1/models", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Venice API error: ${response.status}`);
      }

      const data = await response.json();
      setModels(data.data || []);
    } catch (error) {
      console.error('Failed to load models:', error);
      Alert.alert('Error', 'Failed to load available models');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleModelSelect = (modelId: string) => {
    const selectedModel = models.find((m: VeniceModel) => m.id === modelId);
    const defaultMaxTokens = getModelDefaultMaxTokens(selectedModel);
    const updates: Partial<AppSettings> = { model: modelId };
    if (defaultMaxTokens && defaultMaxTokens > 0) {
      updates.maxTokens = defaultMaxTokens;
    }

    updateSettings(updates);
    setShowModelPicker(false);
  };

  const openReferenceLink = useCallback((url?: string) => {
    if (!url) return;
    Linking.openURL(url).catch(() => {
      Alert.alert('Unable to open link', 'The reference link could not be opened.');
    });
  }, []);

  const currentModel = useMemo(() => models.find((m: VeniceModel) => m.id === settings.model), [models, settings.model]);

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

    const userMessage = message.trim();
    const newUserMessage: Message = {
      role: 'user',
      content: userMessage,
      id: Date.now().toString(),
      images: attachedImages.length ? attachedImages : undefined,
    };

    setMessages((prev: Message[]) => [...prev, newUserMessage]);
    setMessage('');
    setIsLoading(true);

    try {
      // Track timing
      const startTime = Date.now();
      
      // Prepare conversation history
      const conversationHistory: any[] = [
        ...messages.map((msg: Message) => {
          if (msg.role === 'user' && msg.images && msg.images.length > 0) {
            // Represent prior user messages with images as multimodal parts
            return {
              role: 'user',
              content: [
                { type: 'text', text: msg.content },
                ...msg.images.map(img => ({ type: 'image_url', image_url: img.dataUrl || img.uri }))
              ]
            };
          }
          return { role: msg.role, content: msg.content };
        }),
      ];

      // Attach current images if any
      let currentUserContent: any = userMessage;
      if (attachedImages.length > 0) {
        // Warn if model may not support vision
        const currentModelVision = models.find((m: VeniceModel) => m.id === settings.model)?.model_spec.capabilities.supportsVision;
        if (!currentModelVision) {
          Alert.alert('Model limitation', 'The selected model may not support images. The request will still be sent, but it may be ignored by the model.');
        }
        // Convert images to data URLs
        const imagesWithDataUrls: { uri: string; mimeType: string; dataUrl: string }[] = [];
        for (const img of attachedImages) {
          try {
            const base64 = await FileSystem.readAsStringAsync(img.uri, { encoding: FileSystem.EncodingType.Base64 });
            imagesWithDataUrls.push({ uri: img.uri, mimeType: img.mimeType, dataUrl: `data:${img.mimeType};base64,${base64}` });
          } catch (e) {
            imagesWithDataUrls.push({ uri: img.uri, mimeType: img.mimeType, dataUrl: img.uri });
          }
        }
        currentUserContent = [
          { type: 'text', text: userMessage },
          ...imagesWithDataUrls.map(img => ({ type: 'image_url', image_url: { url: img.dataUrl } }))
        ];
        conversationHistory.push({ role: 'user' as const, content: currentUserContent });
      } else {
        conversationHistory.push({ role: 'user' as const, content: userMessage });
      }

      // Direct Venice AI API call
      const apiKey = "ntmhtbP2fr_pOQsmuLPuN_nm6lm2INWKiNcvrdEfEC";
      
      const requestBody = {
        model: settings.model,
        messages: conversationHistory,
        temperature: settings.temperature,
        top_p: settings.topP,
        min_p: settings.minP,
        max_tokens: settings.maxTokens,
        top_k: settings.topK,
        repetition_penalty: settings.repetitionPenalty,
        stream: false,
        venice_parameters: {
          character_slug: "venice",
          strip_thinking_response: false, // Always get thinking for separation
          disable_thinking: settings.disableThinking,
          enable_web_search: settings.webSearch,
          enable_web_citations: settings.webCitations,
          include_search_results_in_stream: settings.includeSearchResults,
          include_venice_system_prompt: true,
        },
      };

      // Timeout: extend generously for reasoning models
      const currentModelForTimeout = models.find((m: VeniceModel) => m.id === settings.model);
      const supportsReasoning = currentModelForTimeout?.model_spec.capabilities.supportsReasoning;
      const requestTimeoutMs = supportsReasoning ? 10 * 60 * 1000 : 2 * 60 * 1000; // 10 min for reasoning, 2 min otherwise
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      const response = await fetch("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal as any,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Venice API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      // Extract content and thinking
      const fullContent = data.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
      let thinking = "";
      let content = fullContent;

      // Parse thinking if present
      if (fullContent.includes("<think>") && fullContent.includes("</think>")) {
        const thinkMatch = fullContent.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
          thinking = thinkMatch[1].trim();
          content = fullContent.replace(/<think>[\s\S]*?<\/think>/, "").trim();
        }
      }

      const references = extractVeniceReferences(data);
      content = sanitizeContentWithReferences(content, references);

      // Calculate metrics
      const usage = data.usage || {};
      const inputTokens = usage.prompt_tokens || 0;
      const outputTokens = usage.completion_tokens || 0;
      const totalTokens = usage.total_tokens || inputTokens + outputTokens;
      
      // Find current model for pricing
      const currentModel = models.find((m: VeniceModel) => m.id === settings.model);
      const inputCost = currentModel ? (inputTokens / 1000000) * currentModel.model_spec.pricing.input.usd : 0;
      const outputCost = currentModel ? (outputTokens / 1000000) * currentModel.model_spec.pricing.output.usd : 0;
      const totalCost = inputCost + outputCost;
      
      const tokensPerSecond = outputTokens > 0 ? (outputTokens / (responseTime / 1000)) : 0;
      
      // Add AI response with metrics
      const aiMessage: Message = {
        role: 'assistant',
        content: content,
        thinking: thinking,
        id: (Date.now() + 1).toString(),
        metrics: {
          inputTokens,
          outputTokens,
          totalTokens,
          cost: totalCost,
          tokensPerSecond,
          responseTime,
          model: settings.model,
        },
        references,
      };

      setMessages((prev: Message[]) => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
      setAttachedImages([]);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
  };

  const modelIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of models) map.set(m.id, m.model_spec.name);
    return map;
  }, [models]);

  const getModelDisplayName = useCallback((modelId: string) => {
    return modelIdToName.get(modelId) || modelId;
  }, [modelIdToName]);

  const copyToClipboard = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Copied!', 'Response copied to clipboard');
    } catch (error) {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  };

  const renderMessage = useCallback((msg: Message) => {
    const isUser = msg.role === 'user';
    
    if (isUser) {
      return (
        <View style={[
          styles.messageContainer,
          styles.userMessageContainer
        ]}>
          <View style={[styles.messageBubble, styles.userBubble]}>
            <Text style={[styles.messageText, styles.userText]}>
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
              <Ionicons name="bulb-outline" size={16} color="#9CA3AF" />
              <Text style={styles.thinkingLabel}>Thinking</Text>
            </View>
            <Text style={styles.thinkingText}>{msg.thinking}</Text>
          </View>
        )}

        {/* Main Response */}
        <View style={[styles.messageBubble, styles.assistantBubble]}>
          <Text style={[styles.messageText, styles.assistantText]}>
            {msg.content}
          </Text>

          {msg.references && msg.references.length > 0 && (
            <View style={styles.referencesContainer}>
              <Text style={styles.referencesTitle}>References</Text>
              {msg.references.map((ref: VeniceReference, index: number) => {
                const referenceContent = (
                  <>
                    <Text style={styles.referenceText}>
                      {index + 1}. {ref.title || ref.url || 'Source'}
                    </Text>
                    {ref.snippet ? (
                      <Text style={styles.referenceSnippet}>{ref.snippet}</Text>
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
            <Ionicons name="copy-outline" size={16} color="#6B7280" />
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

  const TypingIndicator: React.FC = () => {
    const progressWidth = useRef(new Animated.Value(0)).current;
    const shimmerPosition = useRef(new Animated.Value(-100)).current;

    useEffect(() => {
      const createProgressAnimation = () =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(progressWidth, {
              toValue: 100,
              duration: 2000,
              useNativeDriver: false,
              easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
            }),
            Animated.timing(progressWidth, {
              toValue: 0,
              duration: 500,
              useNativeDriver: false,
              easing: Easing.bezier(0.55, 0.06, 0.68, 0.19),
            }),
          ])
        );

      const createShimmerAnimation = () =>
        Animated.loop(
          Animated.timing(shimmerPosition, {
            toValue: 200,
            duration: 1500,
            useNativeDriver: true,
            easing: Easing.linear,
          })
        );

      createProgressAnimation().start();
      createShimmerAnimation().start();
    }, [progressWidth, shimmerPosition]);

    return (
      <View style={styles.fetchingContainer}>
        <Text style={styles.fetchingText}>Fetching</Text>
        <View style={styles.progressBarContainer}>
          <Animated.View
            style={[
              styles.progressBar,
              {
                width: progressWidth.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
          <Animated.View
            style={[
              styles.shimmerEffect,
              {
                transform: [
                  {
                    translateX: shimmerPosition.interpolate({
                      inputRange: [-100, 200],
                      outputRange: [-100, 200],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
      </View>
    );
  };

  const ImagePreview: React.FC<{ uri: string }> = ({ uri }: { uri: string }) => {
    return <Image source={{ uri }} style={styles.attachmentImage} contentFit="cover" />;
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <BlurView intensity={40} tint="light" style={styles.header}>
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
              <Text style={styles.modelText}>
                {getModelDisplayName(settings.model)}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#FF6B47" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.settingsButton}
              onPress={() => router.push('/settings')}
              activeOpacity={0.8}
            >
              <Ionicons name="settings" size={20} color="#FF6B47" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.newChatButton}
              onPress={handleNewChat}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={24} color="#FF6B47" />
            </TouchableOpacity>
          </View>
        </BlurView>

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          style={styles.messagesContainer}
          keyExtractor={(item: Message) => item.id}
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
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        {/* Input */}
        <BlurView intensity={30} tint="light" style={styles.inputContainer}>
          {attachedImages.length > 0 && (
            <View style={styles.attachmentsBar}>
              {attachedImages.map((img: { uri: string; mimeType: string }) => (
                <View key={img.uri} style={styles.attachmentItem}>
                  <ImagePreview uri={img.uri} />
                  <TouchableOpacity style={styles.removeAttachmentBtn} onPress={() => removeAttachedImage(img.uri)}>
                    <Ionicons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <View style={styles.inputWrapper}>
            <View style={styles.leftActions}>
              <TouchableOpacity onPress={pickImageFromLibrary} style={styles.iconButton} activeOpacity={0.8}>
                <Ionicons name="image-outline" size={20} color="#6B7280" />
              </TouchableOpacity>
              <TouchableOpacity onPress={takePhotoWithCamera} style={styles.iconButton} activeOpacity={0.8}>
                <Ionicons name="camera-outline" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.textInput}
              placeholder="Message..."
              placeholderTextColor="#999"
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={4000}
              editable={!isLoading}
              autoCorrect
              autoCapitalize="sentences"
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!message.trim() || isLoading) && styles.sendButtonDisabled
              ]}
              onPress={handleSend}
              disabled={!message.trim() || isLoading}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-up" size={20} color="white" />
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
            <Text style={styles.modalTitle}>Select Model</Text>
            <View style={styles.headerSpacer} />
          </View>
          
          {isLoadingModels ? (
            <View style={styles.loadingContainer}>
              <Text>Loading models...</Text>
            </View>
          ) : (
            <FlatList
              data={models}
                renderItem={({ item }: { item: VeniceModel }) => (
                <TouchableOpacity
                  style={[
                    styles.modelItem,
                    settings.model === item.id && styles.selectedModelItem
                  ]}
                  onPress={() => handleModelSelect(item.id)}
                >
                  <View style={styles.modelInfo}>
                    <View style={styles.modelHeader}>
                      <Text style={styles.modelName}>{item.model_spec.name}</Text>
                      {item.model_spec.beta && (
                        <Text style={styles.betaTag}>BETA</Text>
                      )}
                    </View>
                    <Text style={styles.modelId}>{item.id}</Text>
                    <Text style={styles.contextTokens}>
                      {(item.model_spec.availableContextTokens / 1000).toFixed(0)}K context • {item.model_spec.capabilities.quantization}
                    </Text>
                    <View style={styles.modelCapabilities}>
                      {item.model_spec.capabilities.supportsWebSearch && (
                        <Text style={styles.capabilityTag}>🌐 Web</Text>
                      )}
                      {item.model_spec.capabilities.supportsReasoning && (
                        <Text style={styles.capabilityTag}>🧠 Reasoning</Text>
                      )}
                      {item.model_spec.capabilities.optimizedForCode && (
                        <Text style={styles.capabilityTag}>💻 Code</Text>
                      )}
                      {item.model_spec.capabilities.supportsVision && (
                        <Text style={styles.capabilityTag}>👁️ Vision</Text>
                      )}
                      {item.model_spec.capabilities.supportsFunctionCalling && (
                        <Text style={styles.capabilityTag}>🔧 Functions</Text>
                      )}
                    </View>
                  </View>
                  
                  <View style={styles.modelPricing}>
                    <Text style={styles.pricingText}>
                      ${item.model_spec.pricing.input.usd}/1M in
                    </Text>
                    <Text style={styles.pricingText}>
                      ${item.model_spec.pricing.output.usd}/1M out
                    </Text>
                  </View>
                  
                  {settings.model === item.id && (
                    <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
                  )}
                </TouchableOpacity>
              )}
              keyExtractor={(item: VeniceModel) => item.id}
              contentContainerStyle={styles.modelList}
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
    backgroundColor: '#F8F9FA',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  logoText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F3',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFE5E0',
  },
  modelText: {
    fontSize: 14,
    color: '#FF6B47',
    marginRight: 4,
    fontWeight: '500',
  },
  settingsButton: {
    padding: 8,
  },
  newChatButton: {
    padding: 8,
  },
  messagesContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  messagesContent: {
    paddingVertical: 16,
  },
  welcomeContainer: {
    alignItems: 'center',
  },
  welcomeIconContainer: {
    position: 'relative',
    marginBottom: 32,
  },
  welcomeIcon: {
    fontSize: 80,
    textAlign: 'center',
  },
  sparkleIcon: {
    fontSize: 20,
    position: 'absolute',
    top: -10,
    right: -10,
    opacity: 0.6,
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: 17,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  messageContainer: {
    paddingHorizontal: 16,
    marginVertical: 4,
  },
  userMessageContainer: {
    alignItems: 'flex-end',
  },
  assistantMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  userBubble: {
    backgroundColor: '#FF6B47',
    borderBottomRightRadius: 6,
    shadowColor: '#FF6B47',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  assistantBubble: {
    backgroundColor: 'white',
    borderBottomLeftRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F0F0F0',
    position: 'relative',
    paddingTop: 16, // Extra padding for copy button
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: 'white',
  },
  assistantText: {
    color: '#333',
  },
  referencesContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 8,
  },
  referencesTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  referenceItem: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  referenceText: {
    fontSize: 14,
    color: '#1F2937',
    fontWeight: '500',
  },
  referenceSnippet: {
    marginTop: 4,
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  loadingMessage: {
    paddingHorizontal: 16,
    marginVertical: 4,
    alignItems: 'flex-start',
  },
  fetchingContainer: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  fetchingText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  progressBarContainer: {
    width: 120,
    height: 4,
    backgroundColor: '#F3F4F6',
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#FF6B47',
    borderRadius: 2,
  },
  shimmerEffect: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    width: 40,
  },
  attachmentsBar: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    paddingBottom: 8,
    gap: 8,
  },
  attachmentItem: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  removeAttachmentBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 8,
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  sentImagesRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  sentImage: {
    width: 140,
    height: 140,
    borderRadius: 12,
  },
  inputContainer: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#F8F9FA',
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minHeight: 52,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    maxHeight: 120,
    paddingVertical: 8,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FF6B47',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
    shadowColor: '#FF6B47',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  sendButtonDisabled: {
    backgroundColor: '#D0D0D0',
    shadowOpacity: 0.1,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalCancelText: {
    fontSize: 16,
    color: '#FF6B47',
    fontWeight: '500',
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 80,
  },
  modelList: {
    paddingVertical: 8,
  },
  modelItem: {
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  selectedModelItem: {
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  modelInfo: {
    flex: 1,
  },
  modelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  modelName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  betaTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FF6B47',
    backgroundColor: '#FFF5F3',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FFE5E0',
  },
  modelId: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  contextTokens: {
    fontSize: 12,
    color: '#888',
    marginBottom: 8,
  },
  modelCapabilities: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  capabilityTag: {
    fontSize: 12,
    color: '#4A90E2',
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  modelPricing: {
    alignItems: 'flex-end',
    marginRight: 12,
  },
  pricingText: {
    fontSize: 12,
    color: '#666',
  },
  // New styles for enhanced message display
  thinkingContainer: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#E5E7EB',
  },
  thinkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  thinkingLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  thinkingText: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    fontStyle: 'italic',
  },
  copyButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  metricsContainer: {
    marginTop: 8,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  metricsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modelDisplayName: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  timestamp: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  tokenMetrics: {
    marginBottom: 6,
  },
  tokenInfo: {
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 16,
  },
  inputTokens: {
    color: '#3B82F6',
    fontWeight: '600',
  },
  outputTokens: {
    color: '#10B981',
    fontWeight: '600',
  },
  costDisplay: {
    color: '#10B981',
    fontWeight: '700',
  },
  performanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  performanceMetric: {
    fontSize: 11,
    color: '#6B7280',
    flexDirection: 'row',
    alignItems: 'center',
  },
  metricNumber: {
    fontWeight: '600',
    color: '#374151',
  },
});
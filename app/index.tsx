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
  ScrollView
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
  const flatListRef = useRef<FlatList<Message>>(null);
  const [attachedImages, setAttachedImages] = useState<{ uri: string; mimeType: string }[]>([]);
  
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

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

  const updateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updatedSettings = { ...prev, ...newSettings };
      void persistSettings(updatedSettings);
      return updatedSettings;
    });
  }, []);

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
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleModelSelect = useCallback((modelId: string) => {
    const selectedModel = models.find((m: VeniceModel) => m.id === modelId);
    const defaultMaxTokens = getModelDefaultMaxTokens(selectedModel);
    const updates: Partial<AppSettings> = { model: modelId };
    if (defaultMaxTokens && defaultMaxTokens > 0) {
      updates.maxTokens = defaultMaxTokens;
    }

    updateSettings(updates);
    setShowModelPicker(false);
  }, [models, updateSettings]);

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

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      if (Platform.OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Copied!', 'Response copied to clipboard');
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
          <Text style={[styles.messageText, styles.assistantText]} selectable>
            {msg.content}
          </Text>

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
      const availableContext = item.model_spec.availableContextTokens;
      const metaParts: string[] = [];
      if (typeof availableContext === 'number' && availableContext > 0) {
        metaParts.push(`${Math.round((availableContext / 1000) * 10) / 10}K context`);
      }
      const quantization = item.model_spec.capabilities?.quantization;
      if (quantization) {
        metaParts.push(quantization);
      }
      const metaText = metaParts.length > 0 ? metaParts.join(' • ') : 'Specs unavailable';

      const inputUsd = resolveUsdPrice(item.model_spec.pricing?.input);
      const outputUsd = resolveUsdPrice(item.model_spec.pricing?.output);
      const capabilities = item.model_spec.capabilities || {};

      return (
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
            <Text style={styles.contextTokens}>{metaText}</Text>
            <View style={styles.modelCapabilities}>
              {capabilities.supportsWebSearch && (
                <Text style={styles.capabilityTag}>🌐 Web</Text>
              )}
              {capabilities.supportsReasoning && (
                <Text style={styles.capabilityTag}>🧠 Reasoning</Text>
              )}
              {capabilities.optimizedForCode && (
                <Text style={styles.capabilityTag}>💻 Code</Text>
              )}
              {capabilities.supportsVision && (
                <Text style={styles.capabilityTag}>👁️ Vision</Text>
              )}
              {capabilities.supportsFunctionCalling && (
                <Text style={styles.capabilityTag}>🔧 Functions</Text>
              )}
            </View>
          </View>

          <View style={styles.modelPricing}>
            <Text style={styles.pricingText}>
              {inputUsd != null ? `$${inputUsd}/1M in` : '—'}
            </Text>
            <Text style={styles.pricingText}>
              {outputUsd != null ? `$${outputUsd}/1M out` : '—'}
            </Text>
          </View>

          {settings.model === item.id && (
            <Ionicons name="checkmark-circle" size={24} color={palette.accentStrong} />
          )}
        </TouchableOpacity>
      );
    },
    [handleModelSelect, settings.model]
  );

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
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <BlurView intensity={65} tint="dark" style={styles.header}>
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
              onPress={handleNewChat}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={24} color={palette.accentStrong} />
            </TouchableOpacity>
          </View>
        </BlurView>

        {/* Messages */}
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

        {/* Input */}
        <BlurView intensity={30} tint="light" style={styles.inputContainer}>
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
          <View style={styles.inputWrapper}>
            <View style={styles.leftActions}>
              <TouchableOpacity onPress={pickImageFromLibrary} style={styles.iconButton} activeOpacity={0.8}>
                <Ionicons name="image-outline" size={20} color={palette.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={takePhotoWithCamera} style={styles.iconButton} activeOpacity={0.8}>
                <Ionicons name="camera-outline" size={20} color={palette.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.textInput}
              placeholder="Message..."
              placeholderTextColor={palette.textMuted}
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
              renderItem={renderModelItem}
              keyExtractor={(item: VeniceModel) => item.id}
              contentContainerStyle={styles.modelList}
              ListEmptyComponent={(
                <View style={styles.loadingContainer}>
                  <Text style={styles.emptyModelsText}>No models available.</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.divider,
    ...shadow.subtle,
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
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  fetchingText: {
    fontSize: 14,
    color: palette.textSecondary,
    fontFamily: fonts.medium,
    marginBottom: space.sm,
    letterSpacing: 0.3,
  },
  progressBarContainer: {
    width: 140,
    height: 4,
    backgroundColor: palette.borderMuted,
    borderRadius: radii.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  progressBar: {
    height: '100%',
    backgroundColor: palette.accent,
  },
  shimmerEffect: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
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
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginRight: space.md,
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
  inputContainer: {
    backgroundColor: palette.surface,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.divider,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: palette.inputBackground,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.inputBorder,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: palette.textPrimary,
    maxHeight: 140,
    paddingVertical: space.xs,
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

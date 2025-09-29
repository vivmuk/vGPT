import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  FlatList,
  Platform,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { DEFAULT_SETTINGS } from '@/constants/settings';
import { AppSettings, WebSearchMode } from '@/types/settings';
import { VeniceModel } from '@/types/venice';
import { loadStoredSettings, persistSettings } from '@/utils/settingsStorage';

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

export default function SettingsScreen() {
  const router = useRouter();

  const [models, setModels] = useState<VeniceModel[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
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
      const updated = { ...prev, ...newSettings };
      void persistSettings(updated);
      return updated;
    });
  }, []);

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

  const handleSliderChange = useCallback((key: keyof AppSettings, value: number) => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    updateSettings({ [key]: value } as Partial<AppSettings>);
  }, [updateSettings]);

  const handleWebSearchChange = useCallback((value: WebSearchMode) => {
    updateSettings({ webSearch: value });
  }, [updateSettings]);

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

  const getModelDisplayName = (modelId: string) => {
    const model = models.find((m: VeniceModel) => m.id === modelId);
    return model?.model_spec.name || modelId;
  };

  const currentModel = useMemo(() => models.find((m: VeniceModel) => m.id === settings.model), [models, settings.model]);
  const currentModelMaxTokens = useMemo(() => getModelDefaultMaxTokens(currentModel), [currentModel]);

  useEffect(() => {
    if (!currentModel) return;
    const defaultMaxTokens = currentModelMaxTokens;
    if (!defaultMaxTokens) return;

    const shouldUpdate =
      settings.maxTokens === 4096 ||
      settings.maxTokens == null ||
      settings.maxTokens > defaultMaxTokens;

    if (shouldUpdate && settings.maxTokens !== defaultMaxTokens) {
      updateSettings({ maxTokens: defaultMaxTokens });
    }
  }, [currentModel, currentModelMaxTokens, settings.maxTokens]);

  const getSettingExplanation = (key: string) => {
    const explanations: Record<string, string> = {
      'temperature': 'Controls randomness. Lower values make responses more focused and deterministic, higher values increase creativity and variety.',
      'topP': 'Controls diversity via nucleus sampling. Lower values focus on more likely tokens, higher values allow more diverse responses.',
      'minP': 'Sets minimum probability threshold for token selection. Helps filter out very unlikely tokens.',
      'maxTokens': 'Maximum number of tokens (words/parts) the AI can generate in its response.',
      'topK': 'Limits token selection to the K most likely tokens. Lower values make responses more focused.',
      'repetitionPenalty': 'Reduces repetition by penalizing recently used tokens. Values > 1 discourage repetition.'
    };
    return explanations[key] || '';
  };

  const renderSliderSetting = (
    title: string,
    icon: string,
    value: number,
    min: number,
    max: number,
    step: number,
    settingKey: keyof AppSettings,
    color: string = '#FF6B47'
  ) => (
    <View style={styles.settingContainer}>
      <View style={styles.settingHeader}>
        <View style={styles.settingTitleContainer}>
          <Text style={styles.settingIcon}>{icon}</Text>
          <Text style={styles.settingTitle}>{title}</Text>
        </View>
        <Text style={[styles.settingValue, { color }]}>
          {value.toFixed(step < 1 ? 2 : 0)}
        </Text>
      </View>

      <Text style={styles.settingExplanation}>
        {getSettingExplanation(settingKey as string)}
      </Text>

      <View style={styles.sliderContainer}>
        <TouchableOpacity
          style={styles.sliderButton}
          onPress={() => handleSliderChange(settingKey, Math.max(min, value - step))}
        >
          <Ionicons name="remove" size={16} color={color} />
        </TouchableOpacity>

        <Slider
          style={styles.slider}
          minimumValue={min}
          maximumValue={max}
          step={step}
          value={value}
          onValueChange={(val: number) => handleSliderChange(settingKey, val)}
          minimumTrackTintColor={color}
          maximumTrackTintColor="#E0E0E0"
          thumbTintColor={color}
        />

        <TouchableOpacity
          style={styles.sliderButton}
          onPress={() => handleSliderChange(settingKey, Math.min(max, value + step))}
        >
          <Ionicons name="add" size={16} color={color} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderModelItem = useCallback(({ item }: { item: VeniceModel }) => {
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

    const capabilities = item.model_spec.capabilities || {};
    const inputUsd = resolveUsdPrice(item.model_spec.pricing?.input);
    const outputUsd = resolveUsdPrice(item.model_spec.pricing?.output);

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
          <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
        )}
      </TouchableOpacity>
    );
  }, [handleModelSelect, settings.model]);



  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FF6B47" />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Settings</Text>
        
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Model Selection */}
        <TouchableOpacity 
          style={styles.modelSelector}
          onPress={() => setShowModelPicker(true)}
        >
          <View style={styles.settingTitleContainer}>
            <Text style={styles.settingIcon}>🤖</Text>
            <Text style={styles.settingTitle}>Model</Text>
          </View>
          <View style={styles.modelSelectorRight}>
            <Text style={styles.selectedModelText}>
              {getModelDisplayName(settings.model)}
            </Text>
            <Ionicons name="chevron-forward" size={20} color="#CCC" />
          </View>
        </TouchableOpacity>

        {/* Web Search */}
        <View style={styles.settingContainer}>
          <View style={styles.settingTitleContainer}>
            <Text style={styles.settingIcon}>🌐</Text>
            <Text style={styles.settingTitle}>Web Search</Text>
          </View>
          
          <Text style={styles.settingExplanation}>
            Controls whether the AI can search the web for current information. Auto lets the AI decide when to search.
          </Text>
          
          <View style={styles.webSearchButtons}>
            {(['off', 'auto', 'on'] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.webSearchButton,
                  settings.webSearch === option && styles.webSearchButtonActive
                ]}
                onPress={() => handleWebSearchChange(option)}
              >
                <Text style={[
                  styles.webSearchButtonText,
                  settings.webSearch === option && styles.webSearchButtonTextActive
                ]}>
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Sliders */}
        {renderSliderSetting('Temperature', '🌡️', settings.temperature, 0, 2, 0.01, 'temperature')}
        {renderSliderSetting('Top P', '🎯', settings.topP, 0, 1, 0.01, 'topP')}
        {renderSliderSetting('Min P', '📊', settings.minP, 0, 1, 0.01, 'minP')}
        {renderSliderSetting(
          'Max Tokens',
          '📝',
          settings.maxTokens,
          1,
          Math.max(currentModelMaxTokens || 8192, settings.maxTokens || 1),
          1,
          'maxTokens',
          '#4CAF50'
        )}
        {renderSliderSetting('Top K', '🔢', settings.topK, 1, 100, 1, 'topK', '#9C27B0')}
        {renderSliderSetting('Repetition Penalty', '🔄', settings.repetitionPenalty, 0.5, 2, 0.01, 'repetitionPenalty', '#FF9800')}
      </ScrollView>

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
              <ActivityIndicator size="small" color="#FF6B47" />
              <Text style={styles.loadingText}>Loading models...</Text>
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
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  emptyModelsText: {
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
    paddingVertical: 16,
  },
  settingContainer: {
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  settingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  settingTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  settingValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  settingExplanation: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 16,
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sliderButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F8F8F8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slider: {
    flex: 1,
    height: 40,
  },
  modelSelector: {
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 20,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  modelSelectorRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedModelText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  webSearchButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  webSearchButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#F8F8F8',
    alignItems: 'center',
  },
  webSearchButtonActive: {
    backgroundColor: '#4A90E2',
  },
  webSearchButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  webSearchButtonTextActive: {
    color: 'white',
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
});
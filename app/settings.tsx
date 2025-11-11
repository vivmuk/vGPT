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
import { StatusBar } from 'expo-status-bar';
import { DEFAULT_SETTINGS } from '@/constants/settings';
import { AppSettings, WebSearchMode } from '@/types/settings';
import { VeniceModel } from '@/types/venice';
import { loadStoredSettings, persistSettings } from '@/utils/settingsStorage';
import { theme } from '@/constants/theme';
import { VENICE_API_KEY, VENICE_MODELS_ENDPOINT } from '@/constants/venice';

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

const palette = theme.colors;
const space = theme.spacing;
const radii = theme.radius;
const fonts = theme.fonts;
const shadow = theme.shadows;

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
      // Validate and clamp imageGuidanceScale to valid range (1-20)
      if (stored.imageGuidanceScale !== undefined) {
        stored.imageGuidanceScale = Math.max(1, Math.min(20, stored.imageGuidanceScale));
      }
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
      // Validate and clamp imageGuidanceScale to valid range (1-20)
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
      const response = await fetch(VENICE_MODELS_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${VENICE_API_KEY}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Venice API error: ${response.status} - ${errorText}`);
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
    color: string = palette.accent
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
          maximumTrackTintColor={palette.border}
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
          <Ionicons name="checkmark-circle" size={24} color={palette.accentStrong} />
        )}
      </TouchableOpacity>
    );
  }, [handleModelSelect, settings.model]);



  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={palette.accentStrong} />
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
            <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
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
          palette.success
        )}
        {renderSliderSetting('Top K', '🔢', settings.topK, 1, 100, 1, 'topK', palette.warning)}
        {renderSliderSetting('Repetition Penalty', '🔄', settings.repetitionPenalty, 0.5, 2, 0.01, 'repetitionPenalty', palette.danger)}
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
              <ActivityIndicator size="small" color={palette.accent} />
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
    backgroundColor: palette.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.background,
  },
  loadingText: {
    marginTop: space.sm,
    fontSize: 14,
    color: palette.textSecondary,
    fontFamily: fonts.medium,
  },
  emptyModelsText: {
    fontSize: 16,
    color: palette.textSecondary,
    fontFamily: fonts.medium,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.divider,
    ...shadow.subtle,
  },
  backButton: {
    padding: space.sm,
    borderRadius: radii.sm,
    backgroundColor: palette.surfaceActive,
    borderWidth: 1,
    borderColor: palette.border,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    color: palette.textPrimary,
    textAlign: 'center',
    fontFamily: fonts.semibold,
    letterSpacing: 0.5,
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
    paddingVertical: space.xl,
  },
  settingContainer: {
    backgroundColor: palette.surfaceElevated,
    marginHorizontal: space.lg,
    marginVertical: space.sm,
    padding: space.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.border,
    gap: space.md,
    ...shadow.subtle,
  },
  settingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  settingIcon: {
    fontSize: 20,
    color: palette.accentStrong,
  },
  settingTitle: {
    fontSize: 16,
    color: palette.textPrimary,
    fontFamily: fonts.semibold,
  },
  settingValue: {
    fontSize: 16,
    color: palette.accentStrong,
    fontFamily: fonts.semibold,
  },
  settingExplanation: {
    fontSize: 14,
    color: palette.textSecondary,
    lineHeight: 20,
    fontFamily: fonts.regular,
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  sliderButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.surfaceActive,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  modelSelector: {
    backgroundColor: palette.surfaceElevated,
    marginHorizontal: space.lg,
    marginVertical: space.sm,
    padding: space.lg,
    borderRadius: radii.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    ...shadow.subtle,
  },
  modelSelectorRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  selectedModelText: {
    color: palette.textPrimary,
    fontFamily: fonts.medium,
  },
  webSearchButtons: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
  },
  webSearchButton: {
    flex: 1,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: palette.surfaceActive,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  webSearchButtonActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  webSearchButtonText: {
    fontSize: 14,
    color: palette.textSecondary,
    fontFamily: fonts.medium,
  },
  webSearchButtonTextActive: {
    color: palette.textPrimary,
    fontFamily: fonts.medium,
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
    elevation: 8,
  },
  modelInfo: {
    flex: 1,
    gap: space.xs,
  },
  modelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.xs,
    gap: space.xs,
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
    fontFamily: fonts.medium,
  },
  contextTokens: {
    fontSize: 12,
    color: palette.textMuted,
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
    gap: space.xs,
  },
  pricingText: {
    fontSize: 12,
    color: palette.textMuted,
    fontFamily: fonts.medium,
  },
});

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
  ActivityIndicator,
  Switch
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { DEFAULT_SETTINGS } from '@/constants/settings';
import { AppSettings, WebSearchMode } from '@/types/settings';
import { VeniceModel } from '@/types/venice';
import { loadStoredSettings, persistSettings } from '@/utils/settingsStorage';
import { VENICE_API_KEY, VENICE_MODELS_ENDPOINT } from '@/constants/venice';

const COLORS = {
  background: '#212121',
  surface: '#2f2f2f',
  border: '#3c3c3c',
  textPrimary: '#ececec',
  textSecondary: '#b4b4b4',
  accent: '#10a37f',
  error: '#ef4444',
};

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
  if (pricingSection == null) return undefined;
  if (typeof pricingSection === 'number') return pricingSection;
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
      if (stored.imageGuidanceScale !== undefined) {
        stored.imageGuidanceScale = Math.max(1, Math.min(20, stored.imageGuidanceScale));
      }
      if (isMounted) {
        setSettings((prev: AppSettings) => ({ ...prev, ...stored }));
      }
    })();
    return () => { isMounted = false; };
  }, []);

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
      const response = await fetch(VENICE_MODELS_ENDPOINT, {
        method: 'GET',
        headers: { Authorization: `Bearer ${VENICE_API_KEY}` },
      });

      if (!response.ok) throw new Error(`Venice API error: ${response.status}`);

      const data = await response.json();
      const incomingModels: VeniceModel[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      setModels(incomingModels);
    } catch (error) {
      console.error('Failed to load models:', error);
      Alert.alert('Error', 'Failed to load available models');
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  const handleSliderChange = useCallback((key: keyof AppSettings, value: number) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateSettings({ [key]: value } as Partial<AppSettings>);
  }, [updateSettings]);

  const handleModelSelect = useCallback((modelId: string) => {
    const selectedModel = models.find((m: VeniceModel) => m.id === modelId);
    if (!selectedModel) return;

    const updates: Partial<AppSettings> = { model: modelId };
    const constraints = selectedModel.model_spec.constraints || {};

    const defaultTemp = getConstraintNumber(constraints.temperature);
    if (defaultTemp !== undefined) updates.temperature = defaultTemp;

    const defaultTopP = getConstraintNumber(constraints.top_p);
    if (defaultTopP !== undefined) updates.topP = defaultTopP;

    const defaultMaxTokens = getModelDefaultMaxTokens(selectedModel);
    if (defaultMaxTokens && defaultMaxTokens > 0) updates.maxTokens = defaultMaxTokens;

    updateSettings(updates);
    setShowModelPicker(false);
  }, [models, updateSettings]);

  const resetToDefaults = useCallback(() => {
    const selectedModel = models.find((m: VeniceModel) => m.id === settings.model);
    if (!selectedModel) return;

    const constraints = selectedModel.model_spec.constraints || {};
    const updates: Partial<AppSettings> = {};

    const defaultTemp = getConstraintNumber(constraints.temperature);
    if (defaultTemp !== undefined) updates.temperature = defaultTemp;

    const defaultTopP = getConstraintNumber(constraints.top_p);
    if (defaultTopP !== undefined) updates.topP = defaultTopP;

    const defaultMaxTokens = getModelDefaultMaxTokens(selectedModel);
    if (defaultMaxTokens !== undefined) updates.maxTokens = defaultMaxTokens;

    if (updates.temperature === undefined) updates.temperature = DEFAULT_SETTINGS.temperature;
    if (updates.topP === undefined) updates.topP = DEFAULT_SETTINGS.topP;
    if (updates.maxTokens === undefined) updates.maxTokens = DEFAULT_SETTINGS.maxTokens;

    updates.minP = DEFAULT_SETTINGS.minP;
    updates.topK = DEFAULT_SETTINGS.topK;
    updates.repetitionPenalty = DEFAULT_SETTINGS.repetitionPenalty;

    updateSettings(updates);
    Alert.alert('Reset', 'Settings restored to model defaults.');
  }, [models, settings.model, updateSettings]);

  const getModelDisplayName = (modelId: string) => {
    const model = models.find((m: VeniceModel) => m.id === modelId);
    return model?.model_spec.name || modelId;
  };

  const currentModel = useMemo(() => models.find((m: VeniceModel) => m.id === settings.model), [models, settings.model]);
  const currentModelMaxTokens = useMemo(() => getModelDefaultMaxTokens(currentModel), [currentModel]);

  const renderSection = (title: string, children: React.ReactNode) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );

  const renderSlider = (label: string, value: number, min: number, max: number, step: number, settingKey: keyof AppSettings) => (
    <View style={styles.settingItem}>
      <View style={styles.settingHeader}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{value.toFixed(step < 1 ? 2 : 0)}</Text>
      </View>
      <Slider
        style={styles.slider}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={(val) => handleSliderChange(settingKey, val)}
        minimumTrackTintColor={COLORS.accent}
        maximumTrackTintColor={COLORS.border}
        thumbTintColor={COLORS.accent}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <TouchableOpacity onPress={resetToDefaults} style={styles.resetButton}>
          <Feather name="refresh-cw" size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {renderSection('Model', (
          <TouchableOpacity onPress={() => setShowModelPicker(true)} style={styles.modelPickerBtn}>
            <Text style={styles.modelName}>{getModelDisplayName(settings.model)}</Text>
            <Feather name="chevron-right" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        ))}

        {renderSection('Web Search', (
          <View style={styles.segmentedControl}>
            {(['off', 'auto', 'on'] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.segment, settings.webSearch === option && styles.segmentActive]}
                onPress={() => updateSettings({ webSearch: option })}
              >
                <Text style={[styles.segmentText, settings.webSearch === option && styles.segmentTextActive]}>
                  {option.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}

        {renderSection('Capabilities', (
          <>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Include Venice System Prompt</Text>
              <Switch
                value={settings.includeVeniceSystemPrompt}
                onValueChange={(v) => updateSettings({ includeVeniceSystemPrompt: v })}
                trackColor={{ false: COLORS.border, true: COLORS.accent }}
              />
            </View>
            <View style={[styles.switchRow, { marginTop: 16 }]}>
              <Text style={styles.switchLabel}>Web Citations</Text>
              <Switch
                value={settings.webCitations}
                onValueChange={(v) => updateSettings({ webCitations: v })}
                trackColor={{ false: COLORS.border, true: COLORS.accent }}
              />
            </View>
          </>
        ))}

        {renderSection('Parameters', (
          <>
            {renderSlider('Temperature', settings.temperature, 0, 2, 0.01, 'temperature')}
            {renderSlider('Top P', settings.topP, 0, 1, 0.01, 'topP')}
            {renderSlider('Min P', settings.minP, 0, 1, 0.01, 'minP')}
            {renderSlider('Max Tokens', settings.maxTokens, 1, currentModelMaxTokens || 8192, 1, 'maxTokens')}
          </>
        ))}
      </ScrollView>

      <Modal visible={showModelPicker} animationType="slide" presentationStyle="formSheet">
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Model</Text>
            <TouchableOpacity onPress={() => setShowModelPicker(false)}>
              <Feather name="x" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={models}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => handleModelSelect(item.id)}
                style={[styles.modelItem, settings.model === item.id && styles.selectedModel]}
              >
                <Text style={styles.modelItemName}>{item.model_spec.name || item.id}</Text>
                <Text style={styles.modelItemId}>{item.id}</Text>
                {settings.model === item.id && (
                  <View style={styles.checkIcon}>
                    <Feather name="check" size={20} color={COLORS.accent} />
                  </View>
                )}
              </TouchableOpacity>
            )}
            keyExtractor={(item) => item.id}
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
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  backButton: { padding: 8 },
  resetButton: { padding: 8 },
  content: { flex: 1 },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  sectionContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modelPickerBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modelName: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '500',
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentActive: {
    backgroundColor: COLORS.surface,
  },
  segmentText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: COLORS.textPrimary,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    color: COLORS.textPrimary,
    fontSize: 15,
  },
  settingItem: {
    marginBottom: 20,
  },
  settingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  settingLabel: {
    color: COLORS.textPrimary,
    fontSize: 15,
  },
  settingValue: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  slider: {
    height: 30,
    marginHorizontal: -8,
  },
  modalContent: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  modelItem: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  selectedModel: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  modelItemName: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  modelItemId: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  checkIcon: {
    position: 'absolute',
    right: 20,
    top: '50%',
    marginTop: -10,
  },
});

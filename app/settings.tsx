import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  FlatList,
  Switch
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { StatusBar } from 'expo-status-bar';
import { DEFAULT_SETTINGS } from '@/constants/settings';
import { AppSettings } from '@/types/settings';
import { VeniceModel } from '@/types/venice';
import { loadStoredSettings, persistSettings } from '@/utils/settingsStorage';
import { VENICE_API_KEY, VENICE_MODELS_ENDPOINT } from '@/constants/venice';

// ═══════════════════════════════════════════════════════════════════════════
// FRENCH DESIGNER THEME - Matching index.tsx
// ═══════════════════════════════════════════════════════════════════════════

const THEME = {
  bleu: '#002395',
  blanc: '#FFFFFF',
  rouge: '#ED2939',
  orange: '#FF7F50',
  orangeLight: 'rgba(255, 127, 80, 0.15)',
  noir: '#0C0C0E',
  surface: '#141416',
  surfaceHover: '#1C1C1F',
  text: '#FAFAFA',
  textSecondary: '#A1A1A6',
  textMuted: '#636366',
  textDim: '#48484A',
  border: 'rgba(255, 255, 255, 0.06)',
  borderAccent: 'rgba(0, 35, 149, 0.4)',
  glowBlue: 'rgba(0, 35, 149, 0.2)',
};

const getConstraintNumber = (constraint: any): number | undefined => {
  if (constraint == null) return undefined;
  if (typeof constraint === 'number') return constraint;
  if (typeof constraint.default === 'number') return constraint.default;
  if (typeof constraint.max === 'number') return constraint.max;
  return undefined;
};

const getModelMaxTokens = (model?: VeniceModel | null): number | undefined => {
  if (!model) return undefined;
  const c = model.model_spec?.constraints || {};
  for (const key of ['max_output_tokens', 'maxOutputTokens', 'max_tokens']) {
    const val = getConstraintNumber((c as any)[key]);
    if (val && val > 0) return val;
  }
  return model.model_spec?.availableContextTokens;
};

export default function SettingsScreen() {
  const router = useRouter();
  const [models, setModels] = useState<VeniceModel[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    loadStoredSettings<AppSettings>(DEFAULT_SETTINGS).then(setSettings);
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const res = await fetch(VENICE_MODELS_ENDPOINT, {
        headers: { Authorization: `Bearer ${VENICE_API_KEY}` },
      });
      const data = await res.json();
      setModels(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      console.error('Failed to load models:', e);
    }
  };

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      persistSettings(next);
      return next;
    });
  }, []);

  const handleModelSelect = useCallback((id: string) => {
    const model = models.find(m => m.id === id);
    if (!model) return;

    const updates: Partial<AppSettings> = { model: id };
    const c = model.model_spec?.constraints || {};

    const temp = getConstraintNumber(c.temperature);
    if (temp !== undefined) updates.temperature = temp;

    const topP = getConstraintNumber(c.top_p);
    if (topP !== undefined) updates.topP = topP;

    const maxT = getModelMaxTokens(model);
    if (maxT) updates.maxTokens = maxT;

    updateSettings(updates);
    setShowModels(false);
  }, [models, updateSettings]);

  const resetDefaults = useCallback(() => {
    const model = models.find(m => m.id === settings.model);
    if (!model) return;

    const c = model.model_spec?.constraints || {};
    const updates: Partial<AppSettings> = {
      temperature: getConstraintNumber(c.temperature) ?? DEFAULT_SETTINGS.temperature,
      topP: getConstraintNumber(c.top_p) ?? DEFAULT_SETTINGS.topP,
      maxTokens: getModelMaxTokens(model) ?? DEFAULT_SETTINGS.maxTokens,
      minP: DEFAULT_SETTINGS.minP,
      topK: DEFAULT_SETTINGS.topK,
      repetitionPenalty: DEFAULT_SETTINGS.repetitionPenalty,
    };

    updateSettings(updates);
    Alert.alert('Reset', 'Settings restored to defaults.');
  }, [models, settings.model, updateSettings]);

  const getModelName = (id: string) => {
    const m = models.find(x => x.id === id);
    return m?.model_spec?.name || id.split('/').pop() || id;
  };

  const currentModel = useMemo(() => models.find(m => m.id === settings.model), [models, settings.model]);
  const maxTokens = useMemo(() => getModelMaxTokens(currentModel) || 8192, [currentModel]);

  const renderSlider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    key: keyof AppSettings
  ) => (
    <View style={styles.sliderItem}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{value.toFixed(step < 1 ? 2 : 0)}</Text>
      </View>
      <Slider
        style={styles.slider}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={v => updateSettings({ [key]: v } as any)}
        minimumTrackTintColor={THEME.bleu}
        maximumTrackTintColor={THEME.border}
        thumbTintColor={THEME.bleu}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={THEME.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <TouchableOpacity onPress={resetDefaults} style={styles.resetBtn}>
          <Feather name="refresh-cw" size={18} color={THEME.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {/* Model Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Model</Text>
          <TouchableOpacity onPress={() => setShowModels(true)} style={styles.modelBtn}>
            <Text style={styles.modelBtnText}>{getModelName(settings.model)}</Text>
            <Feather name="chevron-right" size={18} color={THEME.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Web Search */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Web Search</Text>
          <View style={styles.segmented}>
            {(['off', 'auto', 'on'] as const).map(opt => (
              <TouchableOpacity
                key={opt}
                onPress={() => updateSettings({ webSearch: opt })}
                style={[styles.segment, settings.webSearch === opt && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, settings.webSearch === opt && styles.segmentTextActive]}>
                  {opt.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Capabilities */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Capabilities</Text>
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Venice System Prompt</Text>
              <Switch
                value={settings.includeVeniceSystemPrompt}
                onValueChange={v => updateSettings({ includeVeniceSystemPrompt: v })}
                trackColor={{ false: THEME.border, true: THEME.bleu }}
                thumbColor={THEME.blanc}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Web Citations</Text>
              <Switch
                value={settings.webCitations}
                onValueChange={v => updateSettings({ webCitations: v })}
                trackColor={{ false: THEME.border, true: THEME.bleu }}
                thumbColor={THEME.blanc}
              />
            </View>
          </View>
        </View>

        {/* Parameters */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Parameters</Text>
          <View style={styles.card}>
            {renderSlider('Temperature', settings.temperature, 0, 2, 0.01, 'temperature')}
            {renderSlider('Top P', settings.topP, 0, 1, 0.01, 'topP')}
            {renderSlider('Min P', settings.minP, 0, 1, 0.01, 'minP')}
            {renderSlider('Max Tokens', settings.maxTokens, 1, maxTokens, 1, 'maxTokens')}
            {renderSlider('Top K', settings.topK, 1, 100, 1, 'topK')}
            {renderSlider('Repetition Penalty', settings.repetitionPenalty, 1, 2, 0.01, 'repetitionPenalty')}
          </View>
        </View>

        {/* Reasoning Models */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reasoning</Text>
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View>
                <Text style={styles.switchLabel}>Strip Thinking</Text>
                <Text style={styles.switchHint}>Hide model's reasoning process</Text>
              </View>
              <Switch
                value={settings.stripThinking}
                onValueChange={v => updateSettings({ stripThinking: v })}
                trackColor={{ false: THEME.border, true: THEME.bleu }}
                thumbColor={THEME.blanc}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.switchRow}>
              <View>
                <Text style={styles.switchLabel}>Disable Thinking</Text>
                <Text style={styles.switchHint}>Skip reasoning entirely</Text>
              </View>
              <Switch
                value={settings.disableThinking}
                onValueChange={v => updateSettings({ disableThinking: v })}
                trackColor={{ false: THEME.border, true: THEME.bleu }}
                thumbColor={THEME.blanc}
              />
            </View>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Model Picker */}
      <Modal visible={showModels} animationType="slide" presentationStyle="formSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Model</Text>
            <TouchableOpacity onPress={() => setShowModels(false)} style={styles.modalClose}>
              <Feather name="x" size={24} color={THEME.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={models.filter(m => m.type !== 'image')}
            keyExtractor={m => m.id}
            contentContainerStyle={styles.modalList}
            renderItem={({ item }) => {
              const selected = settings.model === item.id;
              return (
                <TouchableOpacity
                  onPress={() => handleModelSelect(item.id)}
                  style={[styles.modelItem, selected && styles.modelItemSelected]}
                >
                  <View style={styles.modelInfo}>
                    <Text style={styles.modelName}>{item.model_spec?.name || item.id}</Text>
                    <Text style={styles.modelId}>{item.id}</Text>
                  </View>
                  {selected && (
                    <View style={styles.modelCheck}>
                      <Feather name="check" size={16} color={THEME.bleu} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.noir,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: THEME.text,
  },
  backBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resetBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Content
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
  },

  // Section
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },

  // Card
  card: {
    backgroundColor: THEME.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },

  // Model Button
  modelBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: THEME.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  modelBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: THEME.text,
  },

  // Segmented Control
  segmented: {
    flexDirection: 'row',
    backgroundColor: THEME.surface,
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: THEME.glowBlue,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.textMuted,
  },
  segmentTextActive: {
    color: THEME.bleu,
  },

  // Switch
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    fontSize: 15,
    color: THEME.text,
  },
  switchHint: {
    fontSize: 12,
    color: THEME.textMuted,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: THEME.border,
    marginVertical: 14,
  },

  // Slider
  sliderItem: {
    marginBottom: 18,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sliderLabel: {
    fontSize: 14,
    color: THEME.text,
  },
  sliderValue: {
    fontSize: 14,
    color: THEME.bleu,
    fontWeight: '600',
  },
  slider: {
    height: 32,
    marginHorizontal: -8,
  },

  // Modal
  modal: {
    flex: 1,
    backgroundColor: THEME.noir,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: THEME.text,
  },
  modalClose: {
    width: 36,
    height: 36,
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
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modelItemSelected: {
    borderColor: THEME.bleu,
    backgroundColor: THEME.glowBlue,
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    fontSize: 14,
    fontWeight: '500',
    color: THEME.text,
    marginBottom: 2,
  },
  modelId: {
    fontSize: 11,
    color: THEME.textMuted,
  },
  modelCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: THEME.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

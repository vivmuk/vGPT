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
  Switch,
  Platform,
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
import { VENICE_MODELS_ENDPOINT } from '@/constants/venice';

// ═══════════════════════════════════════════════════════════════════════════
// TERMINAL THEME — matches index.tsx
// ═══════════════════════════════════════════════════════════════════════════

const T = {
  bg: '#050508',
  surface: '#0A0A10',
  surfaceLight: '#111118',
  surfaceActive: '#1A1A24',

  green: '#00FF88',
  greenDim: 'rgba(0, 255, 136, 0.6)',
  greenGlow: 'rgba(0, 255, 136, 0.08)',
  greenBorder: 'rgba(0, 255, 136, 0.15)',

  cyan: '#00D4FF',
  cyanBorder: 'rgba(0, 212, 255, 0.15)',

  amber: '#FFB800',
  amberBorder: 'rgba(255, 184, 0, 0.2)',

  text: '#D4D4D8',
  textBright: '#FAFAFA',
  textMuted: '#52525B',
  textDim: '#3F3F46',

  border: 'rgba(255, 255, 255, 0.04)',
  white: '#FFFFFF',
  black: '#000000',
};

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

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
  for (const key of ['max_output_tokens', 'maxOutputTokens', 'max_tokens', 'response_tokens']) {
    const val = getConstraintNumber((c as any)[key]);
    if (val && val > 0) return val;
  }
  return undefined;
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
      const res = await fetch(VENICE_MODELS_ENDPOINT);
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
    <View style={s.sliderItem}>
      <View style={s.sliderHeader}>
        <Text style={s.sliderLabel}>// {label.toUpperCase()}</Text>
        <Text style={s.sliderValue}>{value.toFixed(step < 1 ? 2 : 0)}</Text>
      </View>
      <Slider
        style={s.slider}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={v => updateSettings({ [key]: v } as any)}
        minimumTrackTintColor={T.green}
        maximumTrackTintColor={T.border}
        thumbTintColor={T.green}
      />
    </View>
  );

  return (
    <SafeAreaView style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={18} color={T.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>// CONFIG</Text>
        <TouchableOpacity onPress={resetDefaults} style={s.resetBtn}>
          <Feather name="refresh-cw" size={16} color={T.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={s.content} contentContainerStyle={s.contentInner}>
        {/* Model Selection */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>// MODEL</Text>
          <TouchableOpacity onPress={() => setShowModels(true)} style={s.modelBtn}>
            <Text style={s.modelBtnText}>{getModelName(settings.model)}</Text>
            <Feather name="chevron-right" size={16} color={T.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Web Search */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>// WEB SEARCH</Text>
          <View style={s.segmented}>
            {(['off', 'auto', 'on'] as const).map(opt => (
              <TouchableOpacity
                key={opt}
                onPress={() => updateSettings({ webSearch: opt })}
                style={[s.segment, settings.webSearch === opt && s.segmentActive]}
              >
                <Text style={[s.segmentText, settings.webSearch === opt && s.segmentTextActive]}>
                  {opt.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Capabilities */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>// CAPABILITIES</Text>
          <View style={s.card}>
            <View style={s.switchRow}>
              <Text style={s.switchLabel}>venice_system_prompt</Text>
              <Switch
                value={settings.includeVeniceSystemPrompt}
                onValueChange={v => updateSettings({ includeVeniceSystemPrompt: v })}
                trackColor={{ false: T.border, true: T.green }}
                thumbColor={T.white}
              />
            </View>
            <View style={s.divider} />
            <View style={s.switchRow}>
              <Text style={s.switchLabel}>web_citations</Text>
              <Switch
                value={settings.webCitations}
                onValueChange={v => updateSettings({ webCitations: v })}
                trackColor={{ false: T.border, true: T.green }}
                thumbColor={T.white}
              />
            </View>
          </View>
        </View>

        {/* Parameters */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>// PARAMETERS</Text>
          <View style={s.card}>
            {renderSlider('Temperature', settings.temperature, 0, 2, 0.01, 'temperature')}
            {renderSlider('Top P', settings.topP, 0, 1, 0.01, 'topP')}
            {renderSlider('Min P', settings.minP, 0, 1, 0.01, 'minP')}
            {renderSlider('Max Tokens', settings.maxTokens, 1, maxTokens, 1, 'maxTokens')}
            {renderSlider('Top K', settings.topK, 1, 100, 1, 'topK')}
            {renderSlider('Rep Penalty', settings.repetitionPenalty, 1, 2, 0.01, 'repetitionPenalty')}
          </View>
        </View>

        {/* Reasoning */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>// REASONING</Text>
          <View style={s.card}>
            <View style={s.switchRow}>
              <View>
                <Text style={s.switchLabel}>strip_thinking</Text>
                <Text style={s.switchHint}>hide reasoning process</Text>
              </View>
              <Switch
                value={settings.stripThinking}
                onValueChange={v => updateSettings({ stripThinking: v })}
                trackColor={{ false: T.border, true: T.green }}
                thumbColor={T.white}
              />
            </View>
            <View style={s.divider} />
            <View style={s.switchRow}>
              <View>
                <Text style={s.switchLabel}>disable_thinking</Text>
                <Text style={s.switchHint}>skip reasoning entirely</Text>
              </View>
              <Switch
                value={settings.disableThinking}
                onValueChange={v => updateSettings({ disableThinking: v })}
                trackColor={{ false: T.border, true: T.green }}
                thumbColor={T.white}
              />
            </View>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Model Picker */}
      <Modal visible={showModels} animationType="slide" presentationStyle="formSheet">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>// SELECT MODEL</Text>
            <TouchableOpacity onPress={() => setShowModels(false)} style={s.modalClose}>
              <Text style={s.modalCloseText}>[x]</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={models.filter(m => m.type !== 'image')}
            keyExtractor={m => m.id}
            contentContainerStyle={s.modalList}
            renderItem={({ item }) => {
              const selected = settings.model === item.id;
              return (
                <TouchableOpacity
                  onPress={() => handleModelSelect(item.id)}
                  style={[s.modelItem, selected && s.modelItemSelected]}
                >
                  <View style={s.modelInfo}>
                    <Text style={[s.modelName, selected && { color: T.green }]}>
                      {selected ? '[*] ' : '[ ] '}
                      {item.model_spec?.name || item.id}
                    </Text>
                    <Text style={s.modelId}>{item.id}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.greenBorder,
  },
  headerTitle: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: '700',
    color: T.green,
    letterSpacing: 1,
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
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '700',
    color: T.textMuted,
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Card
  card: {
    backgroundColor: T.surface,
    borderRadius: 6,
    padding: 16,
    borderWidth: 1,
    borderColor: T.border,
  },

  // Model Button
  modelBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: T.surface,
    borderRadius: 6,
    padding: 14,
    borderWidth: 1,
    borderColor: T.greenBorder,
  },
  modelBtnText: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: '500',
    color: T.text,
  },

  // Segmented Control
  segmented: {
    flexDirection: 'row',
    backgroundColor: T.surface,
    borderRadius: 4,
    padding: 3,
    borderWidth: 1,
    borderColor: T.border,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 3,
  },
  segmentActive: {
    backgroundColor: T.greenGlow,
  },
  segmentText: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: '700',
    color: T.textMuted,
    letterSpacing: 0.5,
  },
  segmentTextActive: {
    color: T.green,
  },

  // Switch
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    fontFamily: MONO,
    fontSize: 12,
    color: T.text,
  },
  switchHint: {
    fontFamily: MONO,
    fontSize: 10,
    color: T.textDim,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: T.border,
    marginVertical: 14,
  },

  // Slider
  sliderItem: {
    marginBottom: 16,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sliderLabel: {
    fontFamily: MONO,
    fontSize: 10,
    color: T.textMuted,
    letterSpacing: 0.5,
  },
  sliderValue: {
    fontFamily: MONO,
    fontSize: 12,
    color: T.green,
    fontWeight: '700',
  },
  slider: {
    height: 32,
    marginHorizontal: -8,
  },

  // Modal
  modal: {
    flex: 1,
    backgroundColor: T.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: T.greenBorder,
  },
  modalTitle: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: '700',
    color: T.green,
    letterSpacing: 1,
  },
  modalClose: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    fontFamily: MONO,
    fontSize: 14,
    color: T.textMuted,
    fontWeight: '700',
  },
  modalList: {
    padding: 16,
  },
  modelItem: {
    padding: 12,
    borderRadius: 4,
    marginBottom: 4,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modelItemSelected: {
    borderColor: T.greenBorder,
    backgroundColor: T.greenGlow,
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '500',
    color: T.text,
  },
  modelId: {
    fontFamily: MONO,
    fontSize: 10,
    color: T.textDim,
    marginTop: 3,
    marginLeft: 24,
  },
});

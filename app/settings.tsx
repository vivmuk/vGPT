import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView,
  Alert,
  Modal,
  FlatList,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

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
    };
    modelSource: string;
    offline: boolean;
    traits: string[];
    beta?: boolean;
  };
}

export default function SettingsScreen() {
  const router = useRouter();
  
  const [models, setModels] = useState<VeniceModel[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  
  // Settings with localStorage persistence
  const [settings, setSettings] = useState({
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

  const updateSettings = (newSettings: Partial<typeof settings>) => {
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

  const handleSliderChange = (key: string, value: number) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    updateSettings({ [key]: value });
  };

  const handleWebSearchChange = (value: 'off' | 'auto' | 'on') => {
    updateSettings({ webSearch: value });
  };

  const handleModelSelect = (modelId: string) => {
    updateSettings({ model: modelId });
    setShowModelPicker(false);
  };

  const getModelDisplayName = (modelId: string) => {
    const model = models.find(m => m.id === modelId);
    return model?.model_spec.name || modelId;
  };

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
    key: string,
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
        {getSettingExplanation(key)}
      </Text>
      
      <View style={styles.sliderContainer}>
        <TouchableOpacity 
          style={styles.sliderButton}
          onPress={() => handleSliderChange(key, Math.max(min, value - step))}
        >
          <Ionicons name="remove" size={16} color={color} />
        </TouchableOpacity>
        
        <Slider
          style={styles.slider}
          minimumValue={min}
          maximumValue={max}
          step={step}
          value={value}
          onValueChange={(val) => handleSliderChange(key, val)}
          minimumTrackTintColor={color}
          maximumTrackTintColor="#E0E0E0"
          thumbStyle={{ backgroundColor: color }}
        />
        
        <TouchableOpacity 
          style={styles.sliderButton}
          onPress={() => handleSliderChange(key, Math.min(max, value + step))}
        >
          <Ionicons name="add" size={16} color={color} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderModelItem = ({ item }: { item: VeniceModel }) => (
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
  );



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
        {renderSliderSetting('Max Tokens', '📝', settings.maxTokens, 1, 8192, 1, 'maxTokens', '#4CAF50')}
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
              <Text>Loading models...</Text>
            </View>
          ) : (
            <FlatList
              data={models}
              renderItem={renderModelItem}
              keyExtractor={(item) => item.id}
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
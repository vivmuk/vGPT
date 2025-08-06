import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useAction, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  id: string;
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
    };
    modelSource: string;
    offline: boolean;
    traits: string[];
    beta?: boolean;
  };
}

export default function ChatScreen() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<VeniceModel[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  
  const sendMessage = useAction(api.venice.sendMessage);
  const getModels = useAction(api.venice.getModels);
  const settings = useQuery(api.settings.get);
  const updateSettings = useMutation(api.settings.update);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    setIsLoadingModels(true);
    try {
      const modelData = await getModels();
      setModels(modelData);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleModelSelect = (modelId: string) => {
    updateSettings({ model: modelId });
    setShowModelPicker(false);
  };

  const handleSend = async () => {
    if (!message.trim() || isLoading || !settings) return;

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const userMessage = message.trim();
    const newUserMessage: Message = {
      role: 'user',
      content: userMessage,
      id: Date.now().toString(),
    };

    setMessages(prev => [...prev, newUserMessage]);
    setMessage('');
    setIsLoading(true);

    try {
      // Prepare conversation history
      const conversationHistory = [
        ...messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: 'user' as const, content: userMessage }
      ];

      // Send to Venice AI
      const response = await sendMessage({
        messages: conversationHistory,
        model: settings.model,
        temperature: settings.temperature,
        topP: settings.topP,
        minP: settings.minP,
        maxTokens: settings.maxTokens,
        topK: settings.topK,
        repetitionPenalty: settings.repetitionPenalty,
        webSearch: settings.webSearch,
        webCitations: settings.webCitations,
        includeSearchResults: settings.includeSearchResults,
        stripThinking: settings.stripThinking,
        disableThinking: settings.disableThinking,
      });

      // Add AI response
      const aiMessage: Message = {
        role: 'assistant',
        content: response.content,
        id: (Date.now() + 1).toString(),
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
  };

  const getModelDisplayName = (modelId: string) => {
    const model = models.find(m => m.id === modelId);
    return model?.model_spec.name || modelId;
  };

  const renderMessage = (msg: Message, index: number) => {
    const isUser = msg.role === 'user';
    
    return (
      <View key={msg.id} style={[
        styles.messageContainer,
        isUser ? styles.userMessageContainer : styles.assistantMessageContainer
      ]}>
        <View style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.assistantBubble
        ]}>
          <Text style={[
            styles.messageText,
            isUser ? styles.userText : styles.assistantText
          ]}>
            {msg.content}
          </Text>
        </View>
      </View>
    );
  };

  if (!settings) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
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
            >
              <Text style={styles.modelText}>
                {getModelDisplayName(settings.model)}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#FF6B47" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.settingsButton}
              onPress={() => router.push('/settings')}
            >
              <Ionicons name="settings" size={20} color="#FF6B47" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.newChatButton}
              onPress={handleNewChat}
            >
              <Ionicons name="add" size={24} color="#FF6B47" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Messages */}
        <ScrollView 
          ref={scrollViewRef}
          style={styles.messagesContainer}
          contentContainerStyle={messages.length === 0 ? styles.emptyState : styles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 ? (
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
          ) : (
            messages.map((msg, index) => renderMessage(msg, index))
          )}
          
          {isLoading && (
            <View style={styles.loadingMessage}>
              <View style={styles.assistantBubble}>
                <View style={styles.typingIndicator}>
                  <View style={[styles.typingDot, { animationDelay: '0ms' }]} />
                  <View style={[styles.typingDot, { animationDelay: '150ms' }]} />
                  <View style={[styles.typingDot, { animationDelay: '300ms' }]} />
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Input */}
        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.textInput}
              placeholder="Message..."
              placeholderTextColor="#999"
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={4000}
              editable={!isLoading}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!message.trim() || isLoading) && styles.sendButtonDisabled
              ]}
              onPress={handleSend}
              disabled={!message.trim() || isLoading}
            >
              <Ionicons name="arrow-up" size={20} color="white" />
            </TouchableOpacity>
          </View>
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
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.modelItem,
                    settings?.model === item.id && styles.selectedModelItem
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
                  
                  {settings?.model === item.id && (
                    <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
                  )}
                </TouchableOpacity>
              )}
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
  loadingMessage: {
    paddingHorizontal: 16,
    marginVertical: 4,
    alignItems: 'flex-start',
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#CCC',
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
});
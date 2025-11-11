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
import { loadStoredSettings } from '@/utils/settingsStorage';
import { theme } from '@/constants/theme';
import {
  VENICE_API_KEY,
  VENICE_CHAT_COMPLETIONS_ENDPOINT,
  VENICE_MODELS_ENDPOINT,
  VENICE_IMAGE_GENERATIONS_ENDPOINT,
} from '@/constants/venice';

// NOTE: For brevity, types and helpers are in this file. In a real app, they'd be separate.
interface Message {
  role: 'user' | 'assistant';
  content: string;
  id: string;
}

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
  const [isLoading, setIsLoading] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const composerY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadStoredSettings<AppSettings>(DEFAULT_SETTINGS).then(setSettings);
  }, []);

  useEffect(() => {
    // Animate composer to its place based on messages
    Animated.timing(composerY, {
      toValue: messages.length > 0 ? 0 : -(height / 2) + 150,
      duration: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [messages.length, height]);

  const handleSend = () => {
    if (!message.trim()) return;
    const newMessage = { role: 'user', content: message.trim(), id: Date.now().toString() };
    setMessages(prev => [...prev, newMessage]);
    setMessage('');
    setIsLoading(true);

    // Mock AI response for UI testing
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'assistant', content: `Echo: ${newMessage.content}`, id: Date.now().toString() }]);
      setIsLoading(false);
    }, 1500);
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
        <TouchableOpacity style={styles.headerButton} onPress={() => router.push('/settings')}>
          <Ionicons name="settings-outline" size={22} color={palette.textSecondary} />
        </TouchableOpacity>
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
                  data={messages}
                  renderItem={renderMessageItem}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContentContainer}
                />
              )}
            </View>
          )}

          {activeTab === 'image' && (
            <View style={styles.imageContainer}>
                <View style={styles.welcomeContainer}>
                    <Ionicons name="image-outline" size={48} color={palette.neon.pink} />
                    <Text style={styles.welcomeTitle}>Image Generation</Text>
                    <Text style={styles.welcomeSubtitle}>Describe the image you want to create.</Text>
                </View>
            </View>
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
                  <Ionicons name="arrow-up-circle" size={32} color={palette.neon_cyan} />
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.textInput}
                  placeholder="Describe an image..."
                  placeholderTextColor={palette.textMuted}
                  multiline
                />
                <TouchableOpacity style={styles.sendButton}>
                  <Ionicons name="sparkles-outline" size={32} color={palette.neon_pink} />
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
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
        justifyContent: 'center',
        alignItems: 'center'
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
});

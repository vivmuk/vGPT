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
  LayoutChangeEvent,
  Animated,
  Easing,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
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
} from '@/constants/venice';

// Helper components and types will be moved to separate files in a real app
// For simplicity, they are included here.

interface Message {
  role: 'user' | 'assistant';
  content: string;
  id: string;
}

const palette = theme.colors;
const space = theme.spacing;
const radii = theme.radius;
const fonts = theme.fonts;

// A simple hook to manage keyboard state
const useKeyboard = () => {
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const keyboardDidShowListener = Platform.OS === 'web' 
      ? () => setKeyboardVisible(true) 
      : require('react-native').Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
      
    const keyboardDidHideListener = Platform.OS === 'web'
      ? () => setKeyboardVisible(false)
      : require('react-native').Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));

    return () => {
      if (Platform.OS !== 'web') {
        keyboardDidShowListener.remove();
        keyboardDidHideListener.remove();
      }
    };
  }, []);

  return isKeyboardVisible;
};


export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isMobile = width < 768;
  
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  
  const flatListRef = useRef<FlatList>(null);
  const composerY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadStoredSettings<AppSettings>(DEFAULT_SETTINGS).then(stored => {
      setSettings(prev => ({ ...prev, ...stored }));
    });
  }, []);

  useEffect(() => {
    // Animate composer to bottom when messages appear
    Animated.timing(composerY, {
      toValue: messages.length > 0 ? 0 : height / 2 - 100, // Center-ish
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [messages.length, height]);

  const handleSend = () => {
    if (!message.trim()) return;
    const newMessage: Message = { role: 'user', content: message.trim(), id: Date.now().toString() };
    setMessages(prev => [...prev, newMessage]);
    setMessage('');
    setIsLoading(true);

    // Mock AI response
    setTimeout(() => {
      const aiResponse: Message = { role: 'assistant', content: `This is a simulated response to: "${newMessage.content}"`, id: Date.now().toString() };
      setMessages(prev => [...prev, aiResponse]);
      setIsLoading(false);
    }, 1500);
  };
  
  const renderMessageItem = ({ item }: { item: Message }) => (
    <View style={[
      styles.messageRow,
      item.role === 'user' ? styles.userMessageRow : styles.assistantMessageRow
    ]}>
      <View style={[
        styles.messageBubble,
        item.role === 'user' ? styles.userMessageBubble : styles.assistantMessageBubble
      ]}>
        <Text style={styles.messageText}>{item.content}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView 
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 25}
      >
        <View style={styles.header}>
            <View style={styles.logo}>
                <Text style={styles.logoIcon}>✨</Text>
                <Text style={styles.logoText}>vGPT</Text>
            </View>
            <TouchableOpacity style={styles.headerButton} onPress={() => router.push('/settings')}>
                <Ionicons name="settings-outline" size={22} color={palette.textSecondary} />
            </TouchableOpacity>
        </View>

        <View style={styles.chatContainer}>
          {messages.length === 0 && !isLoading && (
             <View style={styles.welcomeContainer}>
                <Text style={styles.welcomeTitle}>Ready to Chat?</Text>
                <Text style={styles.welcomeSubtitle}>Start a conversation below.</Text>
             </View>
          )}

          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessageItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContentContainer}
            style={{ flex: 1 }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />

          {isLoading && (
            <View style={styles.typingIndicatorContainer}>
                <View style={styles.typingDot} />
                <View style={[styles.typingDot, { animationDelay: '0.2s' }]} />
                <View style={[styles.typingDot, { animationDelay: '0.4s' }]} />
            </View>
          )}
        </View>
        
        <Animated.View style={[
          styles.composer, 
          { 
            bottom: insets.bottom,
            transform: [{ translateY: composerY }]
          }
        ]}>
            <TextInput
              style={styles.textInput}
              placeholder="Message vGPT..."
              placeholderTextColor={palette.textMuted}
              value={message}
              onChangeText={setMessage}
              multiline
              editable={!isLoading}
            />
            <TouchableOpacity 
              style={[styles.sendButton, (!message.trim() || isLoading) && styles.sendButtonDisabled]} 
              onPress={handleSend}
              disabled={!message.trim() || isLoading}
            >
              <Ionicons name="arrow-up-circle" size={32} color={palette.neon_cyan} />
            </TouchableOpacity>
        </Animated.View>

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
  logoIcon: {
      fontSize: 24,
  },
  logoText: {
      fontSize: 20,
      fontFamily: fonts.semibold,
      color: palette.textPrimary,
  },
  headerButton: {
    padding: space.sm,
  },
  chatContainer: {
    flex: 1,
    paddingHorizontal: space.lg,
  },
  listContentContainer: {
    paddingTop: space.lg,
    paddingBottom: 100, // Space for composer
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 200,
  },
  welcomeTitle: {
    fontSize: 32,
    fontFamily: fonts.bold,
    color: palette.textPrimary,
    marginBottom: space.sm,
    textShadowColor: palette.neon.cyan,
    textShadowRadius: 10,
  },
  welcomeSubtitle: {
    fontSize: 16,
    fontFamily: fonts.regular,
    color: palette.textSecondary,
  },
  messageRow: {
    marginVertical: space.sm,
    flexDirection: 'row',
  },
  userMessageRow: {
    justifyContent: 'flex-end',
  },
  assistantMessageRow: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '85%',
    padding: space.md,
    borderRadius: radii.lg,
  },
  userMessageBubble: {
    backgroundColor: palette.neon.cyan,
    borderBottomRightRadius: radii.sm,
  },
  assistantMessageBubble: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderBottomLeftRadius: radii.sm,
  },
  messageText: {
    fontSize: 16,
    color: palette.black,
    fontFamily: fonts.regular,
  },
  typingIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.md,
    marginLeft: space.sm,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.neon.pink,
    marginHorizontal: 2,
    // Note: 'animationDelay' is a web-only concept.
    // For native, you'd use Animated.sequence with delays.
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    position: 'absolute',
    left: 0,
    right: 0,
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
    fontFamily: fonts.regular,
  },
  sendButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});

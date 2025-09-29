import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

const STORAGE_KEY = 'vgpt-settings';
const SETTINGS_FILE_PATH = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}${STORAGE_KEY}.json`
  : null;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type SettingsLike = Record<string, JsonValue>;

export async function loadStoredSettings<T extends SettingsLike>(defaults: T): Promise<T> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') {
        return defaults;
      }

      const savedSettings = localStorage.getItem(STORAGE_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (parsed && typeof parsed === 'object') {
          return { ...defaults, ...parsed };
        }
      }

      return defaults;
    }

    if (!SETTINGS_FILE_PATH) {
      return defaults;
    }

    const fileInfo = await FileSystem.getInfoAsync(SETTINGS_FILE_PATH);
    if (!fileInfo.exists) {
      return defaults;
    }

    const stored = await FileSystem.readAsStringAsync(SETTINGS_FILE_PATH);
    const parsed = JSON.parse(stored);

    if (parsed && typeof parsed === 'object') {
      return { ...defaults, ...parsed };
    }

    return defaults;
  } catch (error) {
    console.warn('Failed to load persisted settings', error);
    return defaults;
  }
}

export async function persistSettings<T extends SettingsLike>(settings: T): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') {
        return;
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return;
    }

    if (!SETTINGS_FILE_PATH) {
      return;
    }

    await FileSystem.writeAsStringAsync(SETTINGS_FILE_PATH, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to persist settings', error);
  }
}

/* eslint-disable max-lines, max-lines-per-function, complexity */
/**
 * Remote Server Configuration Modal
 *
 * Modal for adding and editing remote LLM server configurations.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme/palettes';
import { AppSheet } from '../AppSheet';
import { remoteServerManager } from '../../services/remoteServerManager';
import { useRemoteServerStore } from '../../stores';
import { RemoteServer, RemoteModel } from '../../types';
import { isPrivateNetworkEndpoint } from '../../services/httpClient';

interface RemoteServerModalProps {
  visible: boolean;
  onClose: () => void;
  server?: RemoteServer; // For editing existing server
  onSave?: (server: RemoteServer) => void;
}

function createStyles(colors: ThemeColors, _shadows: ThemeShadows) {
  return {
    container: {
      // No flex: 1 - let content size naturally with enableDynamicSizing
    },
    content: {
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    label: {
      fontSize: 14,
      fontWeight: '600' as const,
      color: colors.textSecondary,
      marginBottom: 6,
      marginTop: 16,
    },
    input: {
      backgroundColor: colors.surfaceLight,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
    },
    inputError: {
      borderWidth: 1,
      borderColor: colors.error,
    },
    errorText: {
      color: colors.error,
      fontSize: 12,
      marginTop: 4,
    },
    warningContainer: {
      backgroundColor: colors.errorBackground,
      borderRadius: 8,
      padding: 12,
      marginTop: 12,
    },
    warningText: {
      color: colors.error,
      fontSize: 13,
    },
    helperText: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 4,
    },
    buttonRow: {
      flexDirection: 'row' as const,
      gap: 10,
      marginTop: 16,
    },
    testButton: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 12,
      alignItems: 'center' as const,
      flexDirection: 'row' as const,
      justifyContent: 'center' as const,
    },
    testButtonDisabled: {
      backgroundColor: colors.surfaceLight,
    },
    testButtonText: {
      color: colors.background,
      fontSize: 15,
      fontWeight: '600' as const,
    },
    testButtonTextDisabled: {
      color: colors.textMuted,
    },
    saveButton: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 12,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    saveButtonDisabled: {
      backgroundColor: colors.surfaceLight,
    },
    saveButtonText: {
      color: colors.background,
      fontSize: 15,
      fontWeight: '600' as const,
    },
    saveButtonTextDisabled: {
      color: colors.textMuted,
    },
    modelList: {
      marginTop: 8,
    },
    modelScroll: {
      maxHeight: 81,
    },
    modelItem: {
      backgroundColor: colors.surfaceLight,
      borderRadius: 6,
      paddingVertical: 4,
      paddingHorizontal: 8,
      marginBottom: 3,
    },
    modelName: {
      fontSize: 13,
      fontWeight: '500' as const,
      color: colors.text,
    },
    statusContainer: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      marginTop: 8,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginRight: 8,
    },
    statusDotSuccess: {
      backgroundColor: colors.success,
    },
    statusDotError: {
      backgroundColor: colors.error,
    },
    statusText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    sectionHeader: {
      fontSize: 16,
      fontWeight: '600' as const,
      color: colors.text,
      marginTop: 20,
      marginBottom: 8,
    },
    notesInput: {
      minHeight: 80,
      textAlignVertical: 'top' as const,
    },
  };
}

export const RemoteServerModal: React.FC<RemoteServerModalProps> = ({
  visible,
  onClose,
  server,
  onSave,
}) => {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  // Form state
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [notes, setNotes] = useState('');

  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<RemoteModel[]>([]);

  // Initialize form when editing existing server
  useEffect(() => {
    if (server) {
      setName(server.name);
      setEndpoint(server.endpoint);
      setNotes(server.notes || '');
      // API key is not loaded back for security - user must re-enter if they want to change it
    } else {
      // Reset form for new server
      setName('');
      setEndpoint('');
      setNotes('');
    }
    setErrors({});
    setTestResult(null);
    setDiscoveredModels([]);
  }, [server, visible]);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Server name is required';
    }

    if (!endpoint.trim()) {
      newErrors.endpoint = 'Endpoint URL is required';
    } else {
      try {
        // Validate URL format by parsing it - constructor throws on invalid URLs
        const _validUrl = new URL(endpoint);
      } catch {
        newErrors.endpoint = 'Invalid URL format';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, endpoint]);

  const handleTestConnection = useCallback(async () => {
    if (!validateForm()) return;

    setIsTesting(true);
    setTestResult(null);
    setDiscoveredModels([]);

    try {
      const result = await remoteServerManager.testConnectionByEndpoint(endpoint);

      if (result.success) {
        setTestResult({ success: true, message: `Connected (${result.latency}ms)` });
        if (result.models) {
          setDiscoveredModels(result.models);
        }
      } else {
        setTestResult({ success: false, message: result.error || 'Connection failed' });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsTesting(false);
    }
  }, [endpoint, validateForm]);

  const handleSave = useCallback(async () => {
    if (!validateForm()) return;

    // Warn if connecting to public internet
    if (endpoint && !isPrivateNetworkEndpoint(endpoint)) {
      Alert.alert(
        'Public Network Warning',
        'This endpoint appears to be on the public internet. Your data will be sent to a remote server. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: () => saveServer() },
        ]
      );
    } else {
      saveServer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validateForm, endpoint]);

  const saveServer = useCallback(async () => {
    try {
      if (server) {
        // Update existing server
        await remoteServerManager.updateServer(server.id, {
          name,
          endpoint,
          notes,
        });
        // Save discovered models to store
        if (discoveredModels.length > 0) {
          useRemoteServerStore.getState().setDiscoveredModels(server.id, discoveredModels);
        }
        onSave?.(server);
      } else {
        // Add new server
        const newServer = await remoteServerManager.addServer({
          name,
          endpoint,
          providerType: 'openai-compatible',
          notes: notes || undefined,
        });
        // Save discovered models to store
        if (discoveredModels.length > 0) {
          useRemoteServerStore.getState().setDiscoveredModels(newServer.id, discoveredModels);
        }
        // Silently probe health so status shows immediately instead of "Unknown"
        remoteServerManager.testConnection(newServer.id).catch(() => {});
        onSave?.(newServer);
      }
      onClose();
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to save server'
      );
    }
  }, [server, name, endpoint, notes, discoveredModels, onSave, onClose]);

  const isPublicNetwork = endpoint && !isPrivateNetworkEndpoint(endpoint);

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title={server ? 'Edit Server' : 'Add Remote Server'}
      snapPoints={['80%']}
      enableDynamicSizing
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.label}>Server Name</Text>
        <TextInput
          style={[styles.input, errors.name && styles.inputError]}
          placeholder="e.g., Ollama Desktop"
          placeholderTextColor={theme.colors.textMuted}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        {errors.name && <Text style={styles.errorText}>{errors.name}</Text>}

        <Text style={styles.label}>Endpoint URL</Text>
        <TextInput
          style={[styles.input, errors.endpoint && styles.inputError]}
          placeholder="http://192.168.1.50:11434"
          placeholderTextColor={theme.colors.textMuted}
          value={endpoint}
          onChangeText={setEndpoint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {errors.endpoint && <Text style={styles.errorText}>{errors.endpoint}</Text>}
        {isPublicNetwork && (
          <View style={styles.warningContainer}>
            <Text style={styles.warningText}>
              ⚠️ This endpoint is on the public internet. Your data will be sent to a remote server.
            </Text>
          </View>
        )}
        <Text style={styles.helperText}>
          Enter the base URL of your LLM server (Ollama, LM Studio, etc.)
        </Text>

        <Text style={styles.label}>Notes (Optional)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          placeholder="Add notes about this server..."
          placeholderTextColor={theme.colors.textMuted}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        {testResult && (
          <View style={styles.statusContainer}>
            <View
              style={[
                styles.statusDot,
                testResult.success ? styles.statusDotSuccess : styles.statusDotError,
              ]}
            />
            <Text style={styles.statusText}>{testResult.message}</Text>
          </View>
        )}

        {discoveredModels.length > 0 && (
          <View style={styles.modelList}>
            <Text style={styles.sectionHeader}>Discovered Models</Text>
            <ScrollView style={styles.modelScroll} nestedScrollEnabled>
              {discoveredModels.map((model) => (
                <View key={model.id} style={styles.modelItem}>
                  <Text style={styles.modelName}>{model.name}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.testButton, isTesting && styles.testButtonDisabled]}
            onPress={handleTestConnection}
            disabled={isTesting}
          >
            {isTesting ? (
              <ActivityIndicator size="small" color={theme.colors.background} />
            ) : (
              <Text style={[styles.testButtonText, isTesting && styles.testButtonTextDisabled]}>
                Test Connection
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveButton, !testResult?.success && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={!testResult?.success}
          >
            <Text style={[styles.saveButtonText, !testResult?.success && styles.saveButtonTextDisabled]}>
              {server ? 'Update Server' : 'Add Server'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </AppSheet>
  );
};

export default RemoteServerModal;
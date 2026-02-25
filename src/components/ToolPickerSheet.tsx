import React from 'react';
import { View, Text, Switch } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from './AppSheet';
import { useTheme, useThemedStyles } from '../theme';
import { FONTS } from '../constants';
import { AVAILABLE_TOOLS } from '../services/tools';
import type { ThemeColors, ThemeShadows } from '../theme';

interface ToolPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  enabledTools: string[];
  onToggleTool: (toolId: string) => void;
}

export const ToolPickerSheet: React.FC<ToolPickerSheetProps> = ({
  visible,
  onClose,
  enabledTools,
  onToggleTool,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      enableDynamicSizing
      title="Tools"
    >
      <View style={styles.container}>
        {AVAILABLE_TOOLS.map(tool => {
          const isEnabled = enabledTools.includes(tool.id);
          return (
            <View key={tool.id} style={styles.toolRow} testID={`tool-picker-row-${tool.id}`}>
              <View style={styles.toolIcon}>
                <Icon name={tool.icon} size={20} color={isEnabled ? colors.primary : colors.textMuted} />
              </View>
              <View style={styles.toolInfo}>
                <View style={styles.toolNameRow}>
                  <Text style={styles.toolName} testID={`tool-picker-name-${tool.id}`}>{tool.displayName}</Text>
                  {tool.requiresNetwork && (
                    <Icon name="wifi" size={12} color={colors.textMuted} style={styles.networkIcon} />
                  )}
                </View>
                <Text style={styles.toolDescription}>{tool.description}</Text>
              </View>
              <Switch
                value={isEnabled}
                onValueChange={() => onToggleTool(tool.id)}
                trackColor={{ false: colors.border, true: `${colors.primary}80` }}
                thumbColor={isEnabled ? colors.primary : colors.textMuted}
              />
            </View>
          );
        })}
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  toolRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 12,
  },
  toolInfo: {
    flex: 1,
    marginRight: 12,
  },
  toolNameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  toolName: {
    fontSize: 15,
    fontFamily: FONTS.mono,
    fontWeight: '600' as const,
    color: colors.text,
  },
  networkIcon: {
    marginLeft: 6,
  },
  toolDescription: {
    fontSize: 12,
    fontFamily: FONTS.mono,
    color: colors.textMuted,
    marginTop: 2,
  },
});

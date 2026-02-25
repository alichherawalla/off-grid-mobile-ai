import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useThemedStyles, useTheme } from '../theme';
import { createStyles } from './ModelCard.styles';
import { huggingFaceService } from '../services/huggingface';
import { ModelCredibility } from '../types';
import { triggerHaptic } from '../utils/haptics';

interface CredibilityInfo {
  color: string;
  label: string;
}

// ── Compact header (name + author tag + optional downloads + description + type badges) ──

interface CompactModelCardContentProps {
  model: {
    name: string;
    author: string;
    description?: string;
    downloads?: number;
    modelType?: 'text' | 'vision' | 'code';
    paramCount?: number;
    minRamGB?: number;
  };
  credibility?: ModelCredibility;
  credibilityInfo: CredibilityInfo | null;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

type ModelType = 'text' | 'vision' | 'code';

function modelTypeLabel(modelType: ModelType): string {
  if (modelType === 'vision') return 'Vision';
  if (modelType === 'code') return 'Code';
  return 'Text';
}

function modelTypeBadgeStyle(
  styles: ReturnType<typeof createStyles>,
  modelType: ModelType,
) {
  if (modelType === 'vision') return styles.visionBadge;
  if (modelType === 'code') return styles.codeBadge;
  return null;
}

function modelTypeTextStyle(
  styles: ReturnType<typeof createStyles>,
  modelType: ModelType,
) {
  if (modelType === 'vision') return styles.visionText;
  if (modelType === 'code') return styles.codeText;
  return null;
}

export const CompactModelCardContent: React.FC<CompactModelCardContentProps> = ({
  model,
  credibility,
  credibilityInfo,
}) => {
  const styles = useThemedStyles(createStyles);

  return (
    <>
      <View style={styles.compactTopRow}>
        <View style={styles.compactNameGroup}>
          <Text style={[styles.name, styles.compactName]} numberOfLines={1}>
            {model.name}
          </Text>
          <View style={styles.authorTag}>
            <Text style={styles.authorTagText}>{model.author}</Text>
          </View>
          {credibilityInfo && (
            <View style={[styles.credibilityBadge, { backgroundColor: `${credibilityInfo.color}25` }]}>
              {credibility?.source === 'lmstudio' && (
                <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>★</Text>
              )}
              <Text style={[styles.credibilityText, { color: credibilityInfo.color }]}>
                {credibilityInfo.label}
              </Text>
            </View>
          )}
        </View>
        {model.downloads !== undefined && model.downloads > 0 && (
          <View style={styles.authorTag}>
            <Text style={styles.authorTagText}>{formatNumber(model.downloads)} dl</Text>
          </View>
        )}
      </View>
      {model.description && (
        <Text style={styles.descriptionCompact} numberOfLines={1}>
          {model.description}
        </Text>
      )}
      {(model.modelType || model.paramCount) && (
        <View style={[styles.infoRow, styles.infoRowCompact]}>
          {model.modelType && (
            <View style={[styles.infoBadge, modelTypeBadgeStyle(styles, model.modelType)]}>
              <Text style={[styles.infoText, modelTypeTextStyle(styles, model.modelType)]}>
                {modelTypeLabel(model.modelType)}
              </Text>
            </View>
          )}
          {model.paramCount && (
            <View style={styles.infoBadge}>
              <Text style={styles.infoText}>{model.paramCount}B params</Text>
            </View>
          )}
          {model.minRamGB && (
            <View style={styles.infoBadge}>
              <Text style={styles.infoText}>{model.minRamGB}GB+ RAM</Text>
            </View>
          )}
        </View>
      )}
    </>
  );
};

// ── Standard (non-compact) header ──

interface StandardModelCardContentProps {
  model: {
    name: string;
    author: string;
    description?: string;
  };
  credibility?: ModelCredibility;
  credibilityInfo: CredibilityInfo | null;
  isActive?: boolean;
}

export const StandardModelCardContent: React.FC<StandardModelCardContentProps> = ({
  model,
  credibility,
  credibilityInfo,
  isActive,
}) => {
  const styles = useThemedStyles(createStyles);

  return (
    <>
      <Text style={styles.name}>{model.name}</Text>
      <View style={styles.authorRow}>
        <View style={styles.authorTag}>
          <Text style={styles.authorTagText}>{model.author}</Text>
        </View>
        {credibilityInfo && (
          <View style={[styles.credibilityBadge, { backgroundColor: `${credibilityInfo.color}25` }]}>
            {credibility?.source === 'lmstudio' && (
              <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>★</Text>
            )}
            {credibility?.source === 'official' && (
              <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>✓</Text>
            )}
            {credibility?.source === 'verified-quantizer' && (
              <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>◆</Text>
            )}
            <Text style={[styles.credibilityText, { color: credibilityInfo.color }]}>
              {credibilityInfo.label}
            </Text>
          </View>
        )}
        {isActive && (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>Active</Text>
          </View>
        )}
      </View>
      {model.description && (
        <Text style={styles.description} numberOfLines={2}>
          {model.description}
        </Text>
      )}
    </>
  );
};

// ── Info badges row (size, quant, vision, compatibility) ──

interface ModelInfoBadgesProps {
  fileSize: number;
  sizeRange: { min: number; max: number; count: number } | null;
  quantInfo: { quality: string; recommended: boolean } | null;
  quantization: string | undefined;
  isVisionModel: boolean;
  isCompatible: boolean;
  incompatibleReason: string | undefined;
}

export const ModelInfoBadges: React.FC<ModelInfoBadgesProps> = ({
  fileSize,
  sizeRange,
  quantInfo,
  quantization,
  isVisionModel,
  isCompatible,
  incompatibleReason,
}) => {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.infoRow}>
      {fileSize > 0 && (
        <View style={styles.infoBadge}>
          <Text style={styles.infoText}>{huggingFaceService.formatFileSize(fileSize)}</Text>
        </View>
      )}
      {sizeRange && (
        <View style={[styles.infoBadge, styles.sizeBadge]}>
          <Text style={styles.infoText}>
            {sizeRange.min === sizeRange.max
              ? huggingFaceService.formatFileSize(sizeRange.min)
              : `${huggingFaceService.formatFileSize(sizeRange.min)} - ${huggingFaceService.formatFileSize(sizeRange.max)}`}
          </Text>
        </View>
      )}
      {sizeRange && (
        <View style={styles.infoBadge}>
          <Text style={styles.infoText}>
            {sizeRange.count} {sizeRange.count === 1 ? 'file' : 'files'}
          </Text>
        </View>
      )}
      {quantInfo && (
        <View style={[styles.infoBadge, quantInfo.recommended && styles.recommendedBadge]}>
          <Text style={[styles.infoText, quantInfo.recommended && styles.recommendedText]}>
            {quantization}
          </Text>
        </View>
      )}
      {quantInfo && (
        <View style={styles.infoBadge}>
          <Text style={styles.infoText}>{quantInfo.quality}</Text>
        </View>
      )}
      {isVisionModel && (
        <View style={styles.visionBadge}>
          <Text style={styles.visionText}>Vision</Text>
        </View>
      )}
      {!isCompatible && (
        <View style={styles.warningBadge}>
          <Text style={styles.warningText}>{incompatibleReason ?? 'Too large'}</Text>
        </View>
      )}
    </View>
  );
};

// ── Action icon buttons (download / select / delete) ──

interface ModelCardActionsProps {
  isDownloaded: boolean | undefined;
  isDownloading: boolean | undefined;
  isActive: boolean | undefined;
  isCompatible: boolean;
  incompatibleReason: string | undefined;
  testID: string | undefined;
  onDownload: (() => void) | undefined;
  onSelect: (() => void) | undefined;
  onDelete: (() => void) | undefined;
  onRepairVision: (() => void) | undefined;
  onCancel: (() => void) | undefined;
}

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

function ActionButton({ icon, color, haptic, onPress, disabled, testID, styles }: {
  icon: string; color: string; haptic: string; onPress: () => void;
  disabled?: boolean; testID?: string; styles: ReturnType<typeof createStyles>;
}) {
  return (
    <TouchableOpacity
      style={styles.iconButton}
      onPress={() => { triggerHaptic(haptic as any); onPress(); }}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      testID={testID}
    >
      <Icon name={icon} size={16} color={color} />
    </TouchableOpacity>
  );
}

export const ModelCardActions: React.FC<ModelCardActionsProps> = ({
  isDownloaded, isDownloading, isActive, isCompatible, incompatibleReason,
  testID, onDownload, onSelect, onDelete, onRepairVision, onCancel,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const tid = (suffix: string) => testID ? `${testID}-${suffix}` : undefined;

  return (
    <>
      {isDownloading && onCancel && (
        <ActionButton icon="x" color={colors.error} haptic="notificationWarning"
          onPress={onCancel} testID={tid('cancel')} styles={styles} />
      )}
      {!isDownloaded && !isDownloading && onDownload && (
        <ActionButton icon="download" color={colors.primary} haptic="impactLight"
          onPress={onDownload} disabled={!isCompatible && !incompatibleReason}
          testID={tid('download')} styles={styles} />
      )}
      {isDownloaded && onRepairVision && (
        <ActionButton icon="eye" color={colors.warning} haptic="impactLight"
          onPress={onRepairVision} testID={tid('repair-vision')} styles={styles} />
      )}
      {isDownloaded && !isActive && onSelect && (
        <ActionButton icon="check-circle" color={colors.primary} haptic="selection"
          onPress={onSelect} styles={styles} />
      )}
      {isDownloaded && onDelete && (
        <ActionButton icon="trash-2" color={colors.error} haptic="notificationWarning"
          onPress={onDelete} styles={styles} />
      )}
    </>
  );
};

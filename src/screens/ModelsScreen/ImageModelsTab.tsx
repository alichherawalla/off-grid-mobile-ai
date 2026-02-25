import React from 'react';
import { View, Text, TextInput, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { ModelCard } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import { HFImageModel, getVariantLabel } from '../../services/huggingFaceModelBrowser';
import { ImageModelRecommendation } from '../../types';
import { createStyles } from './styles';
import { ModelsScreenViewModel } from './useModelsScreen';
import { ImageFilterBar } from './ImageFilterBar';
import { BackendFilter, ImageFilterDimension } from './types';
import { formatBytes, getImageModelCompatibility, hfModelToDescriptor } from './utils';

type Props = Pick<ModelsScreenViewModel,
  | 'imageSearchQuery' | 'setImageSearchQuery'
  | 'hfModelsLoading' | 'hfModelsError'
  | 'filteredHFModels' | 'availableHFModels'
  | 'backendFilter' | 'setBackendFilter'
  | 'styleFilter' | 'setStyleFilter'
  | 'sdVersionFilter' | 'setSdVersionFilter'
  | 'imageFilterExpanded' | 'setImageFilterExpanded'
  | 'imageFiltersVisible' | 'setImageFiltersVisible'
  | 'hasActiveImageFilters'
  | 'showRecommendedOnly' | 'setShowRecommendedOnly'
  | 'showRecHint' | 'setShowRecHint'
  | 'imageRec' | 'ramGB' | 'imageRecommendation'
  | 'imageModelDownloading' | 'imageModelProgress'
  | 'handleDownloadImageModel' | 'loadHFModels'
  | 'clearImageFilters' | 'setUserChangedBackendFilter'
  | 'isRecommendedModel'
>;

interface ImageModelCardProps {
  model: HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] };
  index: number;
  imageRec: ImageModelRecommendation | null;
  imageModelDownloading: string[];
  imageModelProgress: Record<string, number>;
  isRecommendedModel: (model: HFImageModel) => boolean;
  handleDownloadImageModel: Props['handleDownloadImageModel'];
}

const ImageModelCardItem: React.FC<ImageModelCardProps> = ({
  model, index, imageRec, imageModelDownloading, imageModelProgress,
  isRecommendedModel, handleDownloadImageModel,
}) => {
  const styles = useThemedStyles(createStyles);
  const recommended = isRecommendedModel(model);
  const { isCompatible, incompatibleReason } = getImageModelCompatibility(model, imageRec);
  const authorLabel = model._coreml ? 'Core ML' : model.backend === 'qnn' ? 'NPU' : 'CPU';
  const variantSuffix = model.variant ? ` \u00B7 ${getVariantLabel(model.variant)}` : '';
  return (
    <View>
      {recommended && (
        <View style={styles.recommendedBadge}>
          <Text style={styles.recommendedBadgeText}>RECOMMENDED</Text>
        </View>
      )}
      <ModelCard
        compact
        model={{
          id: model.id,
          name: model.displayName,
          author: authorLabel,
          description: `${formatBytes(model.size)}${variantSuffix}`,
        }}
        isDownloading={imageModelDownloading.includes(model.id)}
        downloadProgress={imageModelProgress[model.id] || 0}
        isCompatible={isCompatible}
        incompatibleReason={incompatibleReason}
        testID={`image-model-card-${index}`}
        onDownload={
          !imageModelDownloading.includes(model.id)
            ? () => handleDownloadImageModel(hfModelToDescriptor(model))
            : undefined
        }
      />
    </View>
  );
};

function shouldShowEmptyMessage({ loading, error, filtered, available }: { loading: boolean; error: string | null; filtered: any[]; available: any[] }): boolean {
  return !loading && !error && filtered.length === 0 && available.length > 0;
}

interface ScrollContentProps {
  showRecHint: boolean;
  showRecommendedOnly: boolean;
  setShowRecHint: (v: boolean) => void;
  imageRec: ImageModelRecommendation | null;
  ramGB: number;
  imageRecommendation: string;
  imageFiltersVisible: boolean;
  backendFilter: BackendFilter;
  setBackendFilter: (f: BackendFilter) => void;
  styleFilter: string;
  setStyleFilter: (f: string) => void;
  sdVersionFilter: string;
  setSdVersionFilter: (f: string) => void;
  imageFilterExpanded: ImageFilterDimension;
  setImageFilterExpanded: (d: ImageFilterDimension | ((prev: ImageFilterDimension) => ImageFilterDimension)) => void;
  hasActiveImageFilters: boolean;
  clearImageFilters: () => void;
  setUserChangedBackendFilter: (v: boolean) => void;
  hfModelsLoading: boolean;
  hfModelsError: string | null;
  loadHFModels: (forceRefresh?: boolean) => void;
  filteredHFModels: (HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] })[];
  availableHFModels: HFImageModel[];
  imageModelDownloading: string[];
  imageModelProgress: Record<string, number>;
  isRecommendedModel: (model: HFImageModel) => boolean;
  handleDownloadImageModel: Props['handleDownloadImageModel'];
  imageSearchQuery: string;
}

const ImageModelsScrollContent: React.FC<ScrollContentProps> = ({
  showRecHint, showRecommendedOnly, setShowRecHint,
  imageRec, ramGB, imageRecommendation,
  imageFiltersVisible, backendFilter, setBackendFilter,
  styleFilter, setStyleFilter, sdVersionFilter, setSdVersionFilter,
  imageFilterExpanded, setImageFilterExpanded,
  hasActiveImageFilters, clearImageFilters, setUserChangedBackendFilter,
  hfModelsLoading, hfModelsError, loadHFModels,
  filteredHFModels, availableHFModels,
  imageModelDownloading, imageModelProgress,
  isRecommendedModel, handleDownloadImageModel,
  imageSearchQuery,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const emptyMessage = imageSearchQuery.trim()
    ? 'No models match your search'
    : hasActiveImageFilters ? 'No models match your filters' : 'All available models are downloaded';

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <View style={styles.imageModelsList}>
        {showRecHint && showRecommendedOnly && (
          <TouchableOpacity style={styles.recHint} onPress={() => setShowRecHint(false)} activeOpacity={0.7}>
            <Icon name="info" size={11} color={colors.primary} />
            <Text style={styles.recHintText}>
              Showing recommended models only. Tap <MaterialIcon name="star" size={11} color={colors.primary} /> to see all.
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.deviceBanner}>
          <Text style={styles.deviceBannerText}>{Math.round(ramGB)}GB RAM — {imageRecommendation}</Text>
          {imageRec?.warning && (
            <Text style={[styles.deviceBannerText, styles.deviceBannerWarning]}>{imageRec.warning}</Text>
          )}
        </View>

        {imageFiltersVisible && (
          <ImageFilterBar
            backendFilter={backendFilter}
            setBackendFilter={setBackendFilter}
            styleFilter={styleFilter}
            setStyleFilter={setStyleFilter}
            sdVersionFilter={sdVersionFilter}
            setSdVersionFilter={setSdVersionFilter}
            imageFilterExpanded={imageFilterExpanded}
            setImageFilterExpanded={setImageFilterExpanded}
            hasActiveImageFilters={hasActiveImageFilters}
            clearImageFilters={clearImageFilters}
            setUserChangedBackendFilter={setUserChangedBackendFilter}
          />
        )}

        {hfModelsLoading && (
          <View style={styles.hfLoadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Loading models...</Text>
          </View>
        )}

        {hfModelsError && !hfModelsLoading && (
          <View style={styles.hfErrorContainer}>
            <Text style={styles.hfErrorText}>{hfModelsError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => loadHFModels(true)}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!hfModelsLoading && !hfModelsError && filteredHFModels.map(
          (model, index) => (
            <ImageModelCardItem
              key={model.id}
              model={model}
              index={index}
              imageRec={imageRec}
              imageModelDownloading={imageModelDownloading}
              imageModelProgress={imageModelProgress}
              isRecommendedModel={isRecommendedModel}
              handleDownloadImageModel={handleDownloadImageModel}
            />
          )
        )}

        {shouldShowEmptyMessage({ loading: hfModelsLoading, error: hfModelsError, filtered: filteredHFModels, available: availableHFModels }) && (
          <Text style={styles.allDownloadedText}>{emptyMessage}</Text>
        )}
      </View>
    </ScrollView>
  );
};

export const ImageModelsTab: React.FC<Props> = ({
  imageSearchQuery, setImageSearchQuery,
  hfModelsLoading, hfModelsError,
  filteredHFModels, availableHFModels,
  backendFilter, setBackendFilter,
  styleFilter, setStyleFilter,
  sdVersionFilter, setSdVersionFilter,
  imageFilterExpanded, setImageFilterExpanded,
  imageFiltersVisible, setImageFiltersVisible,
  hasActiveImageFilters,
  showRecommendedOnly, setShowRecommendedOnly,
  showRecHint, setShowRecHint,
  imageRec, ramGB, imageRecommendation,
  imageModelDownloading, imageModelProgress,
  handleDownloadImageModel, loadHFModels,
  clearImageFilters, setUserChangedBackendFilter,
  isRecommendedModel,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.imageTabContent}>
      <View style={styles.imageModelsSection}>
        <View style={[styles.searchContainer, styles.searchContainerNoPadding]}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search models..."
            placeholderTextColor={colors.textMuted}
            value={imageSearchQuery}
            onChangeText={setImageSearchQuery}
            returnKeyType="search"
          />
          <TouchableOpacity
            style={[styles.recToggle, showRecommendedOnly && styles.recToggleActive]}
            onPress={() => {
              setShowRecHint(false);
              setShowRecommendedOnly(v => { if (v) setBackendFilter('all'); return !v; });
            }}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            testID="rec-toggle"
          >
            <MaterialIcon name={showRecommendedOnly ? 'star' : 'star-border'} size={16} color={showRecommendedOnly ? colors.primary : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterToggle, (imageFiltersVisible || hasActiveImageFilters) && styles.filterToggleActive]}
            onPress={() => setImageFiltersVisible(v => !v)}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Icon name="sliders" size={14} color={(imageFiltersVisible || hasActiveImageFilters) ? colors.primary : colors.textMuted} />
            {hasActiveImageFilters && <View style={styles.filterDot} />}
          </TouchableOpacity>
        </View>
      </View>

      <ImageModelsScrollContent
        showRecHint={showRecHint}
        showRecommendedOnly={showRecommendedOnly}
        setShowRecHint={setShowRecHint}
        imageRec={imageRec}
        ramGB={ramGB}
        imageRecommendation={imageRecommendation}
        imageFiltersVisible={imageFiltersVisible}
        backendFilter={backendFilter}
        setBackendFilter={setBackendFilter}
        styleFilter={styleFilter}
        setStyleFilter={setStyleFilter}
        sdVersionFilter={sdVersionFilter}
        setSdVersionFilter={setSdVersionFilter}
        imageFilterExpanded={imageFilterExpanded}
        setImageFilterExpanded={setImageFilterExpanded}
        hasActiveImageFilters={hasActiveImageFilters}
        clearImageFilters={clearImageFilters}
        setUserChangedBackendFilter={setUserChangedBackendFilter}
        hfModelsLoading={hfModelsLoading}
        hfModelsError={hfModelsError}
        loadHFModels={loadHFModels}
        filteredHFModels={filteredHFModels as (HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] })[]}
        availableHFModels={availableHFModels}
        imageModelDownloading={imageModelDownloading}
        imageModelProgress={imageModelProgress}
        isRecommendedModel={isRecommendedModel}
        handleDownloadImageModel={handleDownloadImageModel}
        imageSearchQuery={imageSearchQuery}
      />
    </View>
  );
};

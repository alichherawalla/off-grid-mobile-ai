import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { CustomAlert, hideAlert } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { useModelsScreen } from './useModelsScreen';
import { createStyles } from './styles';
import { initialFilterState } from './constants';
import { TextModelsTab } from './TextModelsTab';
import { ImageModelsTab } from './ImageModelsTab';

export const ModelsScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const vm = useModelsScreen();

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="models-screen">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Models</Text>
        <TouchableOpacity
          style={styles.downloadManagerButton}
          onPress={() => vm.navigation.navigate('DownloadManager')}
          testID="downloads-icon"
        >
          <Icon name="download" size={20} color={colors.text} />
          {vm.totalModelCount > 0 && (
            <View style={styles.downloadBadge}>
              <Text style={styles.downloadBadgeText}>{vm.totalModelCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Import Local File */}
      {vm.isImporting && vm.importProgress ? (
        <View style={styles.importProgressCard}>
          <View style={styles.importProgressHeader}>
            <Icon name="file" size={18} color={colors.primary} />
            <Text style={styles.importProgressText} numberOfLines={1}>
              Importing {vm.importProgress.fileName}
            </Text>
          </View>
          <View style={styles.imageProgressBar}>
            <View style={[styles.imageProgressFill, { width: `${Math.round(vm.importProgress.fraction * 100)}%` }]} />
          </View>
          <Text style={styles.importProgressPercent}>
            {Math.round(vm.importProgress.fraction * 100)}%
          </Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.importButton} onPress={vm.handleImportLocalModel} testID="import-local-model">
          <Icon name="folder-plus" size={20} color={colors.primary} />
          <Text style={styles.importButtonText}>Import Local File</Text>
        </TouchableOpacity>
      )}

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => {
            vm.setActiveTab('text');
            vm.setFilterState(initialFilterState);
            vm.setTextFiltersVisible(false);
            vm.setImageFiltersVisible(false);
          }}
        >
          <Text style={[styles.tabText, vm.activeTab === 'text' && styles.tabTextActive]}>Text Models</Text>
          {vm.activeTab === 'text' && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => {
            vm.setActiveTab('image');
            vm.setFilterState(initialFilterState);
            vm.setTextFiltersVisible(false);
            vm.setImageFiltersVisible(false);
          }}
        >
          <Text style={[styles.tabText, vm.activeTab === 'image' && styles.tabTextActive]}>Image Models</Text>
          {vm.activeTab === 'image' && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
      </View>

      {/* Text Models Tab */}
      {vm.activeTab === 'text' && (
        <TextModelsTab
          searchQuery={vm.searchQuery}
          setSearchQuery={vm.setSearchQuery}
          isLoading={vm.isLoading}
          isRefreshing={vm.isRefreshing}
          hasSearched={vm.hasSearched}
          selectedModel={vm.selectedModel}
          setSelectedModel={vm.setSelectedModel}
          modelFiles={vm.modelFiles}
          setModelFiles={vm.setModelFiles}
          isLoadingFiles={vm.isLoadingFiles}
          filterState={vm.filterState}
          textFiltersVisible={vm.textFiltersVisible}
          setTextFiltersVisible={vm.setTextFiltersVisible}
          filteredResults={vm.filteredResults}
          recommendedAsModelInfo={vm.recommendedAsModelInfo}
          ramGB={vm.ramGB}
          deviceRecommendation={vm.deviceRecommendation}
          hasActiveFilters={vm.hasActiveFilters}
          downloadedModels={vm.downloadedModels}
          downloadProgress={vm.downloadProgress}
          alertState={vm.alertState}
          setAlertState={vm.setAlertState}
          focusTrigger={vm.focusTrigger}
          handleSearch={vm.handleSearch}
          handleRefresh={vm.handleRefresh}
          handleSelectModel={vm.handleSelectModel}
          handleDownload={vm.handleDownload}
          handleRepairMmProj={vm.handleRepairMmProj}
          handleCancelDownload={vm.handleCancelDownload}
          downloadIds={vm.downloadIds}
          clearFilters={vm.clearFilters}
          toggleFilterDimension={vm.toggleFilterDimension}
          toggleOrg={vm.toggleOrg}
          setTypeFilter={vm.setTypeFilter}
          setSourceFilter={vm.setSourceFilter}
          setSizeFilter={vm.setSizeFilter}
          setQuantFilter={vm.setQuantFilter}
          isModelDownloaded={vm.isModelDownloaded}
          getDownloadedModel={vm.getDownloadedModel}
        />
      )}

      {/* Image Models Tab */}
      {vm.activeTab === 'image' && (
        <ImageModelsTab
          imageSearchQuery={vm.imageSearchQuery}
          setImageSearchQuery={vm.setImageSearchQuery}
          hfModelsLoading={vm.hfModelsLoading}
          hfModelsError={vm.hfModelsError}
          filteredHFModels={vm.filteredHFModels}
          availableHFModels={vm.availableHFModels}
          backendFilter={vm.backendFilter}
          setBackendFilter={vm.setBackendFilter}
          styleFilter={vm.styleFilter}
          setStyleFilter={vm.setStyleFilter}
          sdVersionFilter={vm.sdVersionFilter}
          setSdVersionFilter={vm.setSdVersionFilter}
          imageFilterExpanded={vm.imageFilterExpanded}
          setImageFilterExpanded={vm.setImageFilterExpanded}
          imageFiltersVisible={vm.imageFiltersVisible}
          setImageFiltersVisible={vm.setImageFiltersVisible}
          hasActiveImageFilters={vm.hasActiveImageFilters}
          showRecommendedOnly={vm.showRecommendedOnly}
          setShowRecommendedOnly={vm.setShowRecommendedOnly}
          showRecHint={vm.showRecHint}
          setShowRecHint={vm.setShowRecHint}
          imageRec={vm.imageRec}
          ramGB={vm.ramGB}
          imageRecommendation={vm.imageRecommendation}
          imageModelDownloading={vm.imageModelDownloading}
          imageModelProgress={vm.imageModelProgress}
          handleDownloadImageModel={vm.handleDownloadImageModel}
          loadHFModels={vm.loadHFModels}
          clearImageFilters={vm.clearImageFilters}
          setUserChangedBackendFilter={vm.setUserChangedBackendFilter}
          isRecommendedModel={vm.isRecommendedModel}
        />
      )}

      <CustomAlert {...vm.alertState} onClose={() => vm.setAlertState(hideAlert())} />
      <CustomAlert
        visible={vm.showNotifRationale}
        title="Download notifications"
        message={"Off Grid can show download progress in your notification tray while you use other apps.\n\nThis is optional — downloads work fine without it."}
        onClose={vm.handleNotifRationaleDismiss}
        buttons={[
          { text: 'No thanks', style: 'cancel', onPress: vm.handleNotifRationaleDismiss },
          { text: 'Allow', style: 'default', onPress: vm.handleNotifRationaleAllow },
        ]}
      />
    </SafeAreaView>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import Icon from 'react-native-vector-icons/Feather';
import { pick } from '@react-native-documents/picker';
import { Button } from '../components/Button';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import { createStyles } from './ProjectDetailScreen.styles';
import { useChatStore, useProjectStore, useAppStore } from '../stores';
import { ragService } from '../services/rag';
import type { RagDocument } from '../services/rag';
import { Conversation } from '../types';
import { RootStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'ProjectDetail'>;

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface KBSectionProps {
  projectId: string;
  colors: any;
  styles: any;
  setAlertState: (state: AlertState) => void;
}

const KnowledgeBaseSection: React.FC<KBSectionProps> = ({ projectId, colors, styles, setAlertState }) => {
  const [kbDocs, setKbDocs] = useState<RagDocument[]>([]);
  const [indexingFile, setIndexingFile] = useState<string | null>(null);

  const loadKbDocs = useCallback(async () => {
    try { setKbDocs(await ragService.getDocumentsByProject(projectId)); } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => { loadKbDocs(); }, [loadKbDocs]);

  const handleAddDocument = async () => {
    try {
      const [file] = await pick({ mode: 'open' });
      if (!file) return;
      const fileName = file.name || 'document';
      setIndexingFile(fileName);
      await ragService.indexDocument({ projectId, filePath: file.uri, fileName, fileSize: file.size || 0 });
      await loadKbDocs();
    } catch (err: any) {
      if (err && !err.message?.includes('cancel')) {
        setAlertState(showAlert('Error', err.message || 'Failed to index document'));
      }
    } finally {
      setIndexingFile(null);
    }
  };

  const handleToggleDocument = async (docId: number, enabled: boolean) => {
    await ragService.toggleDocument(docId, enabled);
    await loadKbDocs();
  };

  const handleDeleteDocument = (doc: RagDocument) => {
    setAlertState(showAlert('Remove Document', `Remove "${doc.name}" from the knowledge base?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        ragService.deleteDocument(doc.id).then(() => loadKbDocs());
      }},
    ]));
  };

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Knowledge Base</Text>
        <Button title="Add" variant="primary" size="small" onPress={handleAddDocument} disabled={!!indexingFile}
          icon={<Icon name="plus" size={16} color={indexingFile ? colors.textDisabled : colors.primary} />} />
      </View>
      {indexingFile && (
        <View style={styles.kbIndexing}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.kbIndexingText} numberOfLines={1}>Indexing {indexingFile}...</Text>
        </View>
      )}
      {kbDocs.length === 0 && !indexingFile ? (
        <View style={styles.kbEmpty}>
          <Icon name="file-text" size={20} color={colors.textMuted} />
          <Text style={styles.kbEmptyText}>No documents added</Text>
        </View>
      ) : (
        kbDocs.map((doc) => (
          <View key={doc.id} style={styles.kbDocRow}>
            <View style={styles.kbDocInfo}>
              <Text style={styles.kbDocName} numberOfLines={1}>{doc.name}</Text>
              <Text style={styles.kbDocSize}>{formatFileSize(doc.size)}</Text>
            </View>
            <Switch value={doc.enabled === 1} onValueChange={(val) => handleToggleDocument(doc.id, val)}
              trackColor={{ false: colors.border, true: colors.primary }} />
            <TouchableOpacity style={styles.kbDocDelete} onPress={() => handleDeleteDocument(doc)}>
              <Icon name="trash-2" size={14} color={colors.error} />
            </TouchableOpacity>
          </View>
        ))
      )}
    </>
  );
};

export const ProjectDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const { getProject, deleteProject } = useProjectStore();
  const { conversations, deleteConversation, setActiveConversation, createConversation } = useChatStore();
  const { downloadedModels, activeModelId } = useAppStore();

  const project = getProject(projectId);
  const hasModels = downloadedModels.length > 0;

  // Get chats for this project
  const projectChats = conversations
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const handleChatPress = (conversation: Conversation) => {
    setActiveConversation(conversation.id);
    navigation.navigate('Chat', { conversationId: conversation.id });
  };

  const handleNewChat = () => {
    if (!hasModels) {
      setAlertState(showAlert('No Model', 'Please download a model first from the Models tab.'));
      return;
    }
    // Create a new conversation with this project
    const modelId = activeModelId || downloadedModels[0]?.id;
    if (modelId) {
      const newConversationId = createConversation(modelId, undefined, projectId);
      navigation.navigate('Chat', { conversationId: newConversationId, projectId });
    }
  };
  const handleEditProject = () => {
    navigation.navigate('ProjectEdit', { projectId });
  };
  const handleDeleteProject = () => {
    setAlertState(showAlert(
      'Delete Project',
      `Delete "${project?.name}"? This will not delete the chats associated with this project.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteProject(projectId);
            navigation.goBack();
          },
        },
      ]
    ));
  };
  const handleDeleteChat = (conversation: Conversation) => {
    setAlertState(showAlert(
      'Delete Chat',
      `Delete "${conversation.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteConversation(conversation.id),
        },
      ]
    ));
  };
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } 
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    
  };

  const renderChatRightActions = (conversation: Conversation) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeleteChat(conversation)}
    >
      <Icon name="trash-2" size={16} color={colors.error} />
    </TouchableOpacity>
  );
  const renderChat = ({ item }: { item: Conversation }) => {
    const lastMessage = item.messages[item.messages.length - 1];

    return (
      <Swipeable
        renderRightActions={() => renderChatRightActions(item)}
        overshootRight={false}
        containerStyle={styles.swipeableContainer}
      >
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => handleChatPress(item)}
        >
          <View style={styles.chatIcon}>
            <Icon name="message-circle" size={14} color={colors.textMuted} />
          </View>
          <View style={styles.chatContent}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.chatDate}>{formatDate(item.updatedAt)}</Text>
            </View>
            {lastMessage && (
              <Text style={styles.chatPreview} numberOfLines={1}>
                {lastMessage.role === 'user' ? 'You: ' : ''}{lastMessage.content}
              </Text>
            )}
          </View>
          <Icon name="chevron-right" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </Swipeable>
    );
  };

  if (!project) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Project not found</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.errorLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.projectIcon}>
            <Text style={styles.projectIconText}>
              {project.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
        </View>
        <TouchableOpacity onPress={handleEditProject} style={styles.editButton}>
          <Icon name="edit-2" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Project Info */}
      <View style={styles.projectInfo}>
        {project.description ? (
          <Text style={styles.projectDescription}>{project.description}</Text>
        ) : null}
        <View style={styles.projectStats}>
          <View style={styles.statItem}>
            <Icon name="message-circle" size={16} color={colors.textMuted} />
            <Text style={styles.statText}>{projectChats.length} chats</Text>
          </View>
        </View>
      </View>

      {/* Knowledge Base Section */}
      <KnowledgeBaseSection projectId={projectId} colors={colors} styles={styles} setAlertState={setAlertState} />

      {/* Chats Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Chats</Text>
        <Button
          title="New Chat"
          variant="primary"
          size="small"
          onPress={handleNewChat}
          disabled={!hasModels}
          icon={<Icon name="plus" size={16} color={hasModels ? colors.primary : colors.textDisabled} />}
        />
      </View>

      {projectChats.length === 0 ? (
        <View style={styles.emptyChats}>
          <Icon name="message-circle" size={24} color={colors.textMuted} />
          <Text style={styles.emptyChatsText}>No chats in this project yet</Text>
          {hasModels && (
            <Button
              title="Start a Chat"
              variant="primary"
              size="medium"
              onPress={handleNewChat}
            />
          )}
        </View>
      ) : (
        <FlatList
          data={projectChats}
          renderItem={renderChat}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.chatList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Delete Project Button */}
      <View style={styles.footer}>
        <Button
          title="Delete Project"
          variant="ghost"
          size="medium"
          onPress={handleDeleteProject}
          icon={<Icon name="trash-2" size={16} color={colors.error} />}
          textStyle={{ color: colors.error }}
        />
      </View>
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};

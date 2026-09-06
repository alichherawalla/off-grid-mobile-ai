// Composition root: the shared chat session, its operation and context services, context
// compaction, intent classification, and prompt enhancement over Mobile's store and runtime ports.
import {
  ChatContextApplicationService,
  ChatOperationApplicationService,
  ChatSessionService,
  once,
} from '@offgrid/models';
import {
  createWorkspaceContentChatSessionRepository,
  type ModelsChatPlatformPort,
} from '@offgrid/application';
import {
  mobileChatContextPorts,
  mobileChatOperationCommand,
  mobileChatOperationPorts,
  mobileChatQueueSnapshot,
  mobileChatSessionPorts,
  subscribeMobileChatQueue,
  subscribeMobileChatSessionEvents,
} from '../adapters/models/mobileChatHostPort';
import { contextCompaction, generationIntent } from './chat-services';
import { applicationFacade } from '../applicationFacade';
import { generateId } from '../../utils/generateId';

// Re-exported so the existing import paths keep resolving; the owner is `chat-services`.
;

const chatOperation = once(
  () => new ChatOperationApplicationService(mobileChatOperationPorts(generationIntent())),
);
const chatContext = once(() => new ChatContextApplicationService(mobileChatContextPorts()));
const chatRepository = once(() => createWorkspaceContentChatSessionRepository({
  workspaceContent: applicationFacade().workspaceContent,
  newId: generateId,
  now: Date.now,
}));
const chatSession = once(() => {
  const [generation, options] = mobileChatSessionPorts(
    {
      augment: ({ identity, signal }) => chatContext().compose({
        conversationId: identity.conversationId,
        projectId: identity.projectId,
        signal,
      }),
    },
    {
      resolve: input => chatOperation().resolve(
        mobileChatOperationCommand(input),
      ),
    },
    contextCompaction(),
  );
  return new ChatSessionService(generation, chatRepository(), options);
});
export const modelsChatPort: ModelsChatPlatformPort = {
  snapshot: () => mobileChatQueueSnapshot(),
  subscribe: listener => subscribeMobileChatQueue(listener),
  events: listener => subscribeMobileChatSessionEvents(listener),
  send: command => chatSession().send(command),
  regenerate: command => chatSession().regenerate(command),
  edit: command => chatSession().edit(command),
  stop: (turnId, reason) => chatSession().stop(turnId, reason),
  stopConversation: (conversationId, reason) =>
    chatSession().stopConversation(conversationId, reason),
  // Workspace content has no per-conversation repository cache to invalidate.
  invalidate: () => undefined,
};

import type {
  ChatTurnRecord,
  LocalMessageContentLocation,
} from '@offgrid/application';
import { serializeSyncedMessageContext } from '@offgrid/sync';
import type { DB } from '@op-engineering/op-sqlite';
import {
  encodeWorkspaceMessageContent,
  openWorkspaceContentDatabase,
  WORKSPACE_CONTENT_SCHEMA_VERSION,
} from '../adapters/workspaceContent/workspaceContentDatabase';
import { projectMobileMessageContent } from '../adapters/workspaceContent/mobileWorkspaceContentRepository';
import type {
  ContentMigrationTargetFacts,
  ContentMigrationTargetPort,
  ContentRecordCounts,
} from './contentPersistencePreflight';
import {
  storedRecord as record,
  type LegacyContentSnapshot,
  type StoredRecord,
} from './legacyContentSource';

export { legacyContentSource } from './legacyContentSource';
;

// Upgrade-migration readers only. The legacy Zustand project and chat stores that wrote these two
// AsyncStorage keys are retired; Workspace Content owns projects, conversations, and messages. These
// keys are still read once, on upgrade, to copy a pre-migration device's records into the canonical
// owner. They are never written here, and nothing reads them at runtime. Remove them only when no
// supported upgrade path can still start from a device that holds them.
const TARGET_VERSION = WORKSPACE_CONTENT_SCHEMA_VERSION;

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is not a non-empty string`);
  }
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function assertPortableToolCalls(message: StoredRecord, label: string): void {
  const toolArtifacts = message.toolArtifacts;
  if (toolArtifacts !== undefined && !Array.isArray(toolArtifacts)) {
    throw new Error(`${label}.toolArtifacts is not an array`);
  }
  if (message.toolCalls !== undefined) {
    if (!Array.isArray(message.toolCalls)) {
      throw new Error(`${label}.toolCalls is not an array`);
    }
    const artifacts = (toolArtifacts ?? []).map((value, index) =>
      record(value, `${label}.toolArtifacts[${index}]`),
    );
    for (const [index, value] of message.toolCalls.entries()) {
      const call = record(value, `${label}.toolCalls[${index}]`);
      const matchingArtifact = artifacts.find(
        artifact =>
          (optionalText(call.id) === null || artifact.id === call.id) &&
          artifact.name === call.name &&
          artifact.arguments === call.arguments,
      );
      if (!matchingArtifact) {
        throw new Error(
          `${label}.toolCalls[${index}] has no lossless completed-tool artifact`,
        );
      }
    }
  }
}

function portableContext(message: StoredRecord, label: string): string | null {
  assertPortableToolCalls(message, label);

  const generationMeta =
    message.generationMeta === undefined
      ? undefined
      : record(message.generationMeta, `${label}.generationMeta`);
  const toolArtifacts = message.toolArtifacts as unknown[] | undefined;
  const role = text(message.role, `${label}.role`);
  const candidate = {
    ...(message.reasoningContent === undefined
      ? {}
      : { reasoning: message.reasoningContent }),
    ...(generationMeta?.routedToolNames === undefined
      ? {}
      : { toolsOffered: generationMeta.routedToolNames }),
    ...(toolArtifacts?.length ? { toolCalls: toolArtifacts } : {}),
    ...(role === 'tool'
      ? {
          tool: {
            ...(message.toolCallId === undefined
              ? {}
              : { callId: message.toolCallId }),
            ...(message.toolName === undefined
              ? {}
              : { name: message.toolName }),
            status: 'completed',
            ...(message.generationTimeMs === undefined
              ? {}
              : { durationMs: message.generationTimeMs }),
          },
        }
      : {}),
    ...(message.isSystemInfo === true ? { notice: true } : {}),
    status: 'completed',
    ...(message.generationTimeMs === undefined
      ? {}
      : { durationMs: message.generationTimeMs }),
  };
  const serialized = serializeSyncedMessageContext(candidate);
  if (
    serialized === null ||
    stableJson(JSON.parse(serialized)) !== stableJson(candidate)
  ) {
    throw new Error(
      `${label} has portable context that cannot be represented losslessly`,
    );
  }
  return Object.keys(candidate).length === 1 ? null : serialized;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as StoredRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function stableMessageId(message: StoredRecord): string {
  return optionalText(message.uuid) ?? text(message.id, 'message.id');
}

function legacyTurns(input: {
  conversation: StoredRecord;
  conversationId: string;
  messages: readonly StoredRecord[];
  now: string;
}): { turns: ChatTurnRecord[]; turnIds: Map<string, string> } {
  const { conversation, conversationId, messages, now } = input;
  const turns: ChatTurnRecord[] = [];
  const turnIds = new Map<string, string>();
  for (let index = 0; index < messages.length; index += 1) {
    const user = messages[index];
    if (user.role !== 'user' || user.isSystemInfo === true) continue;
    const nextUserOffset = messages
      .slice(index + 1)
      .findIndex(
        message => message.role === 'user' && message.isSystemInfo !== true,
      );
    const end =
      nextUserOffset < 0 ? messages.length : index + 1 + nextUserOffset;
    const responses = messages
      .slice(index + 1, end)
      .filter(
        message =>
          (message.role === 'assistant' || message.role === 'tool') &&
          message.isSystemInfo !== true,
      );
    const turnId = stableMessageId(user);
    const userMessageId = turnId;
    const responseMessageIds = responses.map(stableMessageId);
    turnIds.set(text(user.id, 'message.id'), turnId);
    for (const response of responses) {
      turnIds.set(text(response.id, 'message.id'), turnId);
    }
    const createdAt = isoTime(user.timestamp, now);
    const updatedAt = responses.reduce(
      (latest, response) => isoTime(response.timestamp, latest),
      createdAt,
    );
    const operation =
      user.turnKind === 'image'
        ? {
            type: 'image' as const,
            prompt: typeof user.content === 'string' ? user.content : '',
          }
        : Array.isArray(user.attachments) &&
          user.attachments.some(
            value => record(value, 'message.attachment').type === 'image',
          )
        ? { type: 'vision' as const }
        : { type: 'text' as const };
    const interrupted = [user, ...responses].some(
      message => message.isStreaming === true || message.isThinking === true,
    );
    turns.push({
      id: turnId,
      conversationId,
      ...(typeof conversation.projectId === 'string'
        ? { projectId: conversation.projectId }
        : {}),
      userMessageId,
      responseMessageIds,
      status: interrupted
        ? 'interrupted'
        : responses.length > 0
        ? 'completed'
        : 'queued',
      request: { operation, request: {} },
      requestId: turnId,
      position: turns.length,
      recoveryAttempts: 0,
      lastError: null,
      createdAt,
      updatedAt,
    });
  }
  return { turns, turnIds };
}

function localMessageState(
  message: StoredRecord,
  locations: readonly LocalMessageContentLocation[] | undefined,
): StoredRecord {
  const local = { ...message };
  delete local.id;
  delete local.uuid;
  delete local.role;
  delete local.content;
  delete local.timestamp;
  delete local.reasoningContent;
  delete local.turnKind;
  delete local.isSystemInfo;
  delete local.isStreaming;
  delete local.isThinking;
  delete local.attachments;
  delete local.generationTimeMs;
  delete local.toolCallId;
  delete local.toolCalls;
  delete local.toolArtifacts;
  delete local.toolName;
  if (locations) local.contentLocations = locations;
  if (local.generationMeta && typeof local.generationMeta === 'object') {
    const localGenerationMeta = { ...(local.generationMeta as StoredRecord) };
    delete localGenerationMeta.routedToolNames;
    if (Object.keys(localGenerationMeta).length > 0) {
      local.generationMeta = localGenerationMeta;
    } else {
      delete local.generationMeta;
    }
  }
  return local;
}

function isoTime(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return fallback;
}

function rowCount(db: DB, table: string): number {
  const row = db.executeSync(`SELECT COUNT(*) AS count FROM ${table}`).rows[0];
  return typeof row?.count === 'number' ? row.count : 0;
}

class MobileContentMigrationTarget implements ContentMigrationTargetPort {
  private readonly db: DB;

  constructor() {
    this.db = openWorkspaceContentDatabase();
  }

  async inspect(): Promise<ContentMigrationTargetFacts> {
    const row = this.db.executeSync(
      'SELECT status FROM workspace_content_migration_journal WHERE target_version = ?',
      [TARGET_VERSION],
    ).rows[0];
    const marker =
      row?.status === 'completed'
        ? 'complete'
        : row?.status === 'started' || row?.status === 'failed'
        ? 'partial'
        : 'none';
    return { marker, counts: this.counts() };
  }

  async replaceWithLegacy(
    snapshot: LegacyContentSnapshot,
    lifecycle: {
      onProgress(copied: number, total: number): void;
      onCopied(): void;
      onVerified(): void;
    },
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    this.db.executeSync(
      `INSERT INTO workspace_content_migration_journal
       (target_version, status, started_at, finished_at, failure_message)
       VALUES (?, 'started', ?, NULL, NULL)
       ON CONFLICT(target_version) DO UPDATE SET status = 'started', started_at = excluded.started_at,
       finished_at = NULL, failure_message = NULL`,
      [TARGET_VERSION, startedAt],
    );

    const total =
      snapshot.projects.length +
      snapshot.conversations.length +
      snapshot.conversations.reduce(
        (sum, conversation) =>
          sum +
          (Array.isArray(conversation.messages)
            ? conversation.messages.length
            : 0),
        0,
      );
    let copied = 0;
    const now = new Date().toISOString();

    try {
      await this.db.transaction(async tx => {
        await tx.execute('DELETE FROM workspace_content_local_message_state');
        await tx.execute('DELETE FROM workspace_content_chat_turns');
        await tx.execute('DELETE FROM workspace_content_messages');
        await tx.execute('DELETE FROM workspace_content_conversations');
        await tx.execute('DELETE FROM workspace_content_projects');

        for (const project of snapshot.projects) {
          await tx.execute(
            `INSERT INTO workspace_content_projects
             (id, name, description, system_prompt, icon, include_memory, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              text(project.id, 'project.id'),
              text(project.name, 'project.name'),
              typeof project.description === 'string'
                ? project.description
                : '',
              typeof project.systemPrompt === 'string'
                ? project.systemPrompt
                : '',
              optionalText(project.icon),
              project.includeMemory === false ? 0 : 1,
              isoTime(project.createdAt, now),
              isoTime(project.updatedAt, now),
            ],
          );
          lifecycle.onProgress(++copied, total);
        }

        for (const conversation of snapshot.conversations) {
          const conversationId = text(conversation.id, 'conversation.id');
          await tx.execute(
            `INSERT INTO workspace_content_conversations
             (id, title, model_id, project_id, compaction_summary,
              compaction_cutoff_message_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
            [
              conversationId,
              typeof conversation.title === 'string' ? conversation.title : '',
              optionalText(conversation.modelId),
              optionalText(conversation.projectId),
              optionalText(conversation.compactionSummary),
              isoTime(conversation.createdAt, now),
              isoTime(conversation.updatedAt, now),
            ],
          );
          lifecycle.onProgress(++copied, total);

          const messages = Array.isArray(conversation.messages)
            ? conversation.messages.map((value, index) =>
                record(value, `conversation.messages[${index}]`),
              )
            : [];
          const { turns, turnIds } = legacyTurns({
            conversation,
            conversationId,
            messages,
            now,
          });
          const stableIds = new Map<string, string>();
          for (const [position, message] of messages.entries()) {
            const localId = text(message.id, 'message.id');
            const stableId = stableMessageId(message);
            stableIds.set(localId, stableId);
            const createdAt = isoTime(message.timestamp, now);
            const rich = projectMobileMessageContent({
              content: message.content,
              ...(message.attachments === undefined
                ? {}
                : { attachments: message.attachments }),
            });
            const local = localMessageState(message, rich.locations);
            await tx.execute(
              `INSERT INTO workspace_content_messages
               (id, conversation_id, turn_id, position, role, content, context_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                stableId,
                conversationId,
                turnIds.get(localId) ?? null,
                position,
                text(message.role, 'message.role'),
                encodeWorkspaceMessageContent(rich.content),
                portableContext(message, `conversation.messages[${position}]`),
                createdAt,
                createdAt,
              ],
            );
            if (Object.keys(local).length > 0) {
              await tx.execute(
                `INSERT INTO workspace_content_local_message_state (message_id, state_json)
                 VALUES (?, ?)`,
                [stableId, JSON.stringify(local)],
              );
            }
            lifecycle.onProgress(++copied, total);
          }
          await tx.execute(
            `INSERT INTO workspace_content_chat_turns
             (conversation_id, turns_json, updated_at) VALUES (?, ?, ?)`,
            [
              conversationId,
              JSON.stringify(turns),
              isoTime(conversation.updatedAt, now),
            ],
          );
          const cutoff = optionalText(conversation.compactionCutoffMessageId);
          if (cutoff) {
            await tx.execute(
              `UPDATE workspace_content_conversations
               SET compaction_cutoff_message_id = ? WHERE id = ?`,
              [stableIds.get(cutoff) ?? cutoff, conversationId],
            );
          }
        }

        lifecycle.onCopied();
        const projectCount = await tx.execute(
          'SELECT COUNT(*) AS count FROM workspace_content_projects',
        );
        const conversationCount = await tx.execute(
          'SELECT COUNT(*) AS count FROM workspace_content_conversations',
        );
        const messageCount = await tx.execute(
          'SELECT COUNT(*) AS count FROM workspace_content_messages',
        );
        const counts = {
          projects:
            typeof projectCount.rows[0]?.count === 'number'
              ? projectCount.rows[0].count
              : 0,
          conversations:
            typeof conversationCount.rows[0]?.count === 'number'
              ? conversationCount.rows[0].count
              : 0,
          messages:
            typeof messageCount.rows[0]?.count === 'number'
              ? messageCount.rows[0].count
              : 0,
        };
        if (
          counts.projects !== snapshot.projects.length ||
          counts.conversations !== snapshot.conversations.length ||
          counts.messages !==
            total - snapshot.projects.length - snapshot.conversations.length
        ) {
          throw new Error(
            'SQLite verification counts do not match the legacy source',
          );
        }
        lifecycle.onVerified();
        await tx.execute(
          `UPDATE workspace_content_migration_journal
           SET status = 'completed', finished_at = ?, failure_message = NULL
           WHERE target_version = ?`,
          [new Date().toISOString(), TARGET_VERSION],
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.executeSync(
        `UPDATE workspace_content_migration_journal
         SET status = 'failed', finished_at = ?, failure_message = ?
         WHERE target_version = ?`,
        [new Date().toISOString(), message, TARGET_VERSION],
      );
      throw error;
    }
  }

  private counts(): ContentRecordCounts {
    return {
      projects: rowCount(this.db, 'workspace_content_projects'),
      conversations: rowCount(this.db, 'workspace_content_conversations'),
      messages: rowCount(this.db, 'workspace_content_messages'),
    };
  }
}

export const contentMigrationTarget = new MobileContentMigrationTarget();

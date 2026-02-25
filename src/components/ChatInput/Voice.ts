import { useEffect, useRef } from 'react';
import { useWhisperTranscription } from '../../hooks/useWhisperTranscription';
import { useWhisperStore } from '../../stores';

interface UseVoiceInputParams {
  conversationId?: string | null;
  onTranscript: (text: string) => void;
}

export function useVoiceInput({ conversationId, onTranscript }: UseVoiceInputParams) {
  const recordingConversationIdRef = useRef<string | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const { downloadedModelId } = useWhisperStore();

  const {
    isRecording,
    isModelLoading,
    isTranscribing,
    partialResult,
    finalResult,
    error,
    startRecording: startRecordingBase,
    stopRecording,
    clearResult,
  } = useWhisperTranscription();

  const voiceAvailable = !!downloadedModelId;

  const startRecording = async () => {
    recordingConversationIdRef.current = conversationId || null;
    await startRecordingBase();
  };

  useEffect(() => {
    if (recordingConversationIdRef.current && recordingConversationIdRef.current !== conversationId) {
      clearResult();
      recordingConversationIdRef.current = null;
    }
  }, [conversationId, clearResult]);

  useEffect(() => {
    if (finalResult) {
      if (!recordingConversationIdRef.current || recordingConversationIdRef.current === conversationId) {
        onTranscriptRef.current(finalResult);
      }
      clearResult();
      recordingConversationIdRef.current = null;
    }
  }, [finalResult, clearResult, conversationId]);

  return { isRecording, isModelLoading, isTranscribing, partialResult, error, voiceAvailable, startRecording, stopRecording, clearResult };
}

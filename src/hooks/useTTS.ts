import { useCallback } from 'react';
import { useTTSContext, TTSOptions } from '../context/TTSContext';

export interface UseTTSReturn {
    speak: (text: string, id?: string, options?: TTSOptions) => Promise<void>;
    speakStream: (text: string, id?: string, options?: TTSOptions) => Promise<void>;
    stop: () => void;
    isPlaying: boolean;
    isSpeaking: boolean;
    speakingId: string | null;
}

export function useTTS(): UseTTSReturn {
    const { speak: contextSpeak, speakStream: contextSpeakStream, stop, isPlaying, isSpeaking, speakingId } = useTTSContext();

    const speak = useCallback(async (text: string, id?: string, options: TTSOptions = {}) => {
        return contextSpeak(text, id, options);
    }, [contextSpeak]);

    const speakStream = useCallback(async (text: string, id?: string, options: TTSOptions = {}) => {
        return contextSpeakStream(text, id, options);
    }, [contextSpeakStream]);

    return {
        speak,
        speakStream,
        stop,
        isPlaying,
        isSpeaking,
        speakingId
    };
}

import React, { createContext, useContext, useState, useRef, useCallback, ReactNode, useMemo } from 'react';

export interface TTSOptions {
    provider?: string;
    voice?: string;
    speed?: number;
    quality?: number;
}

interface TTSContextType {
    isPlaying: boolean;
    isSpeaking: boolean;
    speakingId: string | null;
    currentAudio: HTMLAudioElement | null;
    speak: (text: string, id?: string, options?: TTSOptions) => Promise<void>;
    speakStream: (text: string, id?: string, options?: TTSOptions) => Promise<void>;
    stop: () => void;
}

const TTSContext = createContext<TTSContextType | undefined>(undefined);

export function TTSProvider({ children }: { children: ReactNode }) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [speakingId, setSpeakingId] = useState<string | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const currentStreamReaderRef = useRef<ReadableStreamDefaultReader | null>(null);
    const sessionTokenRef = useRef<number>(0);

    const stop = useCallback(() => {
        if (currentStreamReaderRef.current) {
            currentStreamReaderRef.current.cancel().catch(() => { });
            currentStreamReaderRef.current = null;
        }

        if (sourceNodeRef.current) {
            try {
                sourceNodeRef.current.stop();
                sourceNodeRef.current.disconnect();
            } catch (e) { }
            sourceNodeRef.current = null;
        }

        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current = null;
        }

        setIsPlaying(false);
        setIsSpeaking(false);
        setSpeakingId(null);
        sessionTokenRef.current++;
    }, []);

    const playAudioBuffer = useCallback((context: AudioContext, arrayBuffer: ArrayBuffer): Promise<void> => {
        return new Promise((resolve, reject) => {
            context.decodeAudioData(
                arrayBuffer,
                (audioBuffer) => {
                    const source = context.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(context.destination);
                    source.onended = () => resolve();
                    source.start(0);
                    sourceNodeRef.current = source;
                },
                (error) => reject(error)
            );
        });
    }, []);

    const speak = useCallback(async (text: string, id?: string, options: TTSOptions = {}) => {
        stop();
        const sessionToken = sessionTokenRef.current;
        setIsSpeaking(true);
        setSpeakingId(id || null);

        try {
            const response = await fetch('/api/tts/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, ...options })
            });

            if (!response.ok) throw new Error('TTS generation failed');

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audioRef.current = audio;

            audio.onplay = () => setIsPlaying(true);
            audio.onended = () => {
                if (sessionTokenRef.current !== sessionToken) return;
                setIsPlaying(false);
                setIsSpeaking(false);
                setSpeakingId(null);
                URL.revokeObjectURL(audioUrl);
            };
            audio.onerror = () => {
                if (sessionTokenRef.current !== sessionToken) return;
                setIsPlaying(false);
                setIsSpeaking(false);
                setSpeakingId(null);
                URL.revokeObjectURL(audioUrl);
            };

            await audio.play();
        } catch (error) {
            console.error('[TTSContext] Speak failed:', error);
            if (sessionTokenRef.current === sessionToken) {
                setIsSpeaking(false);
                setSpeakingId(null);
            }
        }
    }, [stop]);

    const speakStream = useCallback(async (text: string, id?: string, options: TTSOptions = {}) => {
        stop();
        const sessionToken = sessionTokenRef.current;
        setIsSpeaking(true);
        setSpeakingId(id || null);

        try {
            const response = await fetch('/api/tts/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, ...options })
            });

            if (!response.ok) throw new Error('TTS streaming failed');

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');
            currentStreamReaderRef.current = reader;

            const decoder = new TextDecoder();
            let buffer = '';
            const audioChunks: ArrayBuffer[] = [];

            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            const audioContext = audioContextRef.current;

            while (true) {
                if (sessionTokenRef.current !== sessionToken) break;
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine || !trimmedLine.startsWith('data:')) continue;
                    const eventData = trimmedLine.slice(5).trim();
                    if (!eventData) continue;

                    try {
                        const parsed = JSON.parse(eventData);
                        if (parsed.audio) {
                            const binaryString = atob(parsed.audio);
                            const bytes = new Uint8Array(binaryString.length);
                            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
                            audioChunks.push(bytes.buffer);

                            if (audioChunks.length === 1) {
                                setIsPlaying(true);
                                await playAudioBuffer(audioContext, bytes.buffer);
                            }
                        }
                    } catch (e) { }
                }
            }

            if (sessionTokenRef.current === sessionToken) {
                for (let i = 1; i < audioChunks.length; i++) {
                    if (sessionTokenRef.current !== sessionToken) break;
                    await playAudioBuffer(audioContext, audioChunks[i]);
                }
            }

            if (sessionTokenRef.current === sessionToken) {
                setIsPlaying(false);
                setIsSpeaking(false);
                setSpeakingId(null);
            }
        } catch (error) {
            console.error('[TTSContext] Stream failed:', error);
            if (sessionTokenRef.current === sessionToken) {
                setIsPlaying(false);
                setIsSpeaking(false);
                setSpeakingId(null);
            }
        }
    }, [stop, playAudioBuffer]);

    const value = useMemo(() => ({
        isPlaying,
        isSpeaking,
        speakingId,
        currentAudio: audioRef.current,
        speak,
        speakStream,
        stop
    }), [isPlaying, isSpeaking, speakingId, speak, speakStream, stop]);

    return (
        <TTSContext.Provider value={value}>
            {children}
        </TTSContext.Provider>
    );
}

export function useTTSContext() {
    const context = useContext(TTSContext);
    if (context === undefined) {
        throw new Error('useTTSContext must be used within a TTSProvider');
    }
    return context;
}

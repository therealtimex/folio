import { UserSettings } from './types';

export function syncTTSToLocalStorage(settings: UserSettings | null): void {
    if (!settings) return;

    try {
        const provider = settings.tts_provider || 'piper_local';
        localStorage.setItem('tts_provider', provider);

        if (settings.tts_voice) {
            localStorage.setItem('tts_voice', settings.tts_voice);
        } else {
            localStorage.removeItem('tts_voice');
        }

        const speed = settings.tts_speed ?? 1.0;
        localStorage.setItem('tts_speed', speed.toString());

        const quality = settings.tts_quality ?? 10;
        localStorage.setItem('tts_quality', quality.toString());

        const autoPlay = settings.tts_auto_play ?? true;
        localStorage.setItem('auto_speak_enabled', autoPlay.toString());
    } catch (error) {
        console.error('[TTS Sync] Failed to sync to localStorage:', error);
    }
}

export function clearTTSFromLocalStorage(): void {
    try {
        localStorage.removeItem('tts_provider');
        localStorage.removeItem('tts_voice');
        localStorage.removeItem('tts_speed');
        localStorage.removeItem('tts_quality');
        localStorage.removeItem('auto_speak_enabled');
    } catch (error) {
        console.error('[TTS Sync] Failed to clear localStorage:', error);
    }
}

export function getTTSFromLocalStorage(): {
    provider?: string;
    voice?: string;
    speed: number;
    quality: number;
    autoPlay: boolean;
} {
    try {
        const provider = localStorage.getItem('tts_provider') || undefined;
        const voice = localStorage.getItem('tts_voice') || undefined;
        const speed = parseFloat(localStorage.getItem('tts_speed') || '1.0');
        const quality = parseInt(localStorage.getItem('tts_quality') || '10', 10);
        const autoPlay = localStorage.getItem('auto_speak_enabled') !== 'false';

        return { provider, voice, speed, quality, autoPlay };
    } catch (error) {
        console.error('[TTS Sync] Failed to read from localStorage:', error);
        return { speed: 1.0, quality: 10, autoPlay: true };
    }
}

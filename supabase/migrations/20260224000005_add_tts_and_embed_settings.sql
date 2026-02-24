-- Migration: Add TTS and Embedding settings to user_settings
-- Created: 2026-02-24

-- Add TTS settings
ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS tts_auto_play BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'piper_local',
ADD COLUMN IF NOT EXISTS tts_voice TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS tts_speed NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS tts_quality INTEGER DEFAULT 10;

-- Add Embedding settings
ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS embedding_provider TEXT DEFAULT 'realtimexai',
ADD COLUMN IF NOT EXISTS embedding_model TEXT DEFAULT 'text-embedding-3-small';

-- Add comments for documentation
COMMENT ON COLUMN public.user_settings.tts_auto_play IS 'Automatically read AI responses aloud using text-to-speech';
COMMENT ON COLUMN public.user_settings.tts_provider IS 'TTS provider (piper_local, supertonic_local, etc.)';
COMMENT ON COLUMN public.user_settings.tts_voice IS 'Voice ID specific to the selected provider';
COMMENT ON COLUMN public.user_settings.tts_speed IS 'Speech speed (0.5x to 2.0x)';
COMMENT ON COLUMN public.user_settings.tts_quality IS 'Audio quality/bitrate (1-20, higher = better quality)';
COMMENT ON COLUMN public.user_settings.embedding_provider IS 'Default embedding provider for RAG and search';
COMMENT ON COLUMN public.user_settings.embedding_model IS 'Default embedding model name';

-- Add provider discriminator field to tts_settings JSONB based on linked provider's api_type
UPDATE personas
SET tts_settings = jsonb_set(
  COALESCE(tts_settings, '{}'::jsonb),
  '{provider}',
  CASE 
    WHEN p.api_type = 'azure' THEN '"azure"'::jsonb
    WHEN p.api_type = 'elevenlabs' THEN '"elevenlabs"'::jsonb
    WHEN p.api_type = 'openai' THEN '"openai"'::jsonb
    WHEN p.api_type = 'deepgram' THEN '"deepgram"'::jsonb
    WHEN p.api_type = 'cartesia' THEN '"cartesia"'::jsonb
    ELSE NULL
  END,
  true
)
FROM providers p
WHERE personas.tts_provider_id = p.id
  AND personas.tts_settings IS NOT NULL
  AND personas.tts_settings::text != 'null'
  AND p.provider_type = 'tts';

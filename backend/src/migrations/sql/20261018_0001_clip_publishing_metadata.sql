-- AI-written viral titles, descriptions and hashtags for generated clips.
-- One JSONB document per clip holding a neutral "generic" copy plus one copy
-- per social platform (youtube / tiktok / instagram), each already trimmed to
-- that platform's character limits.
ALTER TABLE generated_clips
    ADD COLUMN IF NOT EXISTS publishing_metadata JSONB;

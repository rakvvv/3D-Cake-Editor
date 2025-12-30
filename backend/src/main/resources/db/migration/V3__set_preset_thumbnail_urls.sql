-- Ensure thumbnail_url is populated for existing presets without overwriting existing values
UPDATE decorated_cake_presets
SET thumbnail_url = '/api/presets/cakes/' || preset_id || '/thumbnail'
WHERE thumbnail_url IS NULL;

UPDATE policy_versions
SET hash_algorithm = 'LEGACY-UNVERIFIED',
    content_mime_type = 'text/plain',
    snapshot_schema_version = 1
WHERE length(content_hash) <> 64;

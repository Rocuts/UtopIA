-- Add unique constraint on (workspace_id, provider) for erp_credentials
-- Required for ON CONFLICT DO UPDATE in POST /api/erp/connect
ALTER TABLE "erp_credentials"
  ADD CONSTRAINT "erp_credentials_workspace_provider_uniq"
  UNIQUE ("workspace_id", "provider");

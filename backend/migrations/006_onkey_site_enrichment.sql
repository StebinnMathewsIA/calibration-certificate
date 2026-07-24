-- Site enrichment from WOE001 (#58) — owner-confirmed field semantics:
--   AssetParentAssetGeographicDataLocationNonShell = GPS location of the site
--   WorkOrderSiteDescription / WorkOrderSiteCode   = the site's oil company
-- Idempotent; applied by apply_migrations.py.

ALTER TABLE onkey_sites ADD COLUMN IF NOT EXISTS gps_location     varchar(200);
ALTER TABLE onkey_sites ADD COLUMN IF NOT EXISTS oil_company_code varchar(64);
ALTER TABLE onkey_sites ADD COLUMN IF NOT EXISTS oil_company_name varchar(200);

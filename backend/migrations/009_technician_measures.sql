-- Proving measures per technician (#48): the 200L/20L/5L measures' serials,
-- certificate numbers and cal/expiry dates, self-service via the profile.
-- Photos of the measures stay on-device. Idempotent.

ALTER TABLE onkey_technicians ADD COLUMN IF NOT EXISTS measures jsonb NOT NULL DEFAULT '[]';

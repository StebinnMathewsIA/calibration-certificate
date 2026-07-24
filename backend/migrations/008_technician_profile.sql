-- Technician profile fields served from the register (#62).
-- Idempotent; applied by apply_migrations.py.

ALTER TABLE onkey_technicians ADD COLUMN IF NOT EXISTS pliers_number varchar(64);

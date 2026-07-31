-- Contact person on premises (#90, SANS TEST PROC01 4.1.1): stored on the
-- canonical site record so it prefills the next visit, and included in the
-- site shapes the app reads. Idempotent.

ALTER TABLE sites ADD COLUMN IF NOT EXISTS contact_person varchar(200);

CREATE OR REPLACE FUNCTION app_site_record(s sites) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'id', s.id, 'customerName', s.customer_name, 'siteName', s.site_name,
        'address', s.address, 'telephone', s.telephone,
        'contactPerson', s.contact_person, 'source', s.source,
        'updatedAt', to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'))
$$;

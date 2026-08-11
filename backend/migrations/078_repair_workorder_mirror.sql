-- Repair the work order mirror (#130).
--
-- onkey_workorders was built with DISTINCT ON (Code) ORDER BY start_date_ts,
-- and a work order's start date does not change when the record is updated.
-- So with two snapshots of the same work order the tie broke arbitrarily and
-- a stale one could win indefinitely. Four work orders reassigned in OnKey
-- on 2026-08-07 were still showing their previous technician on 2026-08-11.
--
-- The Python sync is fixed to order by last_seen_at. This repairs what is
-- already stored, so it does not wait for each work order to be touched
-- again, which for a rarely-changing record could be never.
--
-- Idempotent.

WITH freshest AS (
    SELECT DISTINCT ON (data ->> 'Code')
           data ->> 'Code' AS code,
           nullif(data ->> 'StaffCode', '') AS staff_code,
           nullif(data ->> 'SiteNumber', '') AS site_number,
           nullif(data ->> 'EquipmentNumber', '') AS equipment_number,
           nullif(data ->> 'WorkOrderQueueNewStatusCode', '') AS status_code,
           nullif(data ->> 'WorkOrderQueueNewStatusDescription', '') AS status_description
      FROM onkey_woe001
     WHERE coalesce(data ->> 'Code', '') <> ''
     ORDER BY data ->> 'Code', last_seen_at DESC NULLS LAST, start_date_ts DESC NULLS LAST
)
UPDATE onkey_workorders t SET
    staff_code = coalesce(f.staff_code, t.staff_code),
    site_number = coalesce(f.site_number, t.site_number),
    equipment_number = coalesce(f.equipment_number, t.equipment_number),
    status_code = coalesce(f.status_code, t.status_code),
    status_description = coalesce(f.status_description, t.status_description),
    updated_at = now()
FROM freshest f
WHERE t.code = f.code
  AND (t.staff_code IS DISTINCT FROM f.staff_code
       OR t.status_code IS DISTINCT FROM f.status_code
       OR t.site_number IS DISTINCT FROM f.site_number
       OR t.equipment_number IS DISTINCT FROM f.equipment_number);

SELECT wo_seed_from_onkey();

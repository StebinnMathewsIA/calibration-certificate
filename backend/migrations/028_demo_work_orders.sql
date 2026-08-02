-- TEMPORARY demo work orders (#95) so the lifecycle UI and the scheduler
-- can be built and tested before the FIELDOPS report and the real test
-- work orders exist. Every row is is_demo = true and visible to any
-- signed-in user.
--
-- DELETE WHEN THE REAL DATA ARRIVES:
--     DELETE FROM work_orders WHERE is_demo;
--
-- Fictional sites and assets only: no Prowalco customer or technician
-- data. GPS points are real Gauteng coordinates so proximity ranking is
-- exercisable. Idempotent (keyed on external_ref).

INSERT INTO work_orders (
    source, external_ref, staff_code, site_id, site_name, customer_name,
    asset_code, asset_description, work_required, status_code, status_description,
    importance_code, estimated_duration_minutes, received_on, required_by, complete_by,
    gps_location, is_demo
) VALUES
    ('demo', 'DEMO-0001', NULL, 'DEMO-S001', 'DEMO Riverside Motors', 'DEMO Oil Co',
     'DEMO-EQ-1001', 'Dispenser 1 (2 hose)', 'Six-monthly verification of dispenser 1',
     'Allocated', 'Allocated', 'HIGH', 90,
     now() - interval '6 days', now() - interval '2 days', now() - interval '2 days',
     'POINT (28.0473 -26.2041)', true),
    ('demo', 'DEMO-0002', NULL, 'DEMO-S002', 'DEMO Hillcrest Filling Station', 'DEMO Fuels',
     'DEMO-EQ-1002', 'Dispenser 3 (4 hose)', 'Nozzle auto-stop reported faulty, verify and repair',
     'Work Order Received', 'Work Order Received', 'HIGH', 120,
     now() - interval '3 days', now() + interval '6 hours', now() + interval '6 hours',
     'POINT (28.1123 -26.1450)', true),
    ('demo', 'DEMO-0003', NULL, 'DEMO-S003', 'DEMO Northgate Truck Stop', 'DEMO Oil Co',
     'DEMO-EQ-1003', 'High flow dispenser 7', 'Annual verification, high flow rate dispenser',
     'Allocated', 'Allocated', 'MEDIUM', 180,
     now() - interval '1 day', now() + interval '2 days', now() + interval '2 days',
     'POINT (27.9800 -26.0600)', true),
    ('demo', 'DEMO-0004', NULL, 'DEMO-S004', 'DEMO Southway Convenience', 'DEMO Fuels',
     'DEMO-EQ-1004', 'Dispenser 2 (2 hose)', 'Totaliser reading discrepancy reported by site',
     'To be Planned', 'To be Planned', 'LOW', 60,
     now() - interval '12 days', now() + interval '9 days', now() + interval '9 days',
     'POINT (28.2166 -26.3435)', true),
    ('demo', 'DEMO-0005', NULL, 'DEMO-S005', 'DEMO Westrand Garage', 'DEMO Petroleum',
     'DEMO-EQ-1005', 'Dispenser 5 (4 hose)', 'Replace pulsar unit and re-verify affected hoses',
     'Work Resumed', 'Work Resumed', 'MEDIUM', 150,
     now() - interval '9 days', now() + interval '1 day', now() + interval '1 day',
     'POINT (27.8546 -26.1367)', true),
    ('demo', 'DEMO-0006', NULL, 'DEMO-S006', 'DEMO Eastgate Service Centre', 'DEMO Oil Co',
     'DEMO-EQ-1006', 'Dispenser 4 (2 hose)', 'Verification after board replacement',
     'Allocated', 'Allocated', 'HIGH', 75,
     now() - interval '4 days', now() - interval '12 hours', now() - interval '12 hours',
     'POINT (28.1300 -26.1800)', true)
-- The unique index on external_ref is partial, so the predicate repeats here.
ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO NOTHING;

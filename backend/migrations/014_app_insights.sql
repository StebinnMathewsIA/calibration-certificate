-- Architecture v2 phase 5 (#64, #56): Insights for all users, scoped by the
-- caller's JWT — the "RLS" the owner asked for lives in this function: a
-- technician (or a demo alias riding one) sees THEIR numbers; the company
-- block is aggregate-only (no PII). Manager/admin scoping extends here when
-- the role model lands with the web app (phase 6).
-- Idempotent; applied by apply_migrations.py.

CREATE OR REPLACE FUNCTION app_insights() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    sc text := app_staff_code();
    subject text := coalesce(auth.jwt() ->> 'sub', '');
    me jsonb;
    certs jsonb;
    company jsonb;
BEGIN
    SELECT jsonb_build_object(
        'staffCode', sc,
        'openByStatus', coalesce((
            SELECT jsonb_object_agg(s.status_description, s.n)
            FROM (SELECT w.status_description, count(*) AS n
                  FROM onkey_workorders w
                  WHERE w.staff_code = sc
                    AND w.status_description = ANY (app_open_statuses())
                  GROUP BY w.status_description) s), '{}'::jsonb),
        'openTotal', (SELECT count(*) FROM onkey_workorders w
                      WHERE w.staff_code = sc
                        AND w.status_description = ANY (app_open_statuses())),
        'completedLast30', (SELECT count(*) FROM onkey_workorders w
                            WHERE w.staff_code = sc
                              AND NOT (w.status_description = ANY (app_open_statuses()))
                              AND coalesce(w.completed_on, w.status_changed_on)
                                  >= now() - interval '30 days'),
        'monthlyCompleted', coalesce((
            SELECT jsonb_agg(jsonb_build_object('month', m.month, 'count', m.n)
                             ORDER BY m.month)
            FROM (SELECT to_char(date_trunc('month',
                             coalesce(w.completed_on, w.status_changed_on)), 'YYYY-MM') AS month,
                         count(*) AS n
                  FROM onkey_workorders w
                  WHERE w.staff_code = sc
                    AND NOT (w.status_description = ANY (app_open_statuses()))
                    AND coalesce(w.completed_on, w.status_changed_on)
                        >= date_trunc('month', now()) - interval '5 months'
                  GROUP BY 1) m), '[]'::jsonb),
        'openSites', (SELECT count(DISTINCT w.site_number) FROM onkey_workorders w
                      WHERE w.staff_code = sc AND w.site_number IS NOT NULL
                        AND w.status_description = ANY (app_open_statuses())))
    INTO me;

    SELECT jsonb_build_object(
        'issuedByMe', (SELECT count(*) FROM certificates c
                       WHERE c.technician_subject = subject),
        'last30ByMe', (SELECT count(*) FROM certificates c
                       WHERE c.technician_subject = subject
                         AND c.signed_at >= now() - interval '30 days'),
        'lastIssuedAt', (SELECT to_char(max(c.signed_at) AT TIME ZONE 'UTC',
                                        'YYYY-MM-DD"T"HH24:MI:SS"+00:00"')
                         FROM certificates c WHERE c.technician_subject = subject),
        'expiringSoon60', (SELECT count(*) FROM certificates c
                           WHERE c.technician_subject = subject
                             AND (c.form_json -> 'signOff' ->> 'expiryDate')
                                 BETWEEN to_char(now(), 'YYYY-MM-DD')
                                     AND to_char(now() + interval '60 days', 'YYYY-MM-DD')))
    INTO certs;

    SELECT jsonb_build_object(
        'openTotal', (SELECT count(*) FROM onkey_workorders w
                      WHERE w.status_description = ANY (app_open_statuses())),
        'techniciansWithOpen', (SELECT count(DISTINCT w.staff_code) FROM onkey_workorders w
                                WHERE w.staff_code IS NOT NULL
                                  AND w.status_description = ANY (app_open_statuses())),
        'sitesWithOpen', (SELECT count(DISTINCT w.site_number) FROM onkey_workorders w
                          WHERE w.site_number IS NOT NULL
                            AND w.status_description = ANY (app_open_statuses())),
        'certificatesTotal', (SELECT count(*) FROM certificates),
        'certificatesLast30', (SELECT count(*) FROM certificates c
                               WHERE c.signed_at >= now() - interval '30 days'))
    INTO company;

    RETURN jsonb_build_object('me', me, 'certificates', certs, 'company', company,
                              'generatedAt', to_char(now() AT TIME ZONE 'UTC',
                                                     'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'));
END $$;

REVOKE ALL ON FUNCTION app_insights() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_insights() TO authenticated;

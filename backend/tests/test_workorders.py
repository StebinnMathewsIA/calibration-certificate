"""Live tests for the simulated OnKey provider + canonical store + resolution.

Mutation tests use unique IDs so repeated runs against the real Supabase
project stay idempotent and never collide with the static seed IDs.
"""
import uuid


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def test_workorders_require_auth(raw_client):
    assert raw_client.get("/v1/workorders").status_code == 401


def test_list_workorders_for_signed_in_technician(client):
    resp = client.get("/v1/workorders")
    assert resp.status_code == 200, resp.text
    work_orders = resp.json()["workOrders"]
    # The seed assigns WO-001 to the E2E technician's email.
    wo = next((w for w in work_orders if w["id"] == "WO-001"), None)
    assert wo is not None
    assert wo["site"]["customerName"] == "Engen"


def test_get_workorder_bundle_resolves_site_and_registry_dispensers(client):
    # Dispensers come ONLY from our registry (#209): the OnKey seed is off,
    # so a bundle carries store rows and nothing materialises from seeds.
    disp_id = _uid("DISP-B")
    created = client.post(
        "/v1/dispensers",
        json={
            "id": disp_id,
            "siteId": "SITE-001",
            "make": "Tatsuno",
            "model": "SS-LX-E",
            "serialNumber": f"TSN-{disp_id}",
            "saApprovalNumber": "119-AA20",
        },
    )
    assert created.status_code == 200, created.text

    resp = client.get("/v1/workorders/WO-001")
    assert resp.status_code == 200, resp.text
    bundle = resp.json()
    assert bundle["workOrder"]["id"] == "WO-001"
    assert bundle["site"]["siteName"] == "North Road Fuel Depot"
    ids = {d["id"] for d in bundle["dispensers"]}
    assert disp_id in ids
    assert all(d["inStore"] for d in bundle["dispensers"])


def test_list_sites_for_technician(client):
    resp = client.get("/v1/sites")
    assert resp.status_code == 200, resp.text
    ids = {s["id"] for s in resp.json()["sites"]}
    assert "SITE-001" in ids  # the E2E technician's work-order site


def test_list_site_dispensers_registry_only(client):
    # Registry rows only (#209): every row returned is a stored record.
    resp = client.get("/v1/sites/SITE-001/dispensers")
    assert resp.status_code == 200, resp.text
    assert all(d["inStore"] for d in resp.json()["dispensers"])


def test_workorder_not_assigned_is_forbidden(client):
    # WO-002 is assigned to a different technician email in the seed.
    resp = client.get("/v1/workorders/WO-002")
    assert resp.status_code == 403


def test_add_edit_retire_dispenser_roundtrip(client):
    site_id = "SITE-001"
    disp_id = _uid("DISP-T")

    # Add a dispenser OnKey doesn't know about.
    add = client.post(
        "/v1/dispensers",
        json={
            "id": disp_id,
            "siteId": site_id,
            "make": "Tatsuno",
            "model": "SS-LX-E",
            "serialNumber": "TSN-TEST-1",
            "saApprovalNumber": "119-AA20",
        },
    )
    assert add.status_code == 200, add.text
    body = add.json()
    assert body["source"] == "manual"
    assert body["status"] == "active"

    # It re-serves from our canonical store.
    got = client.get(f"/v1/dispensers/{disp_id}")
    assert got.status_code == 200
    assert got.json()["serialNumber"] == "TSN-TEST-1"

    # Edit its identity (persisted).
    edited = client.post(
        f"/v1/dispensers/{disp_id}",
        json={
            "make": "Tatsuno",
            "model": "SS-LX-F",
            "serialNumber": "TSN-TEST-2",
            "saApprovalNumber": "119-AA20",
        },
    )
    assert edited.status_code == 200
    assert edited.json()["model"] == "SS-LX-F"
    assert client.get(f"/v1/dispensers/{disp_id}").json()["serialNumber"] == "TSN-TEST-2"

    # Retire it (soft status change, never deleted).
    retired = client.post(f"/v1/dispensers/{disp_id}/retire")
    assert retired.status_code == 200
    assert retired.json()["status"] == "retired"
    assert client.get(f"/v1/dispensers/{disp_id}").json()["status"] == "retired"


def test_unknown_dispenser_never_materialises_from_seed(client):
    # The OnKey seed is switched off (#209): an id we do not hold is a 404
    # on read AND on edit; nothing quietly creates a record from a seed.
    ghost = _uid("DISP-GHOST")
    assert client.get(f"/v1/dispensers/{ghost}").status_code == 404
    resp = client.post(
        f"/v1/dispensers/{ghost}",
        json={
            "make": "Tatsuno",
            "model": "SS-LX-E",
            "serialNumber": "TSN-GHOST",
            "saApprovalNumber": "119-AA20",
        },
    )
    assert resp.status_code == 404
    assert client.post(f"/v1/dispensers/{ghost}/retire").status_code == 404


def test_site_upsert_roundtrip(client):
    site_id = _uid("SITE-T")
    # Unknown site with no seed -> 404 before it is created.
    assert client.get(f"/v1/sites/{site_id}").status_code == 404

    up = client.post(
        f"/v1/sites/{site_id}",
        json={
            "customerName": "BP",
            "siteName": "Test Depot",
            "address": "1 Test Rd, Jhb",
            "telephone": "011 000 0000",
        },
    )
    assert up.status_code == 200, up.text
    assert up.json()["source"] == "manual"
    got = client.get(f"/v1/sites/{site_id}")
    assert got.status_code == 200
    assert got.json()["address"] == "1 Test Rd, Jhb"


def test_dispenser_detail_roundtrip(client):
    disp_id = _uid("DISP-D")
    detail = {
        "qMinLpm": 15,
        "qMaxLpm": 130,
        "hoses": [
            {
                "hoseNumber": "1",
                "product": "ULP 95",
                "components": {
                    "meter": {"make": "Tatsuno", "serial": "M-1"},
                    "pcBoard": {"make": "Tatsuno", "serial": "P-1"},
                    "pulsar": {"make": "Tatsuno", "serial": "PU-1"},
                    "solenoid": {"make": "Tatsuno", "serial": "S-1"},
                },
            }
        ],
    }
    # Empty register before anything is saved.
    empty = client.get(f"/v1/dispensers/{disp_id}/detail")
    assert empty.status_code == 200
    assert empty.json()["hoses"] == []

    saved = client.post(f"/v1/dispensers/{disp_id}/detail", json=detail)
    assert saved.status_code == 200, saved.text
    assert saved.json()["qMaxLpm"] == 130

    got = client.get(f"/v1/dispensers/{disp_id}/detail")
    assert got.status_code == 200
    assert len(got.json()["hoses"]) == 1
    assert got.json()["hoses"][0]["hoseNumber"] == "1"

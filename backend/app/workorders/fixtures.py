"""Seed data for the simulated OnKey provider.

This stands in for what Prowalco's OnKey asset system would return. It is
deliberately PARTIAL in places (missing dispenser identity, missing site
telephone) to exercise the seed -> technician-fills -> we-persist flow: OnKey
stops at dispenser level and is often incomplete, and the technician completes
the record on-site.

The technician's sign-in email is the join key. `E2E_TECHNICIAN_EMAIL` matches
the account the live test suite provisions, so backend tests can fetch work
orders end-to-end.
"""

E2E_TECHNICIAN_EMAIL = "calibration-e2e@example.com"

# Demo technician so the owner sees work orders on first sign-in. Add more
# real technician sign-in emails here (or swap in the real OnKeyProvider).
DEMO_TECHNICIAN_EMAIL = "stebinn@gmail.com"

TECHNICIANS: dict[str, dict] = {
    E2E_TECHNICIAN_EMAIL: {"email": E2E_TECHNICIAN_EMAIL, "name": "E2E Technician"},
    "thabo@prowalco.example": {"email": "thabo@prowalco.example", "name": "Thabo M."},
    DEMO_TECHNICIAN_EMAIL: {"email": DEMO_TECHNICIAN_EMAIL, "name": "Prowalco Demo"},
}

SITES: dict[str, dict] = {
    "SITE-001": {
        "id": "SITE-001",
        "customerName": "Engen",
        "siteName": "North Road Fuel Depot",
        "address": "75 North Road, O.R. Tambo, Boksburg, 1459",
        "telephone": "011 617 6000",
    },
    # Deliberately partial: no address, no telephone — technician completes it.
    "SITE-002": {
        "id": "SITE-002",
        "customerName": "Shell",
        "siteName": "Rivonia Service Station",
    },
    "SITE-003": {
        "id": "SITE-003",
        "customerName": "BP",
        "siteName": "Midrand Truck Stop",
        "address": "Old Pretoria Rd, Midrand, 1685",
        "telephone": "011 000 1234",
    },
}

DISPENSERS: dict[str, dict] = {
    "DISP-001": {
        "id": "DISP-001",
        "siteId": "SITE-001",
        "make": "Tatsuno",
        "model": "SS-LX-E",
        "serialNumber": "TSN-99812",
        "saApprovalNumber": "119-AA20",
    },
    # Deliberately partial: OnKey knows the asset exists but not its identity.
    "DISP-002": {
        "id": "DISP-002",
        "siteId": "SITE-001",
    },
    "DISP-101": {
        "id": "DISP-101",
        "siteId": "SITE-002",
        "make": "Tatsuno",
        "model": "SS-LX-E",
        "serialNumber": "TSN-10233",
        "saApprovalNumber": "119-AA20",
    },
    "DISP-201": {
        "id": "DISP-201",
        "siteId": "SITE-003",
        "make": "Tatsuno",
        "model": "SS-LX-E",
        "serialNumber": "TSN-20455",
        "saApprovalNumber": "119-AA20",
    },
    # Deliberately partial — the demo technician completes its identity on-site.
    "DISP-202": {
        "id": "DISP-202",
        "siteId": "SITE-003",
    },
}

WORK_ORDERS: dict[str, dict] = {
    "WO-001": {
        "id": "WO-001",
        "reference": "WO-4711",
        "assignedTechnicianEmail": E2E_TECHNICIAN_EMAIL,
        "siteId": "SITE-001",
        "dispenserIds": ["DISP-001", "DISP-002"],
        "status": "open",
        "scheduledDate": "2026-07-16",
    },
    "WO-002": {
        "id": "WO-002",
        "reference": "WO-4712",
        "assignedTechnicianEmail": "thabo@prowalco.example",
        "siteId": "SITE-002",
        "dispenserIds": ["DISP-101"],
        "status": "open",
        "scheduledDate": "2026-07-17",
    },
    "WO-003": {
        "id": "WO-003",
        "reference": "WO-4713",
        "assignedTechnicianEmail": DEMO_TECHNICIAN_EMAIL,
        "siteId": "SITE-003",
        "dispenserIds": ["DISP-201", "DISP-202"],
        "status": "open",
        "scheduledDate": "2026-07-18",
    },
}

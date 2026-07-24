"""OnKey WOE001 sync (#47): pure units — XML parsing, hashing, chunking."""
from datetime import datetime

from app.workorders.onkey_sync import (
    export_chunked,
    parse_export_xml,
    parse_start_date,
    row_content_hash,
    split_date_range,
)

SAMPLE_XML = """<Rows>
  <Row><WONumber>WO-1</WONumber><StartDate>2026-07-01T08:00:00.000+02:00</StartDate><Site>Alpha</Site></Row>
  <Row><WONumber>WO-2</WONumber><StartDate>2026-07-02T09:30:00.000+02:00</StartDate><Site>Beta</Site></Row>
</Rows>"""


def test_parse_export_xml_keeps_all_columns():
    rows = parse_export_xml(SAMPLE_XML)
    assert len(rows) == 2
    assert rows[0] == {
        "WONumber": "WO-1",
        "StartDate": "2026-07-01T08:00:00.000+02:00",
        "Site": "Alpha",
    }


def test_row_hash_stable_and_order_independent():
    a = {"x": "1", "y": "2"}
    b = {"y": "2", "x": "1"}
    assert row_content_hash(a) == row_content_hash(b)
    assert row_content_hash(a) != row_content_hash({"x": "1", "y": "3"})


def test_parse_start_date():
    assert parse_start_date({"StartDate": "2026-07-01T08:00:00.000+02:00"}) is not None
    assert parse_start_date({"StartDate": "not a date"}) is None
    assert parse_start_date({}) is None


def test_split_date_range_covers_whole_window():
    ranges = split_date_range(datetime(2026, 1, 1), datetime(2026, 3, 15), 31)
    assert ranges[0][0] == datetime(2026, 1, 1)
    assert ranges[-1][1].date() == datetime(2026, 3, 15).date()
    for (_, end_a), (start_b, _) in zip(ranges, ranges[1:]):
        assert start_b > end_a  # no overlap


def test_export_chunked_splits_on_cap_and_dedupes():
    calls = []

    def fetch(start, end):
        calls.append((start, end, (end - start).days))
        span_days = (end - start).days
        if span_days > 7:
            # a "month" chunk hits the cap -> forces a split
            return [{"WONumber": f"cap-{i}"} for i in range(5)]
        # finer chunks return real (overlapping) data to exercise dedupe
        return [{"WONumber": "WO-1"}, {"WONumber": "WO-2"}]

    rows = export_chunked(fetch, datetime(2026, 7, 1), datetime(2026, 7, 20), max_records=5)
    # month chunk capped -> split into weeks; dedupe leaves the two unique rows
    assert {r["WONumber"] for r in rows.values()} == {"WO-1", "WO-2"}
    assert any(days > 7 for (_, _, days) in calls)  # month attempt happened
    assert any(days <= 7 for (_, _, days) in calls)  # split happened

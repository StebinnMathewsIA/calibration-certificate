"""Parity tests — must agree with shared/schema/test/tolerance.test.ts."""
import pytest

from app.tolerance import compute_row


def test_error_ml():
    r = compute_row(20.05, 20.0)
    assert r.error_ml == 50
    assert r.error_percent == 0.25
    assert r.passed is True


def test_negative_error_at_mpe_boundary():
    r = compute_row(19.9, 20.0)
    assert r.error_ml == -100
    assert r.error_percent == -0.5
    assert r.passed is True


def test_outside_tolerance_fails():
    r = compute_row(20.15, 20.0)
    assert r.error_percent == 0.75
    assert r.passed is False


def test_tighter_class():
    r = compute_row(20.08, 20.0, "oiml_r117_class_0_3")
    assert r.error_percent == 0.4
    assert r.passed is False


def test_rounding_boundary():
    r = compute_row(20.0001, 20.0)
    assert r.error_ml == 0.1


def test_invalid_inputs():
    with pytest.raises(ValueError):
        compute_row(20, 20, "nope")
    with pytest.raises(ValueError):
        compute_row(20, 0)

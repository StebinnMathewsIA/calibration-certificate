"""Parity tests — must agree with shared/schema/test/tolerance.test.ts."""
import pytest

from app.tolerance import MPE_PERCENT, compute_efd


def test_efd_at_mpe_boundary():
    r = compute_efd(20100, 20000)
    assert r.efd_percent == 0.5
    assert r.passed is True


def test_negative_efd_at_boundary():
    r = compute_efd(19900, 20000)
    assert r.efd_percent == -0.5
    assert r.passed is True


def test_outside_mpe_fails():
    r = compute_efd(20150, 20000)
    assert r.efd_percent == 0.75
    assert r.passed is False


def test_small_efd_passes():
    r = compute_efd(20010, 20000)
    assert r.efd_percent == 0.05
    assert r.passed is True


def test_rounding_boundary():
    # 20005/20000 = 1.00025 -> 0.025% -> rounds to 0.03 at 2 dp
    r = compute_efd(20005, 20000)
    assert r.efd_percent == 0.03


def test_mpe_is_half_percent():
    assert MPE_PERCENT == 0.5


def test_invalid_inputs():
    with pytest.raises(ValueError):
        compute_efd(20000, 0)
    with pytest.raises(ValueError):
        compute_efd(20000, -1)

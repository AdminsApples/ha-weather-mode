"""Tests for the condition-to-overlay mapping."""

import pytest

from custom_components.weather_mode.effects import PREVIEW_EFFECTS, build_overlay


def overlay(condition, night=False, **attrs):
    return build_overlay(condition, attrs, is_night=night, frost_below_c=1.0)


def test_rain_is_rain_not_snow():
    o = overlay("rainy", temperature=8)
    assert o.rain > 0 and o.snow == 0 and o.frost == 0


def test_sunny_day_has_rays_night_has_stars():
    assert overlay("sunny").sun == 1 and overlay("sunny").stars == 0
    night = overlay("sunny", night=True)
    assert night.sun == 0 and night.stars == 1


def test_frost_when_cold_and_dry():
    o = overlay("sunny", temperature=-2, temperature_unit="°C")
    assert 0.5 < o.frost <= 1
    assert overlay("sunny", temperature=5).frost == 0
    # No frost while it's raining.
    assert overlay("rainy", temperature=0).frost == 0


def test_frost_in_fahrenheit():
    assert overlay("clear-night", temperature=28, temperature_unit="°F").frost > 0
    assert overlay("clear-night", temperature=40, temperature_unit="°F").frost == 0


def test_wind_from_speed():
    assert overlay("cloudy", wind_speed=10, wind_speed_unit="km/h").wind == 0
    assert overlay("cloudy", wind_speed=12, wind_speed_unit="m/s").wind > 0  # 43 km/h
    assert overlay("windy").wind == 1


@pytest.mark.parametrize(
    ("condition", "field"),
    [
        ("cloudy", "clouds"),
        ("fog", "fog"),
        ("pouring", "rain"),
        ("snowy", "snow"),
        ("hail", "hail"),
        ("clear-night", "stars"),
    ],
)
def test_conditions(condition, field):
    assert getattr(overlay(condition), field) > 0


def test_thunder():
    assert overlay("lightning-rainy").lightning
    assert not overlay("rainy").lightning


def test_sleet_is_both():
    o = overlay("snowy-rainy")
    assert o.snow > 0 and o.rain > 0


def test_intensity_scales_and_caps():
    o = build_overlay("rainy", {}, is_night=False, frost_below_c=1, intensity=0.5)
    assert o.rain == pytest.approx(0.225)
    o = build_overlay("pouring", {}, is_night=False, frost_below_c=1, intensity=1.5)
    assert o.rain == 1


def test_every_preview_effect_draws_something():
    for effect in PREVIEW_EFFECTS[1:]:
        o = overlay(effect)
        d = o.as_dict()
        assert any(v for k, v in d.items() if k != "condition"), effect


def test_unknown_condition_is_empty():
    o = overlay("unavailable")
    assert not any(v for k, v in o.as_dict().items() if k != "condition")

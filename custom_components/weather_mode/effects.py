"""Turn a weather entity's state into a description of the screen overlay.

No Home Assistant imports here so it is easy to unit test.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

# Effects the preview selector can force. "auto" follows the weather entity.
EFFECT_AUTO = "auto"
PREVIEW_EFFECTS = [
    EFFECT_AUTO,
    "sunny",
    "clear-night",
    "partlycloudy",
    "cloudy",
    "fog",
    "rainy",
    "pouring",
    "lightning-rainy",
    "snowy",
    "snowy-rainy",
    "hail",
    "windy",
    "frost",
]

WIND_STRONG_KMH = 30.0


@dataclass(slots=True)
class Overlay:
    """What the frontend should draw. Levels run 0 (none) to 1 (lots)."""

    condition: str | None = None
    rain: float = 0.0
    snow: float = 0.0
    hail: float = 0.0
    clouds: float = 0.0
    sun: float = 0.0
    stars: float = 0.0
    fog: float = 0.0
    frost: float = 0.0
    lightning: bool = False
    wind: float = 0.0
    dark_clouds: bool = False

    def scaled(self, intensity: float) -> Overlay:
        """Scale particle amounts by the user's intensity setting."""
        for name in ("rain", "snow", "hail", "clouds", "fog", "wind", "stars", "sun", "frost"):
            setattr(self, name, round(min(1.0, getattr(self, name) * intensity), 3))
        return self

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def to_celsius(value: Any, unit: str | None) -> float | None:
    try:
        temp = float(value)
    except (TypeError, ValueError):
        return None
    if unit and unit.upper().endswith("F"):
        return (temp - 32) * 5 / 9
    return temp


def to_kmh(value: Any, unit: str | None) -> float | None:
    try:
        speed = float(value)
    except (TypeError, ValueError):
        return None
    factors = {"m/s": 3.6, "mph": 1.609344, "kn": 1.852, "ft/s": 1.09728, "km/h": 1.0}
    return speed * factors.get(unit or "km/h", 1.0)


def overlay_for_condition(condition: str | None, *, is_night: bool) -> Overlay:
    """Base overlay for a Home Assistant weather condition."""
    o = Overlay(condition=condition)
    match condition:
        case "sunny":
            if is_night:
                o.stars = 1.0
            else:
                o.sun = 1.0
        case "clear-night":
            o.stars = 1.0
        case "partlycloudy":
            o.clouds = 0.45
            if is_night:
                o.stars = 0.5
            else:
                o.sun = 0.5
        case "cloudy":
            o.clouds = 0.9
        case "fog":
            o.fog = 1.0
            o.clouds = 0.2
        case "rainy":
            o.rain = 0.45
            o.clouds = 0.6
        case "pouring":
            o.rain = 1.0
            o.clouds = 0.9
            o.dark_clouds = True
        case "lightning":
            o.clouds = 0.9
            o.dark_clouds = True
            o.lightning = True
        case "lightning-rainy":
            o.rain = 0.8
            o.clouds = 0.9
            o.dark_clouds = True
            o.lightning = True
        case "hail":
            o.hail = 0.8
            o.rain = 0.2
            o.clouds = 0.8
            o.dark_clouds = True
        case "snowy":
            o.snow = 0.8
            o.clouds = 0.4
        case "snowy-rainy":
            o.snow = 0.45
            o.rain = 0.4
            o.clouds = 0.6
        case "windy":
            o.wind = 1.0
        case "windy-variant":
            o.wind = 1.0
            o.clouds = 0.6
        case "exceptional":
            o.wind = 0.6
            o.clouds = 0.8
            o.dark_clouds = True
        case "frost":  # Not a real HA condition, only used by the preview selector.
            o.frost = 1.0
            if is_night:
                o.stars = 0.6
            else:
                o.sun = 0.4
    return o


def build_overlay(
    condition: str | None,
    attributes: dict[str, Any],
    *,
    is_night: bool,
    frost_below_c: float,
    intensity: float = 1.0,
    use_wind: bool = True,
) -> Overlay:
    """Overlay for the current weather, including frost and wind extras."""
    o = overlay_for_condition(condition, is_night=is_night)

    temp_c = to_celsius(attributes.get("temperature"), attributes.get("temperature_unit"))
    if temp_c is not None and temp_c <= frost_below_c and o.rain == 0:
        # Colder means thicker frost: full coverage at 4 degrees below the threshold.
        o.frost = max(o.frost, min(1.0, 0.5 + (frost_below_c - temp_c) / 8))

    if use_wind and o.wind == 0:
        speed = to_kmh(attributes.get("wind_speed"), attributes.get("wind_speed_unit"))
        if speed is not None and speed >= WIND_STRONG_KMH:
            o.wind = min(1.0, 0.4 + (speed - WIND_STRONG_KMH) / 40)

    return o.scaled(intensity)

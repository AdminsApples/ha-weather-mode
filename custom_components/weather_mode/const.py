"""Constants for Weather Mode."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "weather_mode"
LAB_FEATURE: Final = "weather_mode"

CONF_WEATHER_ENTITY: Final = "weather_entity"
CONF_INTENSITY: Final = "intensity"
CONF_FROST_BELOW: Final = "frost_below"
CONF_USE_WIND: Final = "use_wind"
CONF_SHOW_ON_MOBILE: Final = "show_on_mobile"
CONF_HIDE_WINTER_MODE: Final = "hide_winter_mode"

DEFAULT_INTENSITY: Final = "normal"
DEFAULT_FROST_BELOW: Final = 1.0
DEFAULT_USE_WIND: Final = True
DEFAULT_SHOW_ON_MOBILE: Final = True
DEFAULT_HIDE_WINTER_MODE: Final = True

INTENSITY_LEVELS: Final = {"subtle": 0.5, "normal": 1.0, "strong": 1.5}

URL_BASE: Final = "/weather_mode_static"
JS_FILE: Final = "weather-mode.js"

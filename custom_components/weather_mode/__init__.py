"""Weather Mode: a screen overlay that shows the real weather."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url, remove_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import DOMAIN, JS_FILE, URL_BASE
from .controller import WeatherModeController
from .websocket import async_register_websocket

PLATFORMS: list[Platform] = [Platform.SELECT]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type WeatherModeConfigEntry = ConfigEntry[WeatherModeController]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the frontend file and register the websocket command once."""
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_BASE, str(Path(__file__).parent / "frontend"), False)]
    )
    async_register_websocket(hass)
    return True


def _js_url(version: str) -> str:
    return f"{URL_BASE}/{JS_FILE}?v={version}"


async def async_setup_entry(hass: HomeAssistant, entry: WeatherModeConfigEntry) -> bool:
    """Set up Weather Mode from a config entry."""
    controller = WeatherModeController(hass, entry)
    await controller.async_start()
    entry.runtime_data = controller
    entry.async_on_unload(controller.async_stop)

    integration = await async_get_integration(hass, DOMAIN)
    url = _js_url(str(integration.version))
    add_extra_js_url(hass, url)
    entry.async_on_unload(lambda: remove_extra_js_url(hass, url))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def _async_options_updated(hass: HomeAssistant, entry: WeatherModeConfigEntry) -> None:
    entry.runtime_data.async_refresh()


async def async_unload_entry(hass: HomeAssistant, entry: WeatherModeConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

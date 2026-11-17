"""Preview selector: force an effect so you can see what each one looks like."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DOMAIN
from .controller import WeatherModeController
from .effects import PREVIEW_EFFECTS


async def async_setup_entry(
    hass: HomeAssistant, entry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    async_add_entities([WeatherModePreviewSelect(entry.runtime_data)])


class WeatherModePreviewSelect(SelectEntity, RestoreEntity):
    """Auto follows the weather; anything else forces that effect."""

    _attr_has_entity_name = True
    _attr_translation_key = "effect"
    _attr_icon = "mdi:weather-partly-snowy-rainy"
    _attr_options = PREVIEW_EFFECTS

    def __init__(self, controller: WeatherModeController) -> None:
        self._controller = controller
        self._attr_unique_id = f"{controller.entry.entry_id}_effect"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, controller.entry.entry_id)},
            name="Weather Mode",
            manufacturer="Weather Mode",
            entry_type=DeviceEntryType.SERVICE,
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self.async_get_last_state()) and last.state in PREVIEW_EFFECTS:
            self._controller.async_set_preview(last.state)

    @property
    def current_option(self) -> str:
        return self._controller.preview

    async def async_select_option(self, option: str) -> None:
        self._controller.async_set_preview(option)
        self.async_write_ha_state()

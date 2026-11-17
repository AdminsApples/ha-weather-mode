"""Config flow for Weather Mode."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)
import voluptuous as vol

from .const import (
    CONF_FROST_BELOW,
    CONF_HIDE_WINTER_MODE,
    CONF_INTENSITY,
    CONF_SHOW_ON_MOBILE,
    CONF_USE_WIND,
    CONF_WEATHER_ENTITY,
    DEFAULT_FROST_BELOW,
    DEFAULT_HIDE_WINTER_MODE,
    DEFAULT_INTENSITY,
    DEFAULT_SHOW_ON_MOBILE,
    DEFAULT_USE_WIND,
    DOMAIN,
    INTENSITY_LEVELS,
)

WEATHER_SELECTOR = EntitySelector(EntitySelectorConfig(domain="weather"))


def _options_schema(current: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_WEATHER_ENTITY, default=current.get(CONF_WEATHER_ENTITY, vol.UNDEFINED)
            ): WEATHER_SELECTOR,
            vol.Required(
                CONF_INTENSITY, default=current.get(CONF_INTENSITY, DEFAULT_INTENSITY)
            ): SelectSelector(
                SelectSelectorConfig(
                    options=list(INTENSITY_LEVELS),
                    translation_key=CONF_INTENSITY,
                    mode=SelectSelectorMode.LIST,
                )
            ),
            vol.Required(
                CONF_FROST_BELOW, default=current.get(CONF_FROST_BELOW, DEFAULT_FROST_BELOW)
            ): NumberSelector(
                NumberSelectorConfig(
                    min=-10,
                    max=5,
                    step=0.5,
                    unit_of_measurement="°C",
                    mode=NumberSelectorMode.BOX,
                )
            ),
            vol.Required(
                CONF_USE_WIND, default=current.get(CONF_USE_WIND, DEFAULT_USE_WIND)
            ): BooleanSelector(),
            vol.Required(
                CONF_SHOW_ON_MOBILE,
                default=current.get(CONF_SHOW_ON_MOBILE, DEFAULT_SHOW_ON_MOBILE),
            ): BooleanSelector(),
            vol.Required(
                CONF_HIDE_WINTER_MODE,
                default=current.get(CONF_HIDE_WINTER_MODE, DEFAULT_HIDE_WINTER_MODE),
            ): BooleanSelector(),
        }
    )


class WeatherModeConfigFlow(ConfigFlow, domain=DOMAIN):
    """Pick the weather entity to follow."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            if self.hass.states.get(user_input[CONF_WEATHER_ENTITY]) is None:
                errors[CONF_WEATHER_ENTITY] = "entity_not_found"
            else:
                return self.async_create_entry(title="Weather Mode", data={}, options=user_input)

        default_entity = next(iter(sorted(self.hass.states.async_entity_ids("weather"))), None)
        current = user_input or ({CONF_WEATHER_ENTITY: default_entity} if default_entity else {})
        return self.async_show_form(
            step_id="user", data_schema=_options_schema(current), errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry) -> WeatherModeOptionsFlow:
        return WeatherModeOptionsFlow()


class WeatherModeOptionsFlow(OptionsFlow):
    """Change the settings later."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init", data_schema=_options_schema(dict(self.config_entry.options))
        )

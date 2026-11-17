"""Works out what the overlay should show and tells every open browser."""

from __future__ import annotations

from collections.abc import Callable
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event

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
    LAB_FEATURE,
)
from .effects import EFFECT_AUTO, build_overlay

_LOGGER = logging.getLogger(__name__)

try:  # Labs arrived in Home Assistant 2025.12.
    from homeassistant.components.labs import async_is_preview_feature_enabled
except ImportError:  # pragma: no cover
    async_is_preview_feature_enabled = None

try:  # Newer releases (2026.3+); older ones only have async_listen.
    from homeassistant.components.labs import async_subscribe_preview_feature
except ImportError:  # pragma: no cover
    async_subscribe_preview_feature = None
    try:
        from homeassistant.components.labs import async_listen as _labs_listen
    except ImportError:
        _labs_listen = None
else:
    _labs_listen = None

SUN_ENTITY = "sun.sun"

type Subscriber = Callable[[dict[str, Any]], None]

OFF_PAYLOAD: dict[str, Any] = {"enabled": False}


class OverlayHub:
    """Lives for the whole HA run, so browsers stay subscribed across reloads."""

    def __init__(self) -> None:
        self.payload: dict[str, Any] = OFF_PAYLOAD
        self._subscribers: set[Subscriber] = set()

    @callback
    def async_subscribe(self, subscriber: Subscriber) -> Callable[[], None]:
        self._subscribers.add(subscriber)
        subscriber(self.payload)

        @callback
        def _remove() -> None:
            self._subscribers.discard(subscriber)

        return _remove

    @callback
    def async_publish(self, payload: dict[str, Any]) -> None:
        if payload == self.payload:
            return
        self.payload = payload
        for subscriber in list(self._subscribers):
            try:
                subscriber(payload)
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Error sending weather overlay update")


@callback
def async_get_hub(hass: HomeAssistant) -> OverlayHub:
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = OverlayHub()
    return hass.data[DOMAIN]


class WeatherModeController:
    """Holds the current overlay and the browsers listening for it."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.preview: str = EFFECT_AUTO
        self.hub = async_get_hub(hass)
        self._unsubs: list[Callable[[], None]] = []
        self._entity_unsub: Callable[[], None] | None = None

    # --- settings -------------------------------------------------------------
    def _opt(self, key: str, default: Any) -> Any:
        return self.entry.options.get(key, self.entry.data.get(key, default))

    @property
    def weather_entity(self) -> str:
        return self._opt(CONF_WEATHER_ENTITY, "")

    @property
    def lab_enabled(self) -> bool:
        if async_is_preview_feature_enabled is None:
            return True
        return async_is_preview_feature_enabled(self.hass, DOMAIN, LAB_FEATURE)

    # --- lifecycle --------------------------------------------------------------
    async def async_start(self) -> None:
        self._track_entities()
        if async_subscribe_preview_feature is not None:

            async def _lab_changed(_data: Any) -> None:
                self.async_refresh()

            self._unsubs.append(
                async_subscribe_preview_feature(self.hass, DOMAIN, LAB_FEATURE, _lab_changed)
            )
        elif _labs_listen is not None:
            self._unsubs.append(_labs_listen(self.hass, DOMAIN, LAB_FEATURE, self.async_refresh))
        self.async_refresh()

    @callback
    def _track_entities(self) -> None:
        @callback
        def _changed(_event: Event[EventStateChangedData]) -> None:
            self.async_refresh()

        self._entity_unsub = async_track_state_change_event(
            self.hass, [self.weather_entity, SUN_ENTITY], _changed
        )

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        if self._entity_unsub is not None:
            self._entity_unsub()
            self._entity_unsub = None
        # Tell open browsers to clear the overlay.
        self.hub.async_publish(OFF_PAYLOAD)

    # --- the actual work ------------------------------------------------------
    @callback
    def async_set_preview(self, effect: str) -> None:
        self.preview = effect
        self.async_refresh()

    @callback
    def async_refresh(self) -> None:
        """Recalculate the overlay (also re-tracks entities if options changed)."""
        if self._entity_unsub is not None:
            self._entity_unsub()
            self._track_entities()
        self.hub.async_publish(self.build_payload())

    def build_payload(self) -> dict[str, Any]:
        state = self.hass.states.get(self.weather_entity)
        sun = self.hass.states.get(SUN_ENTITY)
        is_night = sun is not None and sun.state == "below_horizon"

        attributes: dict[str, Any] = dict(state.attributes) if state else {}
        condition = state.state if state else None
        if self.preview != EFFECT_AUTO:
            condition = self.preview
            # Previews shouldn't pick up frost or wind from the real weather.
            attributes = {}

        intensity = INTENSITY_LEVELS.get(
            self._opt(CONF_INTENSITY, DEFAULT_INTENSITY), INTENSITY_LEVELS[DEFAULT_INTENSITY]
        )
        overlay = build_overlay(
            condition,
            attributes,
            is_night=is_night,
            frost_below_c=float(self._opt(CONF_FROST_BELOW, DEFAULT_FROST_BELOW)),
            intensity=intensity,
            use_wind=bool(self._opt(CONF_USE_WIND, DEFAULT_USE_WIND)),
        )
        return {
            "enabled": self.lab_enabled,
            "preview": self.preview != EFFECT_AUTO,
            "night": is_night,
            "show_on_mobile": bool(self._opt(CONF_SHOW_ON_MOBILE, DEFAULT_SHOW_ON_MOBILE)),
            "hide_winter_mode": bool(self._opt(CONF_HIDE_WINTER_MODE, DEFAULT_HIDE_WINTER_MODE)),
            "overlay": overlay.as_dict(),
        }

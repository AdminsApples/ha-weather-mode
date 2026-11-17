"""Integration tests: config flow, Labs toggle, websocket and preview select."""

from homeassistant import config_entries
from homeassistant.components.labs import async_update_preview_feature
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component

from custom_components.weather_mode.const import (
    CONF_HIDE_WINTER_MODE,
    CONF_WEATHER_ENTITY,
    DOMAIN,
    LAB_FEATURE,
)


async def _setup(hass):
    hass.states.async_set("weather.home", "rainy", {"temperature": 7, "temperature_unit": "°C"})
    hass.states.async_set("sun.sun", "above_horizon")
    assert await async_setup_component(hass, "labs", {})
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["data_schema"]({})[CONF_WEATHER_ENTITY] == "weather.home"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_WEATHER_ENTITY: "weather.home"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    return result["result"]


async def test_flow_and_websocket(hass, hass_ws_client):
    entry = await _setup(hass)
    assert entry.options[CONF_HIDE_WINTER_MODE] is True

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/subscribe"})
    msg = await client.receive_json()
    assert msg["success"]
    msg = await client.receive_json()
    payload = msg["event"]
    # Labs toggle is off by default, so nothing shows yet.
    assert payload["enabled"] is False
    assert payload["overlay"]["rain"] > 0

    # Turn on Weather mode in Labs.
    await async_update_preview_feature(hass, DOMAIN, LAB_FEATURE, True)
    await hass.async_block_till_done()
    payload = (await client.receive_json())["event"]
    assert payload["enabled"] is True

    # Weather turns to snow and freezing: overlay follows.
    hass.states.async_set("weather.home", "snowy", {"temperature": -3})
    await hass.async_block_till_done()
    payload = (await client.receive_json())["event"]
    assert payload["overlay"]["snow"] > 0
    assert payload["overlay"]["rain"] == 0
    assert payload["overlay"]["frost"] > 0

    # Preview select forces an effect.
    select = "select.weather_mode_effect"
    assert hass.states.get(select).state == "auto"
    await hass.services.async_call(
        "select", "select_option", {"entity_id": select, "option": "sunny"}, blocking=True
    )
    payload = (await client.receive_json())["event"]
    assert payload["preview"] is True
    assert payload["overlay"]["sun"] == 1
    assert payload["overlay"]["frost"] == 0

    # Unloading tells browsers to clear the overlay.
    assert await hass.config_entries.async_unload(entry.entry_id)
    payload = (await client.receive_json())["event"]
    assert payload == {"enabled": False}


async def test_single_instance(hass):
    await _setup(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


async def test_js_served(hass, hass_client):
    await _setup(hass)
    client = await hass_client()
    resp = await client.get("/weather_mode_static/weather-mode.js")
    assert resp.status == 200
    assert "weather_mode/subscribe" in await resp.text()
    from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL

    urls = hass.data[DATA_EXTRA_MODULE_URL].urls
    assert any(u.startswith("/weather_mode_static/weather-mode.js?v=") for u in urls)

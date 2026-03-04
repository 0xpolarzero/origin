use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::constants::SETTINGS_STORE;

pub const LINUX_DISPLAY_CONFIG_KEY: &str = "linuxDisplayConfig";

#[derive(Default, Serialize, Deserialize)]
struct DisplayConfig {
    wayland: Option<bool>,
}

pub fn read_wayland(app: &AppHandle) -> Option<bool> {
    let store = app.store(SETTINGS_STORE).ok()?;
    let root = store.get(LINUX_DISPLAY_CONFIG_KEY)?;
    serde_json::from_value::<DisplayConfig>(root).ok()?.wayland
}

pub fn write_wayland(app: &AppHandle, value: bool) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.set(
        LINUX_DISPLAY_CONFIG_KEY,
        json!(DisplayConfig {
            wayland: Some(value),
        }),
    );
    store
        .save()
        .map_err(|e| format!("Failed to save settings store: {}", e))?;

    Ok(())
}

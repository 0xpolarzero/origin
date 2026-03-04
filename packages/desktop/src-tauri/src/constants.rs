use tauri_plugin_window_state::StateFlags;

pub const SETTINGS_STORE: &str = "origin.settings.dat";
pub const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";
pub const WSL_ENABLED_KEY: &str = "wslEnabled";
pub const UPDATER_ENABLED: bool = option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some();
pub const ORIGIN_APP_IDS: [&str; 3] = [
    "ai.origin.desktop.dev",
    "ai.origin.desktop",
    "ai.origin.desktop.beta",
];
pub const OPENCODE_APP_IDS: [&str; 3] = [
    "ai.opencode.desktop.dev",
    "ai.opencode.desktop",
    "ai.opencode.desktop.beta",
];

pub fn window_state_flags() -> StateFlags {
    StateFlags::all() - StateFlags::DECORATIONS - StateFlags::VISIBLE
}

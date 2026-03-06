use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

const MAX_LOG_AGE_DAYS: u64 = 7;
const TAIL_LINES: usize = 1000;
const MASK: &str = "[REDACTED]";

static LOG_PATH: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn init(log_dir: &Path) -> WorkerGuard {
    std::fs::create_dir_all(log_dir).expect("failed to create log directory");

    cleanup(log_dir);

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let filename = format!("opencode-desktop_{timestamp}.log");
    let log_path = log_dir.join(&filename);

    LOG_PATH
        .set(log_path.clone())
        .expect("logging already initialized");

    let file = File::create(&log_path).expect("failed to create log file");
    let (non_blocking, guard) = tracing_appender::non_blocking(file);

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            EnvFilter::new("opencode_lib=debug,opencode_desktop=debug,sidecar=debug")
        } else {
            EnvFilter::new("opencode_lib=info,opencode_desktop=info,sidecar=info")
        }
    });

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(std::io::stderr))
        .with(fmt::layer().with_writer(non_blocking).with_ansi(false))
        .init();

    guard
}

pub fn tail() -> String {
    let Some(path) = LOG_PATH.get() else {
        return String::new();
    };

    let Ok(file) = File::open(path) else {
        return String::new();
    };

    let lines: Vec<String> = BufReader::new(file).lines().map_while(Result::ok).collect();

    let start = lines.len().saturating_sub(TAIL_LINES);
    redact(&lines[start..].join("\n"))
}

fn cleanup(log_dir: &Path) {
    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(MAX_LOG_AGE_DAYS * 24 * 60 * 60);

    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };

    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata()
            && let Ok(modified) = meta.modified()
            && modified < cutoff
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn normalize(value: &str) -> String {
    let mut out = String::new();
    let mut underscore = false;
    let mut lower = false;

    for ch in value.chars() {
        if ch.is_ascii_uppercase() {
            if lower && !underscore && !out.is_empty() {
                out.push('_');
            }

            out.push(ch.to_ascii_lowercase());
            underscore = false;
            lower = false;
            continue;
        }

        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            underscore = false;
            lower = ch.is_ascii_lowercase() || ch.is_ascii_digit();
            continue;
        }

        if underscore {
            continue;
        }

        out.push('_');
        underscore = true;
        lower = false;
    }

    out.trim_matches('_').to_string()
}

fn secret(key: &str) -> bool {
    let key = normalize(key);
    [
        "access_token",
        "refresh_token",
        "id_token",
        "session_token",
        "token",
        "secret",
        "password",
        "passphrase",
        "api_key",
        "private_key",
        "client_secret",
        "credential",
        "credentials",
        "authorization",
        "cookie",
    ]
    .iter()
    .any(|item| key == *item || key.ends_with(&format!("_{item}")))
}

fn percent_encode(input: &str) -> String {
    let mut out = String::new();

    for byte in input.bytes() {
        let ch = byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~') {
            out.push(ch);
            continue;
        }

        out.push_str(&format!("%{:02X}", byte));
    }

    out
}

pub(crate) fn redact(input: &str) -> String {
    let mut secrets = std::env::vars()
        .filter(|(key, value)| !value.is_empty() && secret(key))
        .map(|(_, value)| value)
        .filter(|value| value.len() >= 6)
        .collect::<Vec<_>>();
    secrets.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    secrets.dedup();

    secrets.into_iter().fold(input.to_string(), |out, item| {
        let encoded = percent_encode(&item);
        let next = out.replace(&item, MASK);
        if encoded == item {
            return next;
        }
        next.replace(&encoded, MASK)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_masks_secret_env_values() {
        let key = "OPENCODE_TEST_SECRET";
        let value = "phase13-desktop-canary-7c2d1e4f";
        let prior = std::env::var(key).ok();

        unsafe {
            std::env::set_var(key, value);
        }

        let out = redact(&format!("tail: {value}"));

        assert!(out.contains(MASK));
        assert!(!out.contains(value));

        if let Some(prior) = prior {
            unsafe {
                std::env::set_var(key, prior);
            }
        } else {
            unsafe {
                std::env::remove_var(key);
            }
        }
    }

    #[test]
    fn normalize_handles_mixed_key_shapes() {
        assert_eq!(normalize("OpenAIApiKey"), "open_aiapi_key");
        assert!(secret("OPENAI_API_KEY"));
        assert!(secret("clientSecret"));
        assert!(!secret("tokenCount"));
    }

    #[test]
    fn redact_masks_percent_encoded_variants() {
        let key = "OPENCODE_TEST_SECRET";
        let value = "phase13 desktop: canary";
        let prior = std::env::var(key).ok();

        unsafe {
            std::env::set_var(key, value);
        }

        let encoded = percent_encode(value);
        let out = redact(&format!("tail: {encoded}"));

        assert!(out.contains(MASK));
        assert!(!out.contains(&encoded));

        if let Some(prior) = prior {
            unsafe {
                std::env::set_var(key, prior);
            }
        } else {
            unsafe {
                std::env::remove_var(key);
            }
        }
    }
}

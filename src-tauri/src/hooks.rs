use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HookAction {
    Allow,
    Deny { reason: String },
    Warn { message: String },
}

#[derive(Debug, Clone)]
pub struct HookRule {
    pub name: String,
    pub enabled: bool,
    pub tool_pattern: String,
    pub input_field: Option<String>,
    pub input_pattern: Option<String>,
    pub action: HookAction,
}

pub struct HookEngine {
    rules: Vec<HookRule>,
}

impl HookEngine {
    pub fn with_builtins() -> Self {
        Self {
            rules: builtin_safety_rules(),
        }
    }

    pub fn add_rules(&mut self, rules: Vec<HookRule>) {
        self.rules.extend(rules);
    }

    /// Evaluate pre-tool-use hooks. Returns the first Deny or Warn action, or Allow.
    pub fn evaluate_pre_tool_use(&self, tool_name: &str, tool_input: &Value) -> HookAction {
        for rule in &self.rules {
            if !rule.enabled {
                continue;
            }
            // Check tool name pattern
            if !matches_pattern(&rule.tool_pattern, tool_name) {
                continue;
            }
            // Check input field pattern if specified
            if let (Some(field), Some(pattern)) = (&rule.input_field, &rule.input_pattern) {
                let field_value = tool_input
                    .get(field)
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !matches_pattern(pattern, field_value) {
                    continue;
                }
            }
            // Rule matched
            warn!(rule = %rule.name, tool = tool_name, "hook rule triggered");
            return rule.action.clone();
        }
        HookAction::Allow
    }
}

fn matches_pattern(pattern: &str, text: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Ok(re) = Regex::new(pattern) {
        re.is_match(text)
    } else {
        text.contains(pattern)
    }
}

fn builtin_safety_rules() -> Vec<HookRule> {
    vec![
        HookRule {
            name: "block-rm-rf-root".into(),
            enabled: true,
            tool_pattern: "bash".into(),
            input_field: Some("command".into()),
            input_pattern: Some(r"rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?/\s*$|rm\s+-rf\s+/".into()),
            action: HookAction::Deny {
                reason: "Refusing to execute `rm -rf /` — this would delete the entire filesystem.".into(),
            },
        },
        HookRule {
            name: "block-sudo".into(),
            enabled: true,
            tool_pattern: "bash".into(),
            input_field: Some("command".into()),
            input_pattern: Some(r"^sudo\s".into()),
            action: HookAction::Deny {
                reason: "Agent cannot run sudo commands. Ask the user to run this manually.".into(),
            },
        },
        HookRule {
            name: "warn-curl-pipe-sh".into(),
            enabled: true,
            tool_pattern: "bash".into(),
            input_field: Some("command".into()),
            input_pattern: Some(r"curl\s.*\|\s*(ba)?sh".into()),
            action: HookAction::Warn {
                message: "Warning: piping curl to shell is potentially dangerous.".into(),
            },
        },
        HookRule {
            name: "block-git-force-push".into(),
            enabled: true,
            tool_pattern: "bash".into(),
            input_field: Some("command".into()),
            input_pattern: Some(r"git\s+push\s+.*--force".into()),
            action: HookAction::Deny {
                reason: "Force-pushing is blocked by safety rules. Ask the user if this is intended.".into(),
            },
        },
        HookRule {
            name: "warn-write-env-file".into(),
            enabled: true,
            tool_pattern: "write_file".into(),
            input_field: Some("path".into()),
            input_pattern: Some(r"\.env".into()),
            action: HookAction::Warn {
                message: "Warning: writing to a .env file — ensure no secrets are being stored.".into(),
            },
        },
    ]
}

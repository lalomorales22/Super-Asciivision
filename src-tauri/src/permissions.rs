use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Permission level for a single tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolPermission {
    /// Tool runs without user confirmation.
    Allow,
    /// Tool pauses for user approval before executing.
    Ask,
    /// Tool is completely blocked — the model receives a denial message.
    Deny,
}

/// Holds the per-tool permission map and resolves permissions at runtime.
#[derive(Debug, Clone)]
pub struct PermissionConfig {
    overrides: HashMap<String, ToolPermission>,
}

impl PermissionConfig {
    /// Build the default permission set.
    pub fn defaults() -> Self {
        let mut map = HashMap::new();

        // Read-only tools — always allowed
        for tool in &[
            "read_file",
            "list_directory",
            "search_files",
            "grep",
            "git_status",
            "git_diff",
            "git_log",
            "tree",
            "find_definition",
            "memory_recall",
        ] {
            map.insert(tool.to_string(), ToolPermission::Allow);
        }

        // Write tools — allowed (workspace-sandboxed already)
        for tool in &[
            "write_file",
            "edit_file",
            "mkdir",
            "touch",
            "memory_save",
            "git_add",
        ] {
            map.insert(tool.to_string(), ToolPermission::Allow);
        }

        // Tools that need user confirmation
        for tool in &[
            "bash",
            "git_commit",
            "git_checkout",
            "web_fetch",
        ] {
            map.insert(tool.to_string(), ToolPermission::Ask);
        }

        Self { overrides: map }
    }

    /// Look up the permission for a tool.  Unknown tools default to `Ask`.
    pub fn get(&self, tool_name: &str) -> ToolPermission {
        self.overrides
            .get(tool_name)
            .copied()
            .unwrap_or(ToolPermission::Ask)
    }

    /// Set a per-tool override.
    pub fn set(&mut self, tool_name: impl Into<String>, perm: ToolPermission) {
        self.overrides.insert(tool_name.into(), perm);
    }

    /// Return a snapshot of all configured permissions.
    pub fn all(&self) -> &HashMap<String, ToolPermission> {
        &self.overrides
    }
}

impl Default for PermissionConfig {
    fn default() -> Self {
        Self::defaults()
    }
}

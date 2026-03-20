use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::types::{
    ChatRequest, Conversation, ConversationDetail, ConversationSummary, MediaAsset, MediaCategory,
    Message, MessageRole, NewConversation, NewMediaCategory, NewWorkspace, ProviderId, Settings,
    SettingsPatch, TokenUsage, UpdateMediaAssetRequest, Workspace, WorkspaceItem,
};

#[derive(Debug, Clone)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn init(&self) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = self.connect()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              pinned INTEGER NOT NULL DEFAULT 0,
              preview_text TEXT,
              provider_id TEXT,
              model_id TEXT
            );
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'complete',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              provider_id TEXT,
              model_id TEXT,
              error TEXT,
              input_tokens INTEGER,
              output_tokens INTEGER,
              FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS message_parts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              message_id TEXT NOT NULL,
              part_index INTEGER NOT NULL,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS workspaces (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              roots_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              last_scanned_at TEXT
            );
            CREATE TABLE IF NOT EXISTS workspace_items (
              id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              path TEXT NOT NULL,
              mime_hint TEXT,
              language_hint TEXT,
              byte_size INTEGER NOT NULL,
              chunk_count INTEGER NOT NULL,
              last_indexed_at TEXT NOT NULL,
              text_content TEXT,
              FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS message_context_items (
              message_id TEXT NOT NULL,
              workspace_item_id TEXT NOT NULL,
              PRIMARY KEY (message_id, workspace_item_id),
              FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
              FOREIGN KEY (workspace_item_id) REFERENCES workspace_items(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS settings (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              hotkey TEXT NOT NULL,
              always_on_top INTEGER NOT NULL,
              default_provider TEXT NOT NULL,
              xai_model TEXT,
              xai_image_model TEXT,
              xai_video_model TEXT,
              xai_tts_model TEXT,
              xai_realtime_model TEXT,
              xai_voice_name TEXT,
              hands_tunnel_provider TEXT,
              hands_tunnel_executable TEXT,
              hands_relay_url TEXT,
              hands_relay_machine_id TEXT,
              hands_relay_desktop_token TEXT
            );
            CREATE TABLE IF NOT EXISTS media_categories (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS media_assets (
              id TEXT PRIMARY KEY,
              category_id TEXT,
              kind TEXT NOT NULL,
              model_id TEXT NOT NULL,
              prompt TEXT NOT NULL,
              file_path TEXT NOT NULL,
              source_url TEXT,
              mime_type TEXT,
              status TEXT NOT NULL,
              request_id TEXT,
              metadata_json TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (category_id) REFERENCES media_categories(id) ON DELETE SET NULL
            );
            "#,
        )?;
        ensure_column(&conn, "messages", "tool_calls_json", "TEXT")?;
        ensure_column(&conn, "settings", "xai_model", "TEXT")?;
        ensure_column(&conn, "settings", "xai_image_model", "TEXT")?;
        ensure_column(&conn, "settings", "xai_video_model", "TEXT")?;
        ensure_column(&conn, "settings", "xai_tts_model", "TEXT")?;
        ensure_column(&conn, "settings", "xai_realtime_model", "TEXT")?;
        ensure_column(&conn, "settings", "xai_voice_name", "TEXT")?;
        ensure_column(&conn, "settings", "hands_tunnel_provider", "TEXT")?;
        ensure_column(&conn, "settings", "hands_tunnel_executable", "TEXT")?;
        ensure_column(&conn, "settings", "hands_relay_url", "TEXT")?;
        ensure_column(&conn, "settings", "hands_relay_machine_id", "TEXT")?;
        ensure_column(&conn, "settings", "hands_relay_desktop_token", "TEXT")?;
        ensure_column(
            &conn,
            "conversations",
            "pinned",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        let defaults = Settings::default();
        conn.execute(
            r#"
            INSERT INTO settings
              (id, hotkey, always_on_top, default_provider, xai_model, xai_image_model, xai_video_model, xai_tts_model, xai_realtime_model, xai_voice_name, hands_tunnel_provider, hands_tunnel_executable, hands_relay_url, hands_relay_machine_id, hands_relay_desktop_token)
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(id) DO NOTHING
            "#,
            params![
                defaults.hotkey,
                defaults.always_on_top as i64,
                defaults.default_provider.as_str(),
                defaults.xai_model,
                defaults.xai_image_model,
                defaults.xai_video_model,
                defaults.xai_tts_model,
                defaults.xai_realtime_model,
                defaults.xai_voice_name,
                defaults.hands_tunnel_provider,
                defaults.hands_tunnel_executable,
                defaults.hands_relay_url,
                defaults.hands_relay_machine_id,
                defaults.hands_relay_desktop_token
            ],
        )?;
        Ok(())
    }

    pub fn load_settings(&self) -> AppResult<Settings> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "SELECT hotkey, always_on_top, default_provider, xai_model, xai_image_model, xai_video_model, xai_tts_model, xai_realtime_model, xai_voice_name, hands_tunnel_provider, hands_tunnel_executable, hands_relay_url, hands_relay_machine_id, hands_relay_desktop_token FROM settings WHERE id = 1",
        )?;
        let settings = statement.query_row([], |row| {
            Ok(Settings {
                hotkey: row.get(0)?,
                always_on_top: row.get::<_, i64>(1)? != 0,
                default_provider: ProviderId::from_db(&row.get::<_, String>(2)?),
                xai_model: row.get(3)?,
                xai_image_model: row.get(4)?,
                xai_video_model: row.get(5)?,
                xai_tts_model: row.get(6)?,
                xai_realtime_model: row.get(7)?,
                xai_voice_name: row.get(8)?,
                hands_tunnel_provider: row.get(9)?,
                hands_tunnel_executable: row.get(10)?,
                hands_relay_url: row.get(11)?,
                hands_relay_machine_id: row.get(12)?,
                hands_relay_desktop_token: row.get(13)?,
            })
        })?;
        Ok(settings)
    }

    pub fn update_settings(&self, patch: SettingsPatch) -> AppResult<Settings> {
        let mut current = self.load_settings()?;
        if let Some(hotkey) = patch.hotkey {
            current.hotkey = hotkey;
        }
        if let Some(always_on_top) = patch.always_on_top {
            current.always_on_top = always_on_top;
        }
        if let Some(default_provider) = patch.default_provider {
            current.default_provider = default_provider;
        }
        if let Some(xai_model) = patch.xai_model {
            current.xai_model = normalize_optional_text(Some(xai_model));
        }
        if let Some(xai_image_model) = patch.xai_image_model {
            current.xai_image_model = normalize_optional_text(Some(xai_image_model));
        }
        if let Some(xai_video_model) = patch.xai_video_model {
            current.xai_video_model = normalize_optional_text(Some(xai_video_model));
        }
        if let Some(xai_tts_model) = patch.xai_tts_model {
            current.xai_tts_model = normalize_optional_text(Some(xai_tts_model));
        }
        if let Some(xai_realtime_model) = patch.xai_realtime_model {
            current.xai_realtime_model = normalize_optional_text(Some(xai_realtime_model));
        }
        if let Some(xai_voice_name) = patch.xai_voice_name {
            current.xai_voice_name = normalize_optional_text(Some(xai_voice_name));
        }
        if let Some(hands_tunnel_provider) = patch.hands_tunnel_provider {
            current.hands_tunnel_provider = normalize_optional_text(Some(hands_tunnel_provider));
        }
        if let Some(hands_tunnel_executable) = patch.hands_tunnel_executable {
            current.hands_tunnel_executable =
                normalize_optional_text(Some(hands_tunnel_executable));
        }
        if let Some(hands_relay_url) = patch.hands_relay_url {
            current.hands_relay_url = normalize_optional_text(Some(hands_relay_url));
        }
        if let Some(hands_relay_machine_id) = patch.hands_relay_machine_id {
            current.hands_relay_machine_id =
                normalize_optional_text(Some(hands_relay_machine_id));
        }
        if let Some(hands_relay_desktop_token) = patch.hands_relay_desktop_token {
            current.hands_relay_desktop_token =
                normalize_optional_text(Some(hands_relay_desktop_token));
        }
        let conn = self.connect()?;
        conn.execute(
            "UPDATE settings SET hotkey = ?1, always_on_top = ?2, default_provider = ?3, xai_model = ?4, xai_image_model = ?5, xai_video_model = ?6, xai_tts_model = ?7, xai_realtime_model = ?8, xai_voice_name = ?9, hands_tunnel_provider = ?10, hands_tunnel_executable = ?11, hands_relay_url = ?12, hands_relay_machine_id = ?13, hands_relay_desktop_token = ?14 WHERE id = 1",
            params![
                current.hotkey,
                current.always_on_top as i64,
                current.default_provider.as_str(),
                current.xai_model,
                current.xai_image_model,
                current.xai_video_model,
                current.xai_tts_model,
                current.xai_realtime_model,
                current.xai_voice_name,
                current.hands_tunnel_provider,
                current.hands_tunnel_executable,
                current.hands_relay_url,
                current.hands_relay_machine_id,
                current.hands_relay_desktop_token
            ],
        )?;
        Ok(current)
    }

    pub fn create_conversation(&self, input: NewConversation) -> AppResult<Conversation> {
        let conn = self.connect()?;
        let now = Utc::now().to_rfc3339();
        let title = input
            .title
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "New chat".to_string());
        let conversation = Conversation {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            created_at: now.clone(),
            updated_at: now,
            pinned: false,
            preview_text: None,
            provider_id: None,
            model_id: None,
        };
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at, pinned, preview_text, provider_id, model_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                conversation.id,
                conversation.title,
                conversation.created_at,
                conversation.updated_at,
                conversation.pinned as i64,
                conversation.preview_text,
                conversation.provider_id.map(|value| value.as_str().to_string()),
                conversation.model_id
            ],
        )?;
        Ok(conversation)
    }

    pub fn rename_conversation(&self, conversation_id: &str, title: &str) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE conversations SET title = ?2, updated_at = ?3 WHERE id = ?1",
            params![conversation_id, title.trim(), Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn set_conversation_pinned(&self, conversation_id: &str, pinned: bool) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE conversations SET pinned = ?2, updated_at = ?3 WHERE id = ?1",
            params![conversation_id, pinned as i64, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn delete_conversation(&self, conversation_id: &str) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM conversations WHERE id = ?1", [conversation_id])?;
        Ok(())
    }

    pub fn list_conversations(&self) -> AppResult<Vec<ConversationSummary>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "SELECT id, title, updated_at, pinned, preview_text, provider_id, model_id FROM conversations ORDER BY pinned DESC, updated_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            let provider = row.get::<_, Option<String>>(5)?;
            Ok(ConversationSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
                pinned: row.get::<_, i64>(3)? != 0,
                preview_text: row.get(4)?,
                provider_id: provider.as_deref().map(ProviderId::from_db),
                model_id: row.get(6)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn load_conversation(&self, conversation_id: &str) -> AppResult<ConversationDetail> {
        let conn = self.connect()?;
        let conversation = conn.query_row(
            "SELECT id, title, created_at, updated_at, pinned, preview_text, provider_id, model_id FROM conversations WHERE id = ?1",
            [conversation_id],
            |row| {
                let provider = row.get::<_, Option<String>>(6)?;
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    pinned: row.get::<_, i64>(4)? != 0,
                    preview_text: row.get(5)?,
                    provider_id: provider.as_deref().map(ProviderId::from_db),
                    model_id: row.get(7)?,
                })
            },
        )?;

        let mut statement = conn.prepare(
            r#"
            SELECT
              m.id,
              m.conversation_id,
              m.role,
              m.content,
              m.status,
              m.created_at,
              m.updated_at,
              m.provider_id,
              m.model_id,
              m.error,
              m.input_tokens,
              m.output_tokens,
              COALESCE(
                (SELECT GROUP_CONCAT(content, '') FROM message_parts mp WHERE mp.message_id = m.id ORDER BY mp.part_index),
                m.content
              )
            FROM messages m
            WHERE m.conversation_id = ?1
            ORDER BY m.created_at ASC
            "#,
        )?;
        let rows = statement.query_map([conversation_id], |row| {
            let provider = row.get::<_, Option<String>>(7)?;
            let content: String = row.get(12)?;
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content,
                status: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                provider_id: provider.as_deref().map(ProviderId::from_db),
                model_id: row.get(8)?,
                error: row.get(9)?,
                usage: map_usage(row.get(10)?, row.get(11)?),
            })
        })?;

        Ok(ConversationDetail {
            conversation,
            messages: rows.filter_map(Result::ok).collect(),
        })
    }

    pub fn insert_message(
        &self,
        conversation_id: &str,
        role: MessageRole,
        content: &str,
        status: &str,
        provider_id: Option<ProviderId>,
        model_id: Option<&str>,
    ) -> AppResult<Message> {
        let conn = self.connect()?;
        let now = Utc::now().to_rfc3339();
        let message = Message {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            role: role.as_str().to_string(),
            content: content.to_string(),
            status: status.to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
            provider_id,
            model_id: model_id.map(ToString::to_string),
            error: None,
            usage: None,
        };
        conn.execute(
            r#"
            INSERT INTO messages
              (id, conversation_id, role, content, status, created_at, updated_at, provider_id, model_id, error, input_tokens, output_tokens)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                message.id,
                message.conversation_id,
                message.role,
                message.content,
                message.status,
                message.created_at,
                message.updated_at,
                message.provider_id.map(|value| value.as_str().to_string()),
                message.model_id,
                message.error,
                Option::<u64>::None,
                Option::<u64>::None
            ],
        )?;
        self.touch_conversation(
            &conn,
            conversation_id,
            Some(content),
            provider_id,
            model_id.map(ToString::to_string),
        )?;
        Ok(message)
    }

    pub fn append_message_part(
        &self,
        message_id: &str,
        part_index: usize,
        content: &str,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO message_parts (message_id, part_index, content, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![message_id, part_index as i64, content, Utc::now().to_rfc3339()],
        )?;
        conn.execute(
            "UPDATE messages SET updated_at = ?2 WHERE id = ?1",
            params![message_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn finalize_message(
        &self,
        message_id: &str,
        content: &str,
        status: &str,
        usage: Option<TokenUsage>,
        error: Option<String>,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        let (conversation_id, provider_id, model_id): (String, Option<String>, Option<String>) =
            conn.query_row(
                "SELECT conversation_id, provider_id, model_id FROM messages WHERE id = ?1",
                [message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
        conn.execute(
            "UPDATE messages SET content = ?2, status = ?3, updated_at = ?4, error = ?5, input_tokens = ?6, output_tokens = ?7 WHERE id = ?1",
            params![
                message_id,
                content,
                status,
                Utc::now().to_rfc3339(),
                error,
                usage.as_ref().and_then(|value| value.input_tokens),
                usage.as_ref().and_then(|value| value.output_tokens),
            ],
        )?;
        self.touch_conversation(
            &conn,
            &conversation_id,
            Some(content),
            provider_id.as_deref().map(ProviderId::from_db),
            model_id,
        )?;
        Ok(())
    }

    pub fn save_message_context(
        &self,
        message_id: &str,
        workspace_item_ids: &[String],
    ) -> AppResult<()> {
        let conn = self.connect()?;
        for workspace_item_id in workspace_item_ids {
            conn.execute(
                "INSERT OR IGNORE INTO message_context_items (message_id, workspace_item_id) VALUES (?1, ?2)",
                params![message_id, workspace_item_id],
            )?;
        }
        Ok(())
    }

    pub fn save_message_tool_calls(
        &self,
        message_id: &str,
        tool_calls_json: &str,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE messages SET tool_calls_json = ?2 WHERE id = ?1",
            params![message_id, tool_calls_json],
        )?;
        Ok(())
    }

    pub fn create_workspace(&self, input: NewWorkspace) -> AppResult<Workspace> {
        let conn = self.connect()?;
        let now = Utc::now().to_rfc3339();
        let name = input
            .name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| infer_workspace_name(&input.roots));
        let workspace = Workspace {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            roots: input.roots,
            item_count: 0,
            created_at: now,
            last_scanned_at: None,
        };
        conn.execute(
            "INSERT INTO workspaces (id, name, roots_json, created_at, last_scanned_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                workspace.id,
                workspace.name,
                serde_json::to_string(&workspace.roots)?,
                workspace.created_at,
                workspace.last_scanned_at
            ],
        )?;
        Ok(workspace)
    }

    pub fn list_workspaces(&self) -> AppResult<Vec<Workspace>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            r#"
            SELECT w.id, w.name, w.roots_json, w.created_at, w.last_scanned_at,
              COALESCE((SELECT COUNT(*) FROM workspace_items wi WHERE wi.workspace_id = w.id), 0)
            FROM workspaces w
            ORDER BY COALESCE(w.last_scanned_at, w.created_at) DESC
            "#,
        )?;
        let rows = statement.query_map([], |row| {
            let roots_json: String = row.get(2)?;
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                roots: serde_json::from_str(&roots_json).unwrap_or_default(),
                created_at: row.get(3)?,
                last_scanned_at: row.get(4)?,
                item_count: row.get::<_, i64>(5)? as usize,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn get_workspace(&self, workspace_id: &str) -> AppResult<Option<Workspace>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            r#"
            SELECT w.id, w.name, w.roots_json, w.created_at, w.last_scanned_at,
              COALESCE((SELECT COUNT(*) FROM workspace_items wi WHERE wi.workspace_id = w.id), 0)
            FROM workspaces w
            WHERE w.id = ?1
            "#,
        )?;
        let workspace = statement
            .query_row([workspace_id], |row| {
                let roots_json: String = row.get(2)?;
                Ok(Workspace {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    roots: serde_json::from_str(&roots_json).unwrap_or_default(),
                    created_at: row.get(3)?,
                    last_scanned_at: row.get(4)?,
                    item_count: row.get::<_, i64>(5)? as usize,
                })
            })
            .optional()?;
        Ok(workspace)
    }

    pub fn update_workspace(
        &self,
        workspace_id: &str,
        input: NewWorkspace,
    ) -> AppResult<Workspace> {
        let conn = self.connect()?;
        let current = self
            .get_workspace(workspace_id)?
            .ok_or_else(|| crate::error::AppError::message("workspace not found"))?;
        let name = input
            .name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| infer_workspace_name(&input.roots));
        conn.execute(
            "UPDATE workspaces SET name = ?2, roots_json = ?3, last_scanned_at = NULL WHERE id = ?1",
            params![workspace_id, name, serde_json::to_string(&input.roots)?],
        )?;
        conn.execute(
            "DELETE FROM workspace_items WHERE workspace_id = ?1",
            [workspace_id],
        )?;
        Ok(Workspace {
            id: current.id,
            name,
            roots: input.roots,
            item_count: 0,
            created_at: current.created_at,
            last_scanned_at: None,
        })
    }

    pub fn delete_workspace(&self, workspace_id: &str) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM workspaces WHERE id = ?1", [workspace_id])?;
        Ok(())
    }

    pub fn replace_workspace_items(
        &self,
        workspace_id: &str,
        items: &[WorkspaceItem],
    ) -> AppResult<()> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM workspace_items WHERE workspace_id = ?1",
            [workspace_id],
        )?;
        for item in items {
            tx.execute(
                r#"
                INSERT INTO workspace_items
                  (id, workspace_id, path, mime_hint, language_hint, byte_size, chunk_count, last_indexed_at, text_content)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                "#,
                params![
                    item.id,
                    item.workspace_id,
                    item.path,
                    item.mime_hint,
                    item.language_hint,
                    item.byte_size as i64,
                    item.chunk_count as i64,
                    item.last_indexed_at,
                    item.text_content
                ],
            )?;
        }
        tx.execute(
            "UPDATE workspaces SET last_scanned_at = ?2 WHERE id = ?1",
            params![workspace_id, Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_workspace_items(&self, workspace_id: &str) -> AppResult<Vec<WorkspaceItem>> {
        self.fetch_workspace_items(workspace_id, false)
    }

    pub fn fetch_workspace_items_by_ids(&self, ids: &[String]) -> AppResult<Vec<WorkspaceItem>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.connect()?;
        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(", ");
        let query = format!(
            "SELECT id, workspace_id, path, mime_hint, language_hint, byte_size, chunk_count, last_indexed_at, text_content FROM workspace_items WHERE id IN ({placeholders})"
        );
        let mut statement = conn.prepare(&query)?;
        let rows = statement.query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            map_workspace_item(row, true)
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn build_chat_history(&self, request: &ChatRequest) -> AppResult<Vec<Message>> {
        let detail = self.load_conversation(&request.conversation_id)?;
        Ok(detail.messages)
    }

    pub fn create_media_category(&self, input: NewMediaCategory) -> AppResult<MediaCategory> {
        let conn = self.connect()?;
        let category = MediaCategory {
            id: uuid::Uuid::new_v4().to_string(),
            name: input.name.trim().to_string(),
            created_at: Utc::now().to_rfc3339(),
            item_count: 0,
        };
        conn.execute(
            "INSERT INTO media_categories (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![category.id, category.name, category.created_at],
        )?;
        Ok(category)
    }

    pub fn list_media_categories(&self) -> AppResult<Vec<MediaCategory>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            r#"
            SELECT c.id, c.name, c.created_at,
              COALESCE((SELECT COUNT(*) FROM media_assets a WHERE a.category_id = c.id), 0)
            FROM media_categories c
            ORDER BY c.created_at DESC
            "#,
        )?;
        let rows = statement.query_map([], |row| {
            Ok(MediaCategory {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                item_count: row.get::<_, i64>(3)? as usize,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn insert_media_asset(&self, asset: &MediaAsset) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO media_assets
              (id, category_id, kind, model_id, prompt, file_path, source_url, mime_type, status, request_id, metadata_json, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            "#,
            params![
                asset.id,
                asset.category_id,
                asset.kind,
                asset.model_id,
                asset.prompt,
                asset.file_path,
                asset.source_url,
                asset.mime_type,
                asset.status,
                asset.request_id,
                asset.metadata_json,
                asset.created_at,
                asset.updated_at
            ],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn update_media_asset(&self, asset: &MediaAsset) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            UPDATE media_assets
            SET category_id = ?2,
                kind = ?3,
                model_id = ?4,
                prompt = ?5,
                file_path = ?6,
                source_url = ?7,
                mime_type = ?8,
                status = ?9,
                request_id = ?10,
                metadata_json = ?11,
                updated_at = ?12
            WHERE id = ?1
            "#,
            params![
                asset.id,
                asset.category_id,
                asset.kind,
                asset.model_id,
                asset.prompt,
                asset.file_path,
                asset.source_url,
                asset.mime_type,
                asset.status,
                asset.request_id,
                asset.metadata_json,
                asset.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn list_media_assets(&self, category_id: Option<&str>) -> AppResult<Vec<MediaAsset>> {
        let conn = self.connect()?;
        let query = if category_id.is_some() {
            "SELECT id, category_id, kind, model_id, prompt, file_path, source_url, mime_type, status, request_id, metadata_json, created_at, updated_at FROM media_assets WHERE category_id = ?1 ORDER BY created_at DESC"
        } else {
            "SELECT id, category_id, kind, model_id, prompt, file_path, source_url, mime_type, status, request_id, metadata_json, created_at, updated_at FROM media_assets ORDER BY created_at DESC"
        };
        let mut statement = conn.prepare(query)?;
        let rows = if let Some(category_id) = category_id {
            statement.query_map([category_id], map_media_asset)?
        } else {
            statement.query_map([], map_media_asset)?
        };
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn update_media_asset_category(
        &self,
        asset_id: &str,
        input: UpdateMediaAssetRequest,
    ) -> AppResult<MediaAsset> {
        let conn = self.connect()?;
        let current: MediaAsset = conn.query_row(
            "SELECT id, category_id, kind, model_id, prompt, file_path, source_url, mime_type, status, request_id, metadata_json, created_at, updated_at FROM media_assets WHERE id = ?1",
            [asset_id],
            map_media_asset,
        )?;
        conn.execute(
            "UPDATE media_assets SET category_id = ?2, prompt = ?3, updated_at = ?4 WHERE id = ?1",
            params![
                asset_id,
                if input.preserve_category.unwrap_or(false) {
                    current.category_id
                } else {
                    input.category_id
                },
                input.prompt.unwrap_or(current.prompt),
                Utc::now().to_rfc3339()
            ],
        )?;
        conn.query_row(
            "SELECT id, category_id, kind, model_id, prompt, file_path, source_url, mime_type, status, request_id, metadata_json, created_at, updated_at FROM media_assets WHERE id = ?1",
            [asset_id],
            map_media_asset,
        )
        .map_err(Into::into)
    }

    pub fn delete_media_asset(&self, asset_id: &str) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM media_assets WHERE id = ?1", [asset_id])?;
        Ok(())
    }

    /// Removes all media assets and categories — used for a fresh start.
    pub fn clear_all_media(&self) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute_batch("DELETE FROM media_assets; DELETE FROM media_categories;")?;
        Ok(())
    }

    pub fn refresh_workspace_item_content_by_path(
        &self,
        file_path: &str,
        content: &str,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        let metadata = std::fs::metadata(file_path)?;
        conn.execute(
            "UPDATE workspace_items SET byte_size = ?2, chunk_count = ?3, last_indexed_at = ?4, text_content = ?5 WHERE path = ?1",
            params![
                file_path,
                metadata.len() as i64,
                count_text_chunks(content) as i64,
                Utc::now().to_rfc3339(),
                content
            ],
        )?;
        Ok(())
    }

    fn connect(&self) -> AppResult<Connection> {
        let conn = Connection::open(&self.path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(conn)
    }

    fn fetch_workspace_items(
        &self,
        workspace_id: &str,
        include_content: bool,
    ) -> AppResult<Vec<WorkspaceItem>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "SELECT id, workspace_id, path, mime_hint, language_hint, byte_size, chunk_count, last_indexed_at, text_content FROM workspace_items WHERE workspace_id = ?1 ORDER BY path ASC",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            map_workspace_item(row, include_content)
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    fn touch_conversation(
        &self,
        conn: &Connection,
        conversation_id: &str,
        preview_text: Option<&str>,
        provider_id: Option<ProviderId>,
        model_id: Option<String>,
    ) -> AppResult<()> {
        conn.execute(
            "UPDATE conversations SET updated_at = ?2, preview_text = COALESCE(?3, preview_text), provider_id = COALESCE(?4, provider_id), model_id = COALESCE(?5, model_id) WHERE id = ?1",
            params![
                conversation_id,
                Utc::now().to_rfc3339(),
                preview_text.map(trim_preview),
                provider_id.map(|value| value.as_str().to_string()),
                model_id
            ],
        )?;
        Ok(())
    }
}

fn map_workspace_item(
    row: &rusqlite::Row<'_>,
    include_content: bool,
) -> rusqlite::Result<WorkspaceItem> {
    Ok(WorkspaceItem {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        path: row.get(2)?,
        mime_hint: row.get(3)?,
        language_hint: row.get(4)?,
        byte_size: row.get::<_, i64>(5)? as u64,
        chunk_count: row.get::<_, i64>(6)? as usize,
        last_indexed_at: row.get(7)?,
        text_content: if include_content { row.get(8)? } else { None },
    })
}

fn map_media_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaAsset> {
    Ok(MediaAsset {
        id: row.get(0)?,
        category_id: row.get(1)?,
        kind: row.get(2)?,
        model_id: row.get(3)?,
        prompt: row.get(4)?,
        file_path: row.get(5)?,
        source_url: row.get(6)?,
        mime_type: row.get(7)?,
        status: row.get(8)?,
        request_id: row.get(9)?,
        metadata_json: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn map_usage(input_tokens: Option<u64>, output_tokens: Option<u64>) -> Option<TokenUsage> {
    if input_tokens.is_none() && output_tokens.is_none() {
        return None;
    }
    Some(TokenUsage {
        input_tokens,
        output_tokens,
    })
}

fn count_text_chunks(value: &str) -> usize {
    const CHUNK_BYTES: usize = 1800;
    let mut count = 0usize;
    let mut current = String::new();
    for line in value.lines() {
        if current.len() + line.len() + 1 > CHUNK_BYTES && !current.is_empty() {
            count += 1;
            current.clear();
        }
        current.push_str(line);
        current.push('\n');
    }
    if !current.trim().is_empty() {
        count += 1;
    }
    count
}

fn trim_preview(value: &str) -> String {
    value.trim().chars().take(120).collect()
}

fn infer_workspace_name(roots: &[String]) -> String {
    roots
        .first()
        .and_then(|root| Path::new(root).file_name())
        .and_then(|value| value.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| "Workspace".to_string())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, sql_type: &str) -> AppResult<()> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    let has_column = columns.flatten().any(|value| value == column);
    if !has_column {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {sql_type}"),
            [],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::Database;
    use crate::types::{
        MessageRole, NewConversation, NewMediaCategory, NewWorkspace, ProviderId, SettingsPatch,
    };

    #[test]
    fn persists_conversations_and_settings() {
        let dir = tempdir().expect("temp dir");
        let db = Database::new(dir.path().join("app.sqlite"));
        db.init().expect("db init");

        let created = db
            .create_conversation(NewConversation {
                title: Some("Test chat".into()),
            })
            .expect("conversation");
        db.insert_message(
            &created.id,
            MessageRole::User,
            "hello",
            "complete",
            Some(ProviderId::Xai),
            Some("grok-code-fast-1"),
        )
        .expect("insert message");

        let conversations = db.list_conversations().expect("list conversations");
        assert_eq!(conversations.len(), 1);

        let settings = db
            .update_settings(SettingsPatch {
                always_on_top: Some(true),
                ..SettingsPatch::default()
            })
            .expect("update settings");
        assert!(settings.always_on_top);

        let workspace = db
            .create_workspace(NewWorkspace {
                name: Some("Repo".into()),
                roots: vec!["/tmp/repo".into()],
            })
            .expect("workspace");
        assert_eq!(workspace.name, "Repo");

        let category = db
            .create_media_category(NewMediaCategory {
                name: "Shots".into(),
            })
            .expect("category");
        assert_eq!(category.name, "Shots");
    }

    #[test]
    fn pins_conversations_to_top() {
        let dir = tempdir().expect("temp dir");
        let db = Database::new(dir.path().join("app.sqlite"));
        db.init().expect("db init");

        let first = db
            .create_conversation(NewConversation {
                title: Some("First".into()),
            })
            .expect("first conversation");
        let second = db
            .create_conversation(NewConversation {
                title: Some("Second".into()),
            })
            .expect("second conversation");

        db.set_conversation_pinned(&first.id, true)
            .expect("pin conversation");

        let conversations = db.list_conversations().expect("list conversations");
        assert_eq!(conversations[0].id, first.id);
        assert!(conversations[0].pinned);
        assert_eq!(conversations[1].id, second.id);
    }
}

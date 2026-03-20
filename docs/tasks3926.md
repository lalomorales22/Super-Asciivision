# Tasks 3926 — Grok Desktop: Agentic Architecture Integration Plan

## Codebase Review Summary

### Architecture Overview

Grok Desktop is a **Tauri 2** app (Rust backend + React/TypeScript frontend) targeting macOS. It communicates with xAI APIs exclusively and stores data locally in SQLite. The codebase is well-structured with clear separation:

| Layer | Technology | Files |
|-------|-----------|-------|
| Backend commands | Rust (Tauri) | `src-tauri/src/*.rs` |
| Frontend UI | React 19 + Zustand + Tailwind 4 | `src/App.tsx`, `src/store/appStore.ts` |
| IPC bridge | Tauri invoke + event listeners | `src/lib/tauri.ts` |
| Remote access | Node.js relay + WebSocket bridge | `hands-relay/src/server.js` |
| Storage | SQLite (rusqlite) + system keychain | `src-tauri/src/db.rs`, `src-tauri/src/keychain.rs` |

### Current Features

1. **Chat** — Streaming SSE chat via xAI `/v1/chat/completions`. Workspace files can be attached as context. Messages persist to SQLite. `ReactMarkdown` renders responses but there is no code-block copy/download, no syntax highlighting, and no structured tool output display.

2. **Imagine** — Image generation (`grok-imagine-image`) and video generation (`grok-imagine-video`). Images saved as PNG, videos polled until ready then downloaded. Aspect ratio and resolution controls present.

3. **Voice & Audio** — TTS via `/v1/tts` endpoint. Realtime voice sessions via `/v1/realtime/client_secrets` + WebSocket. Multiple voice options (Eve, Ara, Rex, Sal, Leo).

4. **Video Editor** — Timeline-based clip assembly using ffmpeg. Supports image-to-video still frames, video trimming, audio segments, and concat export.

5. **IDE** — Workspace file tree, text editor with save-back. Create, rename, delete workspace files. No LSP, no syntax highlighting, no git integration.

6. **Hands** — Remote mobile access via relay service or Cloudflare tunnel. WebSocket bridge from desktop to relay. Mobile web UI for chat, image/video/audio generation. Pairing via one-time code + QR.

7. **Terminal** — Embedded PTY terminal via `portable-pty`. Read/write/resize/kill. xterm.js frontend rendering.

---

## Security Review

### Critical Issues

| # | Severity | File | Issue |
|---|----------|------|-------|
| S1 | **HIGH** | `lib.rs:286-288` | `read_workspace_text_file` reads ANY path on the filesystem with zero validation. Unlike `read_media_data_url` which validates paths are under the media root, this command accepts arbitrary `file_path` from the frontend and calls `std::fs::read_to_string`. An XSS or compromised frontend could exfiltrate any file the user can read (SSH keys, `.env` files, etc). |
| S2 | **HIGH** | `lib.rs:291-301` | `write_workspace_text_file` writes to ANY path with zero validation. Could overwrite critical system files, inject malicious code into dotfiles, etc. |
| S3 | **HIGH** | `lib.rs:304-306` | `create_workspace_text_file` — same unrestricted path issue. |
| S4 | **HIGH** | `lib.rs:309-311` | `rename_workspace_path` — arbitrary path rename. |
| S5 | **HIGH** | `lib.rs:314-316` | `delete_workspace_path` — arbitrary path deletion. Can delete system directories via `fs::remove_dir_all`. |
| S6 | **MEDIUM** | `tauri.conf.json:33` | `"csp": null` — Content Security Policy is completely disabled. This opens the door to XSS attacks. Any injected script runs with full Tauri IPC access. |
| S7 | **MEDIUM** | `terminal.rs:46-58` | Terminal spawns an interactive login shell (`-l -i`) with no sandboxing. Combined with agentic features this needs careful gating. |
| S8 | **MEDIUM** | `hands.rs` | The Hands bridge runs a full HTTP server on localhost with filesystem access for generated assets. Asset download endpoint serves files by ID without additional path traversal checks. |
| S9 | **LOW** | `keychain.rs:76-84` | FileSecretStore fallback writes API keys to disk with 0600 permissions, which is reasonable, but the migration path means keys may briefly exist in both stores. |
| S10 | **LOW** | `providers.rs:498-505` | System prompt is hardcoded and minimal. No guard against prompt injection via workspace file content. Malicious file content in indexed workspace could manipulate model behavior. |

### DMG Installation Issue

The README notes the DMG is unsigned. On other Macs:
- macOS Gatekeeper blocks unsigned apps by default
- Users must right-click -> Open or `xattr -cr` the app bundle
- Consider code signing with an Apple Developer certificate, or at minimum ad-hoc signing (`codesign --force --deep -s -`)

---

## Functionality Gap Analysis

| # | Area | Gap |
|---|------|-----|
| G1 | Chat rendering | Plain text only. No syntax-highlighted code blocks, no copy button on code, no download-as-file for code snippets. `ReactMarkdown` is imported but code blocks render without highlighting. |
| G2 | Chat intelligence | Pure request-response. No tool use, no function calling, no multi-step reasoning, no ability for the AI to take actions. |
| G3 | Token limit | `maxOutputTokens` hardcoded to 2048 in `appStore.ts:515`. Modern Grok models support much larger outputs. |
| G4 | Context window | Workspace context is injected as raw system prompt text. No chunking strategy, no retrieval, no smart context selection. 2MB hard limit. |
| G5 | Terminal integration | Terminal exists but is completely disconnected from chat. AI cannot run commands, see output, or iterate on results. |
| G6 | IDE integration | AI has no awareness of the IDE. Cannot create files, edit code, or navigate the workspace programmatically. |
| G7 | Multi-model routing | Single provider (xAI) with no model routing for different task types. Reasoning models vs fast models vs code models should be selectable per-task. |
| G8 | Conversation branching | No way to fork conversations, retry with different models, or compare outputs. |
| G9 | System prompt customization | System prompt is hardcoded in `providers.rs:497-505`. Users cannot set custom instructions. |
| G10 | Hands agentic | Hands mobile interface is limited to single-shot chat/generate. No agentic task execution from mobile. |
| G11 | Cross-platform | macOS only. Tauri 2 supports Windows and Linux but no build targets exist. |
| G12 | Error recovery | Stream errors display in UI but there's no retry mechanism, no exponential backoff on API failures. |

---

## Phase 1: Foundation — Rich Chat + Code Display + Tool Infrastructure

**Goal:** Transform the basic chat into a rich, formatted experience with proper code rendering, and build the backend tool execution framework that all agentic features depend on.

**Timeline target:** 2-3 weeks

### 1.1 Rich Markdown + Code Block Rendering

- [ ] **1.1.1** Add `rehype-highlight` or `shiki` for syntax highlighting in chat messages
  - Install syntax highlighting library
  - Create a custom `CodeBlock` component for `ReactMarkdown`
  - Support language detection from fenced code blocks (```rust, ```python, etc.)
  - Dark theme matching the app's color scheme

- [ ] **1.1.2** Add copy-to-clipboard button on every code block
  - Floating copy icon in top-right of code block
  - Visual feedback on copy (checkmark, toast)
  - Use `navigator.clipboard.writeText()`

- [ ] **1.1.3** Add download/save-as-file button on code blocks
  - "Download" icon next to copy button
  - Infer filename from language hint or code content (e.g., `snippet.rs`)
  - Use Tauri dialog to let user choose save location
  - Optionally: "Save to workspace" one-click action

- [ ] **1.1.4** Code block window/panel rendering
  - Code blocks above a size threshold render in a collapsible panel
  - Panel has a header showing language, line count, filename hint
  - Expand/collapse toggle
  - Full-screen preview option for large blocks

- [ ] **1.1.5** Improve streaming display
  - During streaming, render partial markdown progressively
  - Show thinking/reasoning tokens distinctly (for reasoning models)
  - Add typing indicator animation
  - Show token usage inline after completion

### 1.2 Backend Tool Execution Framework

- [ ] **1.2.1** Define the tool registry system in Rust
  - Create `src-tauri/src/tools.rs` module
  - Define `Tool` trait: `name()`, `description()`, `parameters()`, `execute()`
  - Define `ToolResult` enum: `Text`, `Code`, `Error`, `FileCreated`, `FileModified`
  - Tool registry with dynamic lookup by name

- [ ] **1.2.2** Implement core filesystem tools
  - `read_file(path)` — Read file contents (with workspace-root validation!)
  - `write_file(path, content)` — Write/create file (with path validation!)
  - `edit_file(path, old_text, new_text)` — Surgical text replacement
  - `list_directory(path)` — List directory contents
  - `search_files(pattern, path)` — Glob-based file search
  - `grep(pattern, path)` — Content search with regex support
  - **SECURITY:** All filesystem tools MUST validate paths against workspace roots. Reject any path outside the active workspace.

- [ ] **1.2.3** Implement shell execution tools
  - `bash(command, cwd, timeout)` — Execute shell command
  - Capture stdout, stderr, exit code
  - Configurable timeout (default 120s, max 600s)
  - Working directory defaults to active workspace root
  - **SECURITY:** Implement an allowlist/blocklist for dangerous commands. Require user confirmation for destructive operations (`rm -rf`, `git push --force`, etc).

- [ ] **1.2.4** Implement git tools
  - `git_status()` — Current repo status
  - `git_diff()` — Staged and unstaged changes
  - `git_log(n)` — Recent commits
  - `git_commit(message)` — Create commit (with user confirmation)
  - `git_branch_*` — Branch operations
  - `curl(url, method, headers, body)` — HTTP requests
  - `mkdir(path)` — Create directories
  - `touch(path)` — Create empty files

- [ ] **1.2.5** Implement tool result rendering in the frontend
  - New `ToolCallBlock` component for rendering tool invocations
  - Shows tool name, parameters, and expandable result
  - Color-coded status: running (yellow), success (green), error (red)
  - File diff rendering for `edit_file` results
  - Terminal-style rendering for `bash` output

### 1.3 xAI Function Calling Integration

- [ ] **1.3.1** Update `providers.rs` to support xAI function calling format
  - Add tool definitions to the chat request payload
  - Parse `tool_calls` from streaming response chunks
  - Handle the `tool_call` -> `tool_result` -> `continue` loop
  - Support `function` message role in history

- [ ] **1.3.2** Create the agent loop in Rust
  - After receiving a `tool_calls` response, execute each tool
  - Send tool results back to the model as `tool` role messages
  - Continue until the model produces a final text response or hits max iterations
  - Configurable max iterations (default: 25)
  - Emit progress events to frontend: `tool_call_started`, `tool_call_completed`, `iteration_n`

- [ ] **1.3.3** Update message storage schema
  - Add `tool_calls` JSON column to messages table
  - Add `tool_results` JSON column
  - Store the full agent loop trace for conversation replay
  - New `agent_iterations` table for detailed step tracking

- [ ] **1.3.4** Wire up the frontend for tool-aware conversations
  - Update `StreamEvent` type to include tool call events
  - Render tool calls inline in the conversation flow
  - Show "Agent is working..." status during tool execution
  - Allow cancellation of in-progress agent loops

### 1.4 Security Hardening

- [ ] **1.4.1** Fix path traversal vulnerabilities
  - Add workspace-root validation to `read_workspace_text_file`
  - Add workspace-root validation to `write_workspace_text_file`
  - Add workspace-root validation to `create_workspace_text_file`
  - Add workspace-root validation to `rename_workspace_path`
  - Add workspace-root validation to `delete_workspace_path`
  - All paths must resolve inside an active workspace root

- [ ] **1.4.2** Enable Content Security Policy
  - Set proper CSP in `tauri.conf.json`
  - Allow `self`, Tauri IPC, and the specific CDN for fonts
  - Block inline scripts except for nonces
  - Block eval and unsafe-inline

- [ ] **1.4.3** Add user confirmation dialogs for destructive agent actions
  - File deletion requires confirmation
  - Shell commands above a danger threshold require confirmation
  - Git push/force operations require confirmation
  - Network requests to external URLs require confirmation

- [ ] **1.4.4** Increase `maxOutputTokens` default
  - Change hardcoded 2048 to configurable value in Settings
  - Default to 16384 for reasoning models, 8192 for fast models
  - Add UI control in Settings page

---

## Phase 2: Agentic Orchestration — Sub-Agents + Parallel Execution

**Goal:** Build the multi-agent orchestration layer so the AI can spawn sub-agents, run tasks in parallel, and fulfill complex multi-step requests autonomously.

**Timeline target:** 3-4 weeks (after Phase 1)

### 2.1 Agent Architecture

- [ ] **2.1.1** Design the agent state machine
  - States: `idle`, `planning`, `executing`, `awaiting_tool`, `awaiting_subagent`, `reviewing`, `complete`, `error`
  - Each agent has: `id`, `parent_id`, `task_description`, `model_id`, `state`, `messages`, `tool_calls`, `result`
  - Agent tree visualization data structure

- [ ] **2.1.2** Create the `AgentManager` service in Rust
  - `src-tauri/src/agent.rs` — Core agent orchestration
  - Spawn agents with isolated conversation contexts
  - Track active agents, their states, and parent-child relationships
  - Resource limits: max concurrent agents (default: 5), max total iterations (default: 100)
  - Agent cancellation propagates to children

- [ ] **2.1.3** Implement sub-agent spawning via tool
  - `spawn_agent(task, model_id?)` tool — Creates a child agent
  - Child agent inherits workspace context from parent
  - Child agent runs independently with its own tool access
  - Parent receives child's final result as a tool result
  - Support for `spawn_agents_parallel(tasks[])` to launch multiple sub-agents simultaneously

- [ ] **2.1.4** Implement agent-to-agent communication
  - Parent can send follow-up instructions to a running child
  - Children can request escalation to parent
  - Shared workspace state (filesystem) provides implicit communication
  - Agent activity log visible to all agents in the tree

### 2.2 Parallel Execution Engine

- [ ] **2.2.1** Implement parallel tool execution
  - When the model returns multiple independent `tool_calls`, execute them concurrently
  - Use `tokio::join!` or `tokio::spawn` for concurrent tool execution
  - Aggregate results and send them back as a batch
  - Handle partial failures: report individual tool errors without aborting the batch

- [ ] **2.2.2** Implement parallel sub-agent execution
  - `spawn_agents_parallel` launches N agents simultaneously
  - Each agent gets its own tokio task
  - Results are collected and returned to the orchestrating agent
  - Progress events emitted for each sub-agent independently

- [ ] **2.2.3** Smart task decomposition
  - When the user's request is complex, the orchestrating agent automatically:
    1. Analyzes the task
    2. Breaks it into independent sub-tasks
    3. Spawns sub-agents for parallelizable work
    4. Aggregates results
  - This is prompt-driven, not hard-coded — the model decides when to parallelize
  - System prompt engineering for the "planner" agent role

### 2.3 Agent-Aware Frontend

- [ ] **2.3.1** Agent activity panel
  - New sidebar panel showing active agent tree
  - Each agent shows: name/task, status, current tool call, progress
  - Expand to see agent's conversation history
  - Click to focus on a specific agent's output

- [ ] **2.3.2** Real-time agent progress in chat
  - As tools execute, show inline progress cards in the chat flow
  - File operations show file path and snippet preview
  - Bash commands show live output streaming
  - Sub-agent launches show a card with the child's task description
  - Collapsible detail for each step

- [ ] **2.3.3** Agent control UI
  - Cancel button per-agent
  - Pause/resume agent execution
  - "Approve" button for pending confirmations (destructive actions)
  - "Reject" button to skip a tool call and let the agent try something else
  - Model selector per-agent (use fast model for simple tasks, reasoning model for complex ones)

- [ ] **2.3.4** Conversation-agent integration
  - Agent loops are stored as part of the conversation
  - Replaying a conversation shows the full agent trace
  - User can "rewind" to a specific agent step and continue from there
  - Export agent trace as markdown for documentation

### 2.4 xAI API Optimization

- [ ] **2.4.1** Model routing
  - Configure which model handles which task type:
    - Planning/decomposition: `grok-4-1-fast-reasoning`
    - Code generation: `grok-code-fast-1`
    - Quick answers: `grok-4-1-fast-non-reasoning`
    - Complex reasoning: `grok-4-0709`
  - Auto-select model based on task complexity
  - User override per-conversation

- [ ] **2.4.2** Context window management
  - Track token usage per conversation
  - Automatic context summarization when approaching limits
  - Smart context pruning: keep recent messages + tool results, summarize older context
  - Workspace context selection based on relevance to current task

- [ ] **2.4.3** Streaming optimization
  - Remove the hardcoded 2048 token limit from `appStore.ts`
  - Support `stream_options: { include_usage: true }` for accurate token tracking
  - Implement request deduplication for rapid user messages

---

## Phase 3: Full Integration — IDE + Terminal + Hands Agentic

**Goal:** Wire the agentic system into every surface of the app, making IDE, terminal, and Hands fully AI-powered.

**Timeline target:** 3-4 weeks (after Phase 2)

### 3.1 Agentic IDE

- [ ] **3.1.1** AI-powered code editing
  - Select code in the IDE editor and ask AI to modify it
  - AI uses `edit_file` tool to make surgical changes
  - Show diff preview before applying changes
  - Undo/redo integration with AI edits

- [ ] **3.1.2** AI-driven file creation workflows
  - "Create a new React component for X" — agent creates the file, writes boilerplate, and opens it in IDE
  - "Add tests for this module" — agent reads the source, creates test file
  - Multi-file scaffolding: "Create a REST API with these endpoints" — agent creates multiple files

- [ ] **3.1.3** Inline code actions
  - Hover actions: "Explain this", "Fix this", "Refactor this"
  - Ghost text suggestions (like Copilot) from xAI models
  - Error detection from terminal output -> suggested fix in IDE
  - "Apply fix" one-click from chat to IDE

- [ ] **3.1.4** Workspace-aware context
  - IDE automatically provides the currently open file as context to chat
  - Selected text in IDE becomes the context for the next message
  - File-level bookmarks that persist across conversations
  - Project-level `.grokconfig` for custom instructions

### 3.2 Agentic Terminal

- [ ] **3.2.1** AI-driven terminal commands
  - Agent can execute commands through the existing PTY terminal
  - Terminal output is captured and fed back to the agent
  - Agent iterates: run command -> read output -> decide next action
  - Failed commands trigger automatic debugging loop

- [ ] **3.2.2** Terminal output parsing
  - Detect common patterns: compilation errors, test failures, URLs
  - Auto-link errors to source files in the IDE
  - Parse build output for actionable items
  - Detect server URLs and auto-update browser preview

- [ ] **3.2.3** Development workflow automation
  - "Run the tests and fix any failures" — agent runs tests, reads errors, edits code, re-runs
  - "Install this dependency and update the code to use it"
  - "Build and fix any compilation errors"
  - "Start the dev server" with auto-detection of framework

- [ ] **3.2.4** Terminal sandboxing for agent commands
  - Agent-initiated commands run in a sandboxed sub-shell
  - User-initiated terminal remains unrestricted
  - Agent cannot `sudo`, modify shell config, or access parent terminal
  - Timeout enforcement for agent-initiated commands

### 3.3 Agentic Hands (Remote Agent Execution)

- [ ] **3.3.1** Extend Hands relay protocol for agent tasks
  - New relay message type: `relay.agent_task`
  - Mobile user can submit multi-step tasks: "Review the PR and leave comments"
  - Desktop agent executes the task and streams progress back through the relay
  - Mobile UI shows live agent progress

- [ ] **3.3.2** Remote file operations via Hands
  - Mobile user can browse workspace files through relay
  - View file contents, diffs, and agent edit history
  - Approve/reject agent-proposed changes from mobile
  - Download generated files directly to phone

- [ ] **3.3.3** Hands notification system
  - Push-style notifications when agent tasks complete
  - Error alerts for failed tasks
  - Summary digest of agent activity since last check-in
  - WebSocket-based real-time updates (replace 4s polling)

- [ ] **3.3.4** Mobile-optimized agent UI
  - Swipe-based approval for agent actions
  - Voice input for task descriptions
  - Compact agent progress cards
  - Quick actions: "Fix and commit", "Run tests", "Deploy"

### 3.4 System Prompt + Configuration

- [ ] **3.4.1** User-configurable system prompts
  - Settings UI for custom system instructions
  - Per-workspace `.grok/instructions.md` file
  - Per-conversation system prompt override
  - Template library for common workflows (code review, debugging, scaffolding)

- [ ] **3.4.2** Agent behavior configuration
  - Max iterations per agent (Settings UI)
  - Auto-approve threshold: tool calls below this "danger score" execute without confirmation
  - Model routing rules (configurable, not hardcoded)
  - Workspace-level agent restrictions

- [ ] **3.4.3** Telemetry and debugging
  - Agent execution timeline visualization
  - Token usage breakdown per agent step
  - Tool call latency tracking
  - Export full agent trace for debugging

---

## Implementation Priority Order

The recommended order to maximize value delivered at each step:

1. **1.4.1** Security fixes (path traversal) — do this FIRST
2. **1.1.1-1.1.5** Rich chat rendering — immediate UX improvement
3. **1.2.1-1.2.5** Tool execution framework — foundation for everything else
4. **1.3.1-1.3.4** xAI function calling — enables agentic behavior
5. **1.4.2-1.4.4** Remaining security hardening
6. **2.1.1-2.1.4** Agent architecture
7. **2.2.1-2.2.3** Parallel execution
8. **2.3.1-2.3.4** Agent-aware frontend
9. **2.4.1-2.4.3** API optimization
10. **3.1-3.4** Full integration (can be parallelized across features)

---

## Technical Notes

### xAI Function Calling Format

Based on the xAI API (OpenAI-compatible), the tool definition format is:

```json
{
  "model": "grok-4-1-fast-reasoning",
  "messages": [...],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "bash",
        "description": "Execute a shell command",
        "parameters": {
          "type": "object",
          "properties": {
            "command": { "type": "string", "description": "The command to execute" },
            "cwd": { "type": "string", "description": "Working directory" }
          },
          "required": ["command"]
        }
      }
    }
  ]
}
```

The model responds with `tool_calls` in the assistant message, and the client sends back `tool` role messages with the results.

### Database Schema Additions (Phase 1-2)

```sql
-- Tool calls within agent loops
CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input TEXT NOT NULL,        -- JSON
  tool_result TEXT,                -- JSON
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Agent instances
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  parent_agent_id TEXT,
  task_description TEXT NOT NULL,
  model_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  iterations INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  result_summary TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

### Key Architecture Decisions

1. **Agent loop runs in Rust, not TypeScript** — Keeps tool execution fast, secure, and close to the filesystem. Frontend is purely for display.

2. **Tools are workspace-scoped** — Every filesystem tool validates against workspace roots. No agent can escape the sandbox.

3. **User confirmation is the default** — Destructive actions require explicit approval. Trust is earned through repeated safe tool usage, not assumed.

4. **xAI-native function calling** — Uses the OpenAI-compatible function calling API that xAI supports, not a custom prompt-based tool system.

5. **Sub-agents share filesystem, not memory** — Agents communicate through the workspace (files, git state) rather than shared memory. This matches how human developers collaborate.

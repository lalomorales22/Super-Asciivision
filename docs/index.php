<?php
/*
 * Super ASCIIVision — API Documentation & AI Chat Hub
 * Single-file PHP app: one-page API docs + Ollama chat with SQLite persistence
 */

// ── Database Setup ──────────────────────────────────────────────────────────
$DB_PATH = __DIR__ . '/asciivision_docs.sqlite';
$db = new PDO("sqlite:$DB_PATH");
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
error_reporting(E_ALL & ~E_DEPRECATED);
$db->exec("PRAGMA journal_mode=WAL");
$db->exec("CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)");
$db->exec("CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
)");

// ── Helpers ─────────────────────────────────────────────────────────────────
function listDocs(): array {
    $dir = __DIR__;
    $files = glob("$dir/*.md");
    $docs = [];
    foreach ($files as $f) {
        $name = basename($f);
        $docs[] = ['filename' => $name, 'title' => formatDocTitle($name), 'size' => filesize($f), 'modified' => filemtime($f)];
    }
    usort($docs, fn($a,$b) => docSortKey($a['filename']) <=> docSortKey($b['filename']));
    return $docs;
}

function docSortKey(string $name): string {
    if ($name === 'handoff.md') return '00_handoff_v01';
    if (preg_match('/handoff-v(\d+)\.md/', $name, $m)) return '00_handoff_v' . str_pad($m[1], 3, '0', STR_PAD_LEFT);
    if ($name === 'handoff-asciivision-integration.md') return '00_handoff_v00';
    return '99_' . $name;
}

function formatDocTitle(string $filename): string {
    $name = str_replace('.md', '', $filename);
    $map = ['handoff'=>'v1 - Initial Handoff','handoff-asciivision-integration'=>'v0 - ASCIIVision Integration',
        'handoff-v2'=>'v2 - Bug Fixes & Terminal Bleed','handoff-v3'=>'v3 - Bug Fixes & Cleanup',
        'handoff-v4'=>'v4 - Rebrand to Super ASCIIVision','handoff-v5'=>'v5 - Feature Expansion',
        'handoff-v6'=>'v6 - Border Bug Investigation','handoff-v7'=>'v7 - Ollama + Linux Support',
        'handoff-v8'=>'v8 - Performance Optimization','handoff-v9'=>'v9 - Chat UX & Voice Fixes',
        'handoff-v10'=>'v10 - Media Editor Remodel','handoff-v11'=>'v11 - IDE Remodel + Tiles Fix',
        'handoff-v12'=>'v12 - Music & Settings Overhaul','handoff-v13'=>'v13 - ASCIIVision Terminal Focus',
        'handoff-v14'=>'v14 - Border & Tiling Deep Dive','handoff-v15'=>'v15 - Linux AppImage Build',
        'handoff-v16'=>'v16 - Refactoring Sessions 1 & 2','handoff-v17'=>'v17 - Layout Extraction + Lazy Loading',
        'handoff-v18'=>'v18 - Remaining Refactoring (4-6)','handoff-v19'=>'v19 - Linux Build + AppImage Release',
        'new-tasks'=>'Refactoring Plan','review32426'=>'Code Review','tasks'=>'Task Tracker','tasks3926'=>'Task Tracker (Extended)'];
    return $map[$name] ?? ucwords(str_replace(['-', '_'], ' ', $name));
}

function getDocContent(string $filename): string {
    $path = __DIR__ . '/' . basename($filename);
    if (!file_exists($path) || pathinfo($path, PATHINFO_EXTENSION) !== 'md') return '# Not Found';
    return file_get_contents($path);
}

function buildDocsContext(): string {
    $ctx = "You are the Super ASCIIVision documentation AI assistant. You have complete knowledge of the project's API surface, architecture, and development history.\n\n";
    $ctx .= "IMPORTANT: Answer questions about the app's commands, types, architecture, modules, and build process. Be specific — cite file paths, function names, and types. If you don't know, say so.\n\n";
    $ctx .= "## Project: Super ASCIIVision v0.1.4\nTauri 2 desktop app (Rust + React/TypeScript) merging a GUI shell with ASCIIVision (ratatui TUI).\n\n";
    $ctx .= "## Tauri Commands (Rust backend, invoked from frontend via IPC)\n\n";
    $ctx .= "### Provider & Settings\n- save_api_key, delete_api_key, get_provider_status, list_models, get_settings, update_settings\n\n";
    $ctx .= "### Conversations\n- create_conversation, list_conversations, load_conversation, rename_conversation, set_conversation_pinned, delete_conversation, send_message, cancel_stream, send_agent_message\n\n";
    $ctx .= "### Workspace\n- create_workspace, update_workspace, list_workspaces, delete_workspace, scan_workspace_command, list_workspace_items, read/write/create/rename/delete workspace files\n\n";
    $ctx .= "### Media\n- generate_image_command, generate_video_command, text_to_speech_command, export_editor_timeline_command, extract_audio_command, create/list/rename/delete_media_category, list/import/delete_media_asset\n\n";
    $ctx .= "### Terminal\n- start_terminal, create_terminal, launch_asciivision, write_terminal_input, kill_terminal, resize_terminal_command, get_terminal_buffer\n\n";
    $ctx .= "### Music\n- list_music_files, get_default_music_folder, list/create/delete_music_categories, link_tracks_to_category, import_music_files\n\n";
    $ctx .= "### Hands\n- get_hands_status, start_hands_service, stop_hands_service\n\n";
    $ctx .= "## Events: chat://stream, agent://event, terminal://event, workspace://scan, app://error, hands://status\n";
    $ctx .= "## Frontend Pages: Chat, Editor, Hands, IDE, Imagine, Music, Tiles, VoiceAudio\n";
    $ctx .= "## Stores: appStore, chatStore, mediaStore, workspaceStore, musicStore, terminalStore, handsStore, tileStore\n";
    $ctx .= "## ASCIIVision CLI: /help, /clear, /video, /youtube, /webcam, /3d, /effects, /layout, /analytics, /sysmon, /games, /tiles, /server, /connect, /provider, /ollama, /remember, /forget, /recall, /run, /bash, /curl, /brew, /trust\n";
    $ctx .= "## Rust Modules: lib.rs, providers.rs, agent.rs, tools.rs, db.rs, terminal.rs, workspace.rs, editor.rs, hands.rs, keychain.rs, realtime_proxy.rs, window.rs, types.rs, error.rs\n";
    $ctx .= "## ASCIIVision Modules: main.rs, ai.rs, tiling.rs, effects.rs, video.rs, webcam.rs, games.rs, theme.rs, sysmon.rs, analytics.rs, memory.rs, shell.rs, tools.rs, tiles.rs, server.rs, client.rs, message.rs, db.rs, modules.rs, ops.rs\n";
    return $ctx;
}

// ── API Routes ──────────────────────────────────────────────────────────────
$api = $_GET['api'] ?? null;
if ($api) {
    header('Content-Type: application/json');
    switch ($api) {
        case 'docs': echo json_encode(listDocs()); exit;
        case 'doc':
            $file = $_GET['file'] ?? '';
            echo json_encode(['content' => getDocContent($file), 'filename' => $file]); exit;
        case 'conversations':
            $stmt = $db->query("SELECT * FROM conversations ORDER BY updated_at DESC");
            echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC)); exit;
        case 'new_chat':
            $input = json_decode(file_get_contents('php://input'), true);
            $title = $input['title'] ?? 'New Chat';
            $db->prepare("INSERT INTO conversations (title) VALUES (?)")->execute([$title]);
            echo json_encode(['id' => $db->lastInsertId(), 'title' => $title]); exit;
        case 'delete_chat':
            $input = json_decode(file_get_contents('php://input'), true);
            $id = (int)($input['id'] ?? 0);
            $db->prepare("DELETE FROM messages WHERE conversation_id = ?")->execute([$id]);
            $db->prepare("DELETE FROM conversations WHERE id = ?")->execute([$id]);
            echo json_encode(['ok' => true]); exit;
        case 'history':
            $convId = (int)($_GET['conversation_id'] ?? 0);
            $stmt = $db->prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC");
            $stmt->execute([$convId]);
            echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC)); exit;
        case 'chat':
            set_time_limit(0);
            $input = json_decode(file_get_contents('php://input'), true);
            $convId = (int)($input['conversation_id'] ?? 0);
            $userMsg = $input['message'] ?? '';
            $model = $input['model'] ?? 'llama3.2';
            $ollamaUrl = $input['ollama_url'] ?? 'http://localhost:11434';
            if (!$convId || !$userMsg) { echo json_encode(['error' => 'Missing conversation_id or message']); exit; }
            $db->prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)")->execute([$convId, $userMsg]);
            $stmt = $db->prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC");
            $stmt->execute([$convId]);
            $history = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $messages = [['role' => 'system', 'content' => buildDocsContext()]];
            foreach ($history as $msg) $messages[] = ['role' => $msg['role'], 'content' => $msg['content']];

            // Stream from Ollama using SSE
            header('Content-Type: text/event-stream');
            header('Cache-Control: no-cache');
            header('Connection: keep-alive');
            header('X-Accel-Buffering: no');
            ob_implicit_flush(true);
            if (ob_get_level()) ob_end_flush();

            $fullContent = '';
            $usedModel = $model;
            $ch = curl_init("$ollamaUrl/api/chat");
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode(['model'=>$model, 'messages'=>$messages, 'stream'=>true]),
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => false,
                CURLOPT_TIMEOUT => 300,
                CURLOPT_WRITEFUNCTION => function($ch, $chunk) use (&$fullContent, &$usedModel) {
                    $lines = explode("\n", trim($chunk));
                    foreach ($lines as $line) {
                        $line = trim($line);
                        if ($line === '') continue;
                        $data = json_decode($line, true);
                        if (!$data) continue;
                        if (isset($data['model'])) $usedModel = $data['model'];
                        if (isset($data['message']['content'])) {
                            $token = $data['message']['content'];
                            $fullContent .= $token;
                            echo "data: " . json_encode(['token' => $token]) . "\n\n";
                            flush();
                        }
                        if (isset($data['done']) && $data['done'] === true) {
                            echo "data: " . json_encode(['done' => true, 'model' => $usedModel]) . "\n\n";
                            flush();
                        }
                    }
                    return strlen($chunk);
                },
            ]);
            $ok = curl_exec($ch);
            $curlError = curl_error($ch);

            if ($curlError) {
                echo "data: " . json_encode(['error' => "Ollama connection failed: $curlError"]) . "\n\n";
                flush();
            }

            // Save to DB after streaming is done
            if ($fullContent !== '') {
                $db->prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)")->execute([$convId, $fullContent]);
                $countStmt = $db->prepare("SELECT COUNT(*) FROM messages WHERE conversation_id = ?");
                $countStmt->execute([$convId]);
                if ((int)$countStmt->fetchColumn() <= 2) {
                    $db->prepare("UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")->execute([mb_substr($userMsg,0,50), $convId]);
                } else {
                    $db->prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")->execute([$convId]);
                }
            }
            exit;
        case 'models':
            $ollamaUrl = $_GET['ollama_url'] ?? 'http://localhost:11434';
            $ch = curl_init("$ollamaUrl/api/tags");
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_TIMEOUT=>5]);
            $response = curl_exec($ch); $curlError = curl_error($ch); curl_close($ch);
            if ($curlError) { echo json_encode(['models'=>[],'error'=>'Ollama not reachable']); exit; }
            $data = json_decode($response, true);
            echo json_encode(['models' => array_map(fn($m)=>$m['name'], $data['models'] ?? [])]); exit;
        default: echo json_encode(['error'=>'Unknown API endpoint']); exit;
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Super ASCIIVision // API Docs</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
    --bg-deep: #08080d; --bg-primary: #0c0c14; --bg-secondary: #111119; --bg-elevated: #16161f;
    --bg-hover: #1c1c2a; --bg-code: #0e0e18; --border: #252538; --border-bright: #35354d;
    --text-primary: #dddde6; --text-secondary: #8585a0; --text-dim: #505068;
    --accent: #00e5a0; --accent-dim: #00b880; --accent-glow: rgba(0,229,160,0.12); --accent-glow-strong: rgba(0,229,160,0.25);
    --cyan: #00cfff; --purple: #a855f7; --amber: #f59e0b; --red: #ef4444; --blue: #3b82f6; --pink: #ec4899;
    --radius: 5px; --font: 'IBM Plex Mono','SF Mono','Fira Code',monospace;
}
html, body { height:100%; background:var(--bg-deep); color:var(--text-primary); font-family:var(--font); font-size:13px; line-height:1.6; overflow:hidden; }
::-webkit-scrollbar { width:5px; height:5px; } ::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; } ::-webkit-scrollbar-thumb:hover { background:var(--border-bright); }
::selection { background:var(--accent-glow-strong); color:var(--accent); }

#app { display:grid; position:fixed; inset:0; grid-template-rows:auto 1fr; grid-template-columns:260px 1fr 340px; grid-template-areas:"header header header" "sidebar content chat"; overflow:hidden; }
@media(max-width:1200px){ #app { grid-template-columns:230px 1fr; grid-template-areas:"header header" "sidebar content"; } #chat-panel:not(.overlay-open){display:none!important;} #chat-fab{display:flex!important;} }
#chat-panel.overlay-open { display:flex!important; position:fixed; right:0; top:0; bottom:0; width:340px; z-index:50; border-left:1px solid var(--border); box-shadow:-8px 0 40px rgba(0,0,0,0.5); }
.chat-overlay-close { position:absolute; top:6px; right:8px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-secondary); width:24px; height:24px; border-radius:4px; cursor:pointer; font-family:var(--font); font-size:12px; display:none; align-items:center; justify-content:center; z-index:2; }
.overlay-open .chat-overlay-close { display:flex; }
.chat-overlay-close:hover { background:var(--accent-glow); color:var(--accent); border-color:var(--accent-dim); }

#header { grid-area:header; background:var(--bg-primary); border-bottom:1px solid var(--border); padding:0 20px; display:flex; align-items:center; gap:14px; height:48px; position:relative; }
#header::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; background:linear-gradient(90deg,var(--accent),var(--cyan),var(--purple),var(--pink),var(--amber),var(--accent)); background-size:300% 100%; animation:hdrGlow 6s linear infinite; }
@keyframes hdrGlow { 0%{background-position:0 50%} 100%{background-position:300% 50%} }
.hdr-logo { font-size:10px; line-height:1; white-space:pre; background:linear-gradient(135deg,var(--accent),var(--cyan)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; font-weight:700; }
.hdr-title { font-size:14px; font-weight:600; } .hdr-title em { font-style:normal; color:var(--accent); }
.hdr-right { margin-left:auto; display:flex; align-items:center; gap:10px; font-size:11px; color:var(--text-dim); }
.hdr-right a { color:var(--text-secondary); text-decoration:none; } .hdr-right a:hover { color:var(--accent); }
.status-dot { width:7px; height:7px; border-radius:50%; background:var(--text-dim); display:inline-block; } .status-dot.on { background:var(--accent); box-shadow:0 0 6px var(--accent); }
.copy-all-btn { background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-secondary); padding:4px 10px; border-radius:var(--radius); cursor:pointer; font-family:var(--font); font-size:10px; transition:all .15s; display:flex; align-items:center; gap:5px; }
.copy-all-btn:hover { background:var(--accent-glow); border-color:var(--accent-dim); color:var(--accent); }
.copy-all-btn.copied { background:var(--accent); color:var(--bg-deep); border-color:var(--accent); }

#sidebar { grid-area:sidebar; background:var(--bg-primary); border-right:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; }
.sb-search { padding:8px 10px; border-bottom:1px solid var(--border); }
.sb-search input { width:100%; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); padding:5px 8px; border-radius:var(--radius); font-family:var(--font); font-size:11px; outline:none; }
.sb-search input:focus { border-color:var(--accent-dim); } .sb-search input::placeholder { color:var(--text-dim); }
.sb-list { flex:1; overflow-y:auto; padding:4px 6px; }
.sb-group { padding:10px 8px 3px; font-size:9px; text-transform:uppercase; letter-spacing:1.5px; color:var(--text-dim); font-weight:600; display:flex; align-items:center; gap:5px; cursor:pointer; user-select:none; }
.sb-group::before { content:'>//'; color:var(--accent); font-weight:700; font-size:10px; }
.sb-item { padding:3px 8px 3px 16px; border-radius:var(--radius); cursor:pointer; transition:all .12s; color:var(--text-secondary); font-size:11px; border:1px solid transparent; margin:1px 0; display:flex; align-items:center; gap:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sb-item:hover { background:var(--bg-hover); color:var(--text-primary); border-color:var(--border); }
.sb-item.active { background:var(--accent-glow); color:var(--accent); border-color:var(--accent-dim); }
.sb-badge { font-size:8px; padding:1px 4px; border-radius:3px; background:var(--bg-elevated); color:var(--text-dim); font-weight:700; flex-shrink:0; }
.sb-item.active .sb-badge { background:var(--accent-dim); color:var(--bg-deep); }
.sb-dot { width:5px; height:5px; border-radius:50%; flex-shrink:0; }

#content { grid-area:content; overflow-y:auto; padding:24px 32px 80px; background:var(--bg-deep); scroll-behavior:smooth; }
.sec { margin-bottom:40px; max-width:900px; }
.sec-hdr { font-size:18px; font-weight:600; color:var(--cyan); margin-bottom:10px; padding-bottom:6px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:8px; scroll-margin-top:20px; }
.sec-hdr .ico { font-size:12px; }
.sec h3 { font-size:13px; font-weight:600; color:var(--purple); margin:18px 0 6px; scroll-margin-top:20px; }
.sec p { color:var(--text-secondary); font-size:12px; margin:4px 0; }
.sec .file-ref { color:var(--text-dim); font-size:10px; }

.cmd-card { background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius); margin:6px 0; overflow:hidden; transition:border-color .15s; scroll-margin-top:20px; }
.cmd-card:hover { border-color:var(--border-bright); }
.cmd-head { padding:8px 12px; display:flex; align-items:center; gap:7px; cursor:pointer; user-select:none; }
.cmd-method { font-size:9px; font-weight:700; padding:2px 5px; border-radius:3px; text-transform:uppercase; letter-spacing:.5px; flex-shrink:0; }
.cmd-method.invoke { background:rgba(0,229,160,.15); color:var(--accent); }
.cmd-method.event { background:rgba(168,85,247,.15); color:var(--purple); }
.cmd-method.slash { background:rgba(0,207,255,.15); color:var(--cyan); }
.cmd-method.type { background:rgba(245,158,11,.15); color:var(--amber); }
.cmd-method.module { background:rgba(236,72,153,.15); color:var(--pink); }
.cmd-method.page { background:rgba(59,130,246,.15); color:var(--blue); }
.cmd-name { font-weight:600; font-size:12px; color:var(--text-primary); }
.cmd-sig { color:var(--text-dim); font-size:10px; margin-left:auto; }
.cmd-body { padding:0 12px 10px; display:none; border-top:1px solid var(--border); padding-top:8px; }
.cmd-body.open { display:block; }
.cmd-desc { color:var(--text-secondary); font-size:11px; margin-bottom:6px; }
.cmd-params { width:100%; border-collapse:collapse; font-size:11px; }
.cmd-params th { text-align:left; padding:3px 6px; color:var(--accent); font-size:9px; text-transform:uppercase; letter-spacing:.5px; border-bottom:1px solid var(--border); }
.cmd-params td { padding:3px 6px; border-bottom:1px solid var(--bg-elevated); }
.cmd-params .pn { color:var(--cyan); font-weight:500; } .cmd-params .pt { color:var(--amber); font-size:10px; }
pre.td { background:var(--bg-code); border:1px solid var(--border); border-radius:var(--radius); padding:10px 12px; overflow-x:auto; font-size:11px; line-height:1.5; color:var(--text-primary); margin:6px 0; }
pre.td .kw { color:var(--purple); } pre.td .tp { color:var(--amber); } pre.td .str { color:var(--accent); } pre.td .cm { color:var(--text-dim); }

#chat-panel { grid-area:chat; background:var(--bg-primary); border-left:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; }
.chat-hdr { padding:8px 12px; border-bottom:1px solid var(--border); font-size:9px; text-transform:uppercase; letter-spacing:1.5px; color:var(--text-dim); display:flex; align-items:center; gap:5px; }
.chat-hdr::before { content:'\u2588\u2588'; color:var(--purple); font-size:7px; }
.chat-ctrl { padding:6px 8px; border-bottom:1px solid var(--border); display:flex; gap:4px; flex-wrap:wrap; align-items:center; }
.chat-ctrl select,.chat-ctrl input { background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); padding:3px 5px; border-radius:3px; font-family:var(--font); font-size:10px; outline:none; }
.chat-ctrl select:focus,.chat-ctrl input:focus { border-color:var(--accent-dim); }
.chat-ctrl select { flex:1; min-width:80px; } .chat-ctrl input { flex:2; min-width:90px; }
.chat-ctrl button { background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-secondary); padding:3px 6px; border-radius:3px; cursor:pointer; font-family:var(--font); font-size:10px; transition:all .12s; }
.chat-ctrl button:hover { background:var(--accent-glow); border-color:var(--accent-dim); color:var(--accent); }
.conv-list { max-height:100px; overflow-y:auto; border-bottom:1px solid var(--border); }
.conv-row { padding:4px 8px; cursor:pointer; font-size:10px; color:var(--text-secondary); display:flex; align-items:center; justify-content:space-between; transition:all .1s; border-bottom:1px solid var(--bg-elevated); }
.conv-row:hover { background:var(--bg-hover); color:var(--text-primary); }
.conv-row.active { background:var(--accent-glow); color:var(--accent); }
.conv-del { opacity:0; color:var(--red); cursor:pointer; font-size:10px; padding:2px; } .conv-row:hover .conv-del{opacity:.6;} .conv-del:hover{opacity:1!important;}
.chat-msgs { flex:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:5px; }
.msg { padding:6px 8px; border-radius:var(--radius); font-size:11px; line-height:1.5; max-width:95%; word-wrap:break-word; }
.msg.user { background:var(--bg-elevated); color:var(--text-primary); align-self:flex-end; border:1px solid var(--border); }
.msg.assistant { background:var(--accent-glow); color:var(--text-primary); align-self:flex-start; border:1px solid rgba(0,229,160,.08); }
.msg.system { background:var(--bg-secondary); color:var(--text-dim); align-self:center; font-size:10px; text-align:center; border:1px solid var(--border); font-style:italic; }
.msg-lbl { font-size:8px; text-transform:uppercase; letter-spacing:1px; margin-bottom:2px; font-weight:600; }
.msg.user .msg-lbl { color:var(--cyan); } .msg.assistant .msg-lbl { color:var(--accent); }
.msg.assistant .msg-md h1,.msg.assistant .msg-md h2,.msg.assistant .msg-md h3 { font-size:12px; font-weight:600; color:var(--accent); margin:5px 0 2px; }
.msg.assistant .msg-md code { background:var(--bg-secondary); padding:1px 3px; border-radius:2px; font-size:10px; }
.msg.assistant .msg-md pre { background:var(--bg-secondary); padding:5px; border-radius:3px; margin:3px 0; overflow-x:auto; }
.msg.assistant .msg-md pre code { background:none; padding:0; }
.msg.assistant .msg-md ul,.msg.assistant .msg-md ol { padding-left:14px; margin:2px 0; }
.msg.assistant .msg-md p { margin:2px 0; }
.chat-input { padding:8px; border-top:1px solid var(--border); display:flex; gap:5px; }
.chat-input textarea { flex:1; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); padding:6px 8px; border-radius:var(--radius); font-family:var(--font); font-size:11px; resize:none; outline:none; min-height:32px; max-height:90px; line-height:1.4; }
.chat-input textarea:focus { border-color:var(--accent-dim); } .chat-input textarea::placeholder { color:var(--text-dim); }
.chat-send { background:var(--accent); color:var(--bg-deep); border:none; padding:6px 10px; border-radius:var(--radius); cursor:pointer; font-family:var(--font); font-weight:600; font-size:11px; transition:all .15s; align-self:flex-end; }
.chat-send:hover { background:var(--accent-dim); } .chat-send:disabled { opacity:.4; cursor:not-allowed; }
#chat-fab { display:none; position:fixed; bottom:16px; right:16px; width:42px; height:42px; border-radius:50%; background:var(--accent); color:var(--bg-deep); align-items:center; justify-content:center; cursor:pointer; font-size:14px; border:none; z-index:100; box-shadow:0 4px 16px var(--accent-glow-strong); font-family:var(--font); font-weight:700; }
#scanlines { pointer-events:none; position:fixed; top:0; left:0; width:100%; height:100%; z-index:9999; background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.02) 2px,rgba(0,0,0,.02) 4px); opacity:.3; }
</style>
</head>
<body>
<div id="app">
<header id="header">
    <div class="hdr-logo">&#9608;&#9608;&#9608;
&#9608;&#9608;&#9608;</div>
    <div class="hdr-title">Super <em>ASCIIVision</em> // API Docs</div>
    <div class="hdr-right">
        <span>v0.1.4</span>
        <a href="https://github.com/lalomorales22/Super-Asciivision" target="_blank">GitHub</a>
        <span>Ollama <span class="status-dot" id="ollama-dot"></span></span>
        <button class="copy-all-btn" id="copy-btn" onclick="copyAll()">Copy All</button>
    </div>
</header>

<nav id="sidebar">
    <div class="sb-search"><input type="text" id="sb-filter" placeholder="Filter..." oninput="filterSidebar()"></div>
    <div class="sb-list" id="sb-list"></div>
</nav>

<main id="content"></main>

<aside id="chat-panel">
    <button class="chat-overlay-close" onclick="toggleChat()" title="Close">&times;</button>
    <div class="chat-hdr">AI Assistant (Ollama)</div>
    <div class="chat-ctrl">
        <select id="model-sel"><option value="" disabled selected>Loading models...</option></select>
        <input type="text" id="ollama-url" value="http://localhost:11434" placeholder="Ollama URL">
        <button onclick="newChat()">+ New</button>
    </div>
    <div class="conv-list" id="conv-list"></div>
    <div class="chat-msgs" id="chat-msgs"><div class="msg system">Ask anything about the Super ASCIIVision API.</div></div>
    <div class="chat-input">
        <textarea id="chat-in" placeholder="Ask about the API..." rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMsg();}"></textarea>
        <button class="chat-send" id="send-btn" onclick="sendMsg()">Send</button>
    </div>
</aside>
</div>
<button id="chat-fab" onclick="toggleChat()">&gt;_</button>
<div id="scanlines"></div>

<script>
// ═══════════════════════════════════════════════════════════════════════
// API DATA
// ═══════════════════════════════════════════════════════════════════════
const D = {
groups: [
{ name:"Provider & Settings", id:"provider-settings", desc:"Manage AI providers (xAI, Ollama), API keys, and application settings.", file:"src-tauri/src/providers.rs, lib.rs", commands:[
    {name:"save_api_key",sig:"(provider, api_key) -> void",desc:"Store an API key securely in the file-based secret store.",params:[{n:"provider",t:"ProviderId",d:"'xai' or 'ollama'"},{n:"api_key",t:"String",d:"The API key value"}]},
    {name:"delete_api_key",sig:"(provider) -> void",desc:"Remove a stored API key.",params:[{n:"provider",t:"ProviderId",d:"Provider to delete key for"}]},
    {name:"get_provider_status",sig:"() -> ProviderStatus[]",desc:"Check availability and authentication status of all providers.",params:[]},
    {name:"list_models",sig:"(provider?) -> ModelDescriptor[]",desc:"List available models. For xAI returns hardcoded list, for Ollama queries /api/tags.",params:[{n:"provider",t:"ProviderId?",d:"Optional filter"}]},
    {name:"get_settings",sig:"() -> Settings",desc:"Load the full Settings object from SQLite.",params:[]},
    {name:"update_settings",sig:"(input) -> Settings",desc:"Patch settings (hotkey, theme, default models, Hands config, etc.).",params:[{n:"input",t:"SettingsPatch",d:"Partial settings to update"}]},
]},
{ name:"Conversations", id:"conversations", desc:"Create, list, load, and manage chat conversations with full message history.", file:"src-tauri/src/lib.rs, db.rs", commands:[
    {name:"create_conversation",sig:"(input) -> Conversation",desc:"Create a new conversation. Optionally set provider and model.",params:[{n:"input",t:"NewConversation",d:"Title, optional providerId/modelId"}]},
    {name:"list_conversations",sig:"() -> ConversationSummary[]",desc:"List all conversations ordered by last update.",params:[]},
    {name:"load_conversation",sig:"(conversation_id) -> ConversationDetail",desc:"Load a conversation with its full message history.",params:[{n:"conversation_id",t:"String",d:"UUID"}]},
    {name:"rename_conversation",sig:"(conversation_id, title) -> void",desc:"Rename a conversation.",params:[{n:"conversation_id",t:"String",d:"UUID"},{n:"title",t:"String",d:"New title"}]},
    {name:"set_conversation_pinned",sig:"(conversation_id, pinned) -> void",desc:"Pin or unpin a conversation to the top.",params:[{n:"conversation_id",t:"String",d:"UUID"},{n:"pinned",t:"bool",d:"true to pin"}]},
    {name:"delete_conversation",sig:"(conversation_id) -> void",desc:"Permanently delete a conversation and all its messages.",params:[{n:"conversation_id",t:"String",d:"UUID"}]},
    {name:"send_message",sig:"(input) -> StreamHandle",desc:"Send a chat message and begin streaming the response. Emits chat://stream events.",params:[{n:"input",t:"ChatRequest",d:"conversationId, providerId, modelId, userText, workspaceItems, temperature, maxOutputTokens"}]},
    {name:"cancel_stream",sig:"(stream_id) -> void",desc:"Cancel an in-progress message stream.",params:[{n:"stream_id",t:"String",d:"Stream handle ID"}]},
    {name:"send_agent_message",sig:"(input) -> StreamHandle",desc:"Send a message in agent/tool-calling mode. Emits agent://event events.",params:[{n:"input",t:"AgentChatRequest",d:"Same as ChatRequest + maxIterations"}]},
]},
{ name:"Workspace & Files", id:"workspace", desc:"Create workspaces from folders, index files for AI context, read/write/manage files.", file:"src-tauri/src/workspace.rs, lib.rs", commands:[
    {name:"create_workspace",sig:"(input) -> Workspace",desc:"Create a workspace from folder/file paths for AI context.",params:[{n:"input",t:"NewWorkspace",d:"name, roots (paths)"}]},
    {name:"update_workspace",sig:"(workspace_id, input) -> Workspace",desc:"Update workspace root paths.",params:[{n:"workspace_id",t:"String",d:"UUID"},{n:"input",t:"UpdateWorkspaceRequest",d:"New roots array"}]},
    {name:"list_workspaces",sig:"() -> Workspace[]",desc:"List all workspaces.",params:[]},
    {name:"delete_workspace",sig:"(workspace_id) -> void",desc:"Delete a workspace and its indexed items.",params:[{n:"workspace_id",t:"String",d:"UUID"}]},
    {name:"scan_workspace_command",sig:"(workspace_id) -> WorkspaceScanSummary",desc:"Index/scan all files in a workspace. Emits workspace://scan events.",params:[{n:"workspace_id",t:"String",d:"UUID"}]},
    {name:"list_workspace_items",sig:"(workspace_id) -> WorkspaceItem[]",desc:"List all indexed items in a workspace.",params:[{n:"workspace_id",t:"String",d:"UUID"}]},
    {name:"read_workspace_text_file",sig:"(file_path) -> String",desc:"Read the text content of a file.",params:[{n:"file_path",t:"String",d:"Absolute path"}]},
    {name:"write_workspace_text_file",sig:"(file_path, content) -> void",desc:"Write content to an existing file.",params:[{n:"file_path",t:"String",d:"Absolute path"},{n:"content",t:"String",d:"File content"}]},
    {name:"create_workspace_text_file",sig:"(file_path, content?) -> void",desc:"Create a new text file.",params:[{n:"file_path",t:"String",d:"Absolute path"},{n:"content",t:"String?",d:"Optional initial content"}]},
    {name:"rename_workspace_path",sig:"(path, new_name) -> void",desc:"Rename a file or folder.",params:[{n:"path",t:"String",d:"Current path"},{n:"new_name",t:"String",d:"New name"}]},
    {name:"delete_workspace_path",sig:"(path) -> void",desc:"Delete a file or folder.",params:[{n:"path",t:"String",d:"Absolute path"}]},
    {name:"list_workspace_media",sig:"(workspace_id, kind?) -> WorkspaceMediaFile[]",desc:"Find media files in a workspace.",params:[{n:"workspace_id",t:"String",d:"UUID"},{n:"kind",t:"String?",d:"'image','video','audio'"}]},
]},
{ name:"Media & Generation", id:"media", desc:"AI-powered image, video, and audio generation. Media asset management with categories.", file:"src-tauri/src/providers.rs, editor.rs", commands:[
    {name:"generate_image_command",sig:"(input) -> MediaAsset",desc:"Generate an image using xAI (Grok Imagine).",params:[{n:"input",t:"GenerateImageRequest",d:"prompt, modelId, categoryId?, aspectRatio?, resolution?"}]},
    {name:"generate_video_command",sig:"(input) -> MediaAsset",desc:"Generate a video using xAI (Grok Imagine Video).",params:[{n:"input",t:"GenerateVideoRequest",d:"prompt, modelId, categoryId?"}]},
    {name:"text_to_speech_command",sig:"(input) -> MediaAsset",desc:"Generate speech audio using xAI TTS. Voices: eve, ara, rex, sal, leo.",params:[{n:"input",t:"TextToSpeechRequest",d:"text, modelId, voice, categoryId?"}]},
    {name:"export_editor_timeline_command",sig:"(input) -> MediaAsset",desc:"Export a media editor timeline to MP4 via FFmpeg.",params:[{n:"input",t:"ExportEditorTimelineRequest",d:"clips[], overlays?, title?, categoryId?"}]},
    {name:"extract_audio_command",sig:"(source_path) -> MediaAsset",desc:"Extract the audio track from a video file.",params:[{n:"source_path",t:"String",d:"Path to video file"}]},
    {name:"create_media_category",sig:"(input) -> MediaCategory",desc:"Create a media category for organizing assets.",params:[{n:"input",t:"NewMediaCategory",d:"name, kind"}]},
    {name:"list_media_categories",sig:"() -> MediaCategory[]",desc:"List all media categories.",params:[]},
    {name:"rename_media_category",sig:"(category_id, name) -> void",desc:"Rename a media category.",params:[{n:"category_id",t:"String",d:"UUID"},{n:"name",t:"String",d:"New name"}]},
    {name:"delete_media_category",sig:"(category_id) -> void",desc:"Delete a media category.",params:[{n:"category_id",t:"String",d:"UUID"}]},
    {name:"list_media_assets",sig:"(category_id?) -> MediaAsset[]",desc:"List media assets, optionally filtered by category.",params:[{n:"category_id",t:"String?",d:"Optional category filter"}]},
    {name:"import_local_media_command",sig:"(input) -> MediaAsset",desc:"Import a local file as a media asset.",params:[{n:"input",t:"ImportLocalMediaRequest",d:"filePath, categoryId?, kind"}]},
    {name:"delete_media_asset",sig:"(asset_id) -> void",desc:"Delete a media asset and its file.",params:[{n:"asset_id",t:"String",d:"UUID"}]},
    {name:"clear_all_media",sig:"() -> void",desc:"Delete ALL media assets. Destructive.",params:[]},
    {name:"read_media_data_url",sig:"(file_path) -> String",desc:"Read a media file and return a data URL.",params:[{n:"file_path",t:"String",d:"Absolute path"}]},
]},
{ name:"Terminal & PTY", id:"terminal", desc:"PTY session management for shell terminals and the ASCIIVision sidecar.", file:"src-tauri/src/terminal.rs", commands:[
    {name:"start_terminal",sig:"() -> TerminalHandle",desc:"Start or get the default terminal session.",params:[]},
    {name:"create_terminal",sig:"() -> TerminalHandle",desc:"Create a new independent terminal session.",params:[]},
    {name:"launch_asciivision",sig:"(cols?, rows?) -> TerminalHandle",desc:"Launch the asciivision-core sidecar in a PTY with --skip-intro.",params:[{n:"cols",t:"i32?",d:"Columns (default 120)"},{n:"rows",t:"i32?",d:"Rows (default 40)"}]},
    {name:"write_terminal_input",sig:"(session_id, input) -> void",desc:"Send keyboard input to a terminal session's stdin.",params:[{n:"session_id",t:"String",d:"Session UUID"},{n:"input",t:"String",d:"Raw input"}]},
    {name:"kill_terminal",sig:"(session_id) -> void",desc:"Kill a terminal session and its child process.",params:[{n:"session_id",t:"String",d:"Session UUID"}]},
    {name:"resize_terminal_command",sig:"(session_id, cols, rows) -> void",desc:"Resize a PTY session (triggers SIGWINCH).",params:[{n:"session_id",t:"String",d:"Session UUID"},{n:"cols",t:"u16",d:"New columns"},{n:"rows",t:"u16",d:"New rows"}]},
    {name:"get_terminal_buffer",sig:"(session_id) -> String",desc:"Get the current output buffer of a terminal.",params:[{n:"session_id",t:"String",d:"Session UUID"}]},
]},
{ name:"Music", id:"music", desc:"Music file management, playlists/categories, metadata reading via lofty crate.", file:"src-tauri/src/lib.rs", commands:[
    {name:"list_music_files",sig:"(folder_path?) -> MusicTrack[]",desc:"List music files with metadata (title, artist, album, duration, cover art).",params:[{n:"folder_path",t:"String?",d:"Override default ~/Music/SuperASCIIVision/"}]},
    {name:"get_default_music_folder",sig:"() -> String",desc:"Get the default music directory path.",params:[]},
    {name:"reveal_music_folder",sig:"(folder_path) -> void",desc:"Open a music folder in the system file manager.",params:[{n:"folder_path",t:"String",d:"Folder path"}]},
    {name:"list_music_categories",sig:"(folder_path?) -> MusicCategory[]",desc:"List music categories (subdirectories).",params:[{n:"folder_path",t:"String?",d:"Override default"}]},
    {name:"create_music_category",sig:"(name, folder_path?) -> MusicCategory",desc:"Create a new playlist/category folder.",params:[{n:"name",t:"String",d:"Category name"},{n:"folder_path",t:"String?",d:"Override default"}]},
    {name:"delete_music_category",sig:"(category_path) -> void",desc:"Delete a music category folder.",params:[{n:"category_path",t:"String",d:"Full path"}]},
    {name:"link_tracks_to_category",sig:"(track_paths, category_name, folder_path?) -> usize",desc:"Symlink tracks into a category folder.",params:[{n:"track_paths",t:"String[]",d:"File paths"},{n:"category_name",t:"String",d:"Target category"},{n:"folder_path",t:"String?",d:"Override default"}]},
    {name:"import_music_files",sig:"(file_paths, target_folder?, folder_path?) -> usize",desc:"Copy music files into the music directory.",params:[{n:"file_paths",t:"String[]",d:"Files to import"},{n:"target_folder",t:"String?",d:"Subfolder"},{n:"folder_path",t:"String?",d:"Override default"}]},
]},
{ name:"Hands (Remote Desktop)", id:"hands", desc:"Remote mobile access via WebSocket relay or Cloudflare tunnel.", file:"src-tauri/src/hands.rs", commands:[
    {name:"get_hands_status",sig:"() -> HandsStatus",desc:"Get Hands service status including connections, tunnel URL, pairing code.",params:[]},
    {name:"start_hands_service",sig:"() -> HandsStatus",desc:"Start the Hands WebSocket server and connect to relay/tunnel.",params:[]},
    {name:"stop_hands_service",sig:"() -> HandsStatus",desc:"Stop the Hands service.",params:[]},
]},
{ name:"ASCIIVision Environment", id:"asciivision-env", desc:"Read and write API keys and config for the asciivision-core binary.", file:"src-tauri/src/lib.rs", commands:[
    {name:"read_asciivision_env",sig:"() -> Record<string,string>",desc:"Read the asciivision-core .env configuration file.",params:[]},
    {name:"write_asciivision_env",sig:"(keys) -> void",desc:"Write key-value pairs to the asciivision-core .env file.",params:[{n:"keys",t:"Record<string,string>",d:"Key-value pairs"}]},
]},
{ name:"Realtime Voice", id:"realtime", desc:"xAI realtime voice sessions via WebSocket proxy.", file:"src-tauri/src/realtime_proxy.rs", commands:[
    {name:"create_realtime_session_command",sig:"(input) -> RealtimeSession",desc:"Create an ephemeral xAI realtime session with a local WebSocket proxy.",params:[{n:"input",t:"RealtimeSessionRequest",d:"modelId, voice"}]},
]},
],
events: [
    {name:"chat://stream",type:"StreamEvent",desc:"Chat message streaming. Kinds: started, delta, completed, cancelled, error.",fields:"streamId, kind, textDelta?, messageId, usage?, error?"},
    {name:"agent://event",type:"AgentEvent",desc:"Agent tool-calling loops. Kinds: thinking, tool_call, tool_result, text_delta, complete, error.",fields:"streamId, kind, toolName?, toolArgs?, toolResult?, toolSuccess?, textDelta?, messageId?, iterations?, error?"},
    {name:"terminal://event",type:"TerminalEvent",desc:"Terminal output and exit. UTF-8-safe reader buffers incomplete multi-byte sequences.",fields:"sessionId, kind (output|exit), chunk?, stream?, exitCode?"},
    {name:"workspace://scan",type:"WorkspaceScanEvent",desc:"Workspace indexing progress. Kinds: started, indexing, completed.",fields:"workspaceId, kind, progress?"},
    {name:"app://error",type:"UiErrorEvent",desc:"Application-level error notification.",fields:"message, source?"},
    {name:"hands://status",type:"HandsStatus",desc:"Hands service status changes.",fields:"state, localUrl?, publicUrl?, connections[]"},
],
types: [
    {name:"Settings",def:"interface Settings {\n  hotkey: string\n  alwaysOnTop: boolean\n  defaultProvider: ProviderId\n  xaiModel?: string\n  xaiImageModel?: string\n  xaiVideoModel?: string\n  xaiTtsModel?: string\n  xaiRealtimeModel?: string\n  xaiVoiceName?: string       // eve, ara, rex, sal, leo\n  ollamaModel?: string\n  theme?: string              // Emerald, Ocean, Sunset, Violet, Golden, Crimson\n  handsTunnelProvider?: string\n  handsRelayUrl?: string\n  handsRelayMachineId?: string\n  handsRelayDesktopToken?: string\n}"},
    {name:"ChatRequest",def:"interface ChatRequest {\n  conversationId: string\n  providerId: ProviderId       // 'xai' | 'ollama'\n  modelId: string\n  userText: string\n  selectedWorkspaceItems: string[]  // item IDs for context\n  temperature?: number\n  maxOutputTokens?: number\n}"},
    {name:"Conversation",def:"interface Conversation {\n  id: string\n  title: string\n  createdAt: string\n  updatedAt: string\n  pinned: boolean\n  previewText?: string\n  providerId?: ProviderId\n  modelId?: string\n}"},
    {name:"Message",def:"interface Message {\n  id: string\n  conversationId: string\n  role: string                 // 'user' | 'assistant' | 'system' | 'tool'\n  content: string\n  status: string\n  createdAt: string\n  providerId?: ProviderId\n  modelId?: string\n  error?: string\n  usage?: TokenUsage\n}"},
    {name:"MediaAsset",def:"interface MediaAsset {\n  id: string\n  categoryId?: string\n  kind: 'image' | 'video' | 'audio'\n  modelId: string\n  prompt: string\n  filePath: string\n  sourceUrl?: string\n  mimeType?: string\n  status: string\n  metadataJson?: string\n  createdAt: string\n}"},
    {name:"Workspace",def:"interface Workspace {\n  id: string\n  name: string\n  roots: string[]             // folder/file paths\n  itemCount: number\n  createdAt: string\n  lastScannedAt?: string\n}"},
    {name:"WorkspaceItem",def:"interface WorkspaceItem {\n  id: string\n  workspaceId: string\n  path: string\n  mimeHint?: string\n  languageHint?: string\n  byteSize: number\n  chunkCount: number\n  lastIndexedAt: string\n}"},
    {name:"StreamEvent",def:"interface StreamEvent {\n  streamId: string\n  kind: 'started' | 'delta' | 'completed' | 'cancelled' | 'error'\n  textDelta?: string\n  messageId: string\n  usage?: TokenUsage\n  error?: string\n}"},
    {name:"AgentEvent",def:"interface AgentEvent {\n  streamId: string\n  kind: 'thinking' | 'tool_call' | 'tool_result' | 'text_delta' | 'complete' | 'error'\n  toolName?: string\n  toolArgs?: string            // JSON-encoded\n  toolResult?: string\n  toolSuccess?: boolean\n  textDelta?: string\n  messageId?: string\n  iterations?: number\n  error?: string\n}"},
    {name:"TerminalEvent",def:"interface TerminalEvent {\n  sessionId: string\n  kind: 'output' | 'exit'\n  chunk?: string               // UTF-8 safe output\n  stream?: 'stdout' | 'stderr'\n  exitCode?: number\n}"},
    {name:"MusicTrack",def:"interface MusicTrack {\n  filePath: string\n  fileName: string\n  title?: string\n  artist?: string\n  album?: string\n  durationSecs?: number\n  coverArtDataUrl?: string     // base64 cover art\n  category?: string\n}"},
    {name:"HandsStatus",def:"interface HandsStatus {\n  state: string\n  tunnelProvider?: string\n  localUrl?: string\n  publicUrl?: string\n  pairingCode?: string\n  workspaceDir: string\n  tunnelStatus: string\n  lastError?: string\n  connections: HandsConnection[]\n  activity: HandsActivityItem[]\n  assets: HandsGeneratedAsset[]\n}"},
    {name:"RealtimeSession",def:"interface RealtimeSession {\n  clientSecret: string         // ephemeral, expires\n  expiresAt?: string\n  websocketUrl: string\n  modelId?: string\n  voice?: string\n  proxyPort?: number            // local WS proxy for browser\n}"},
    {name:"GenerateImageRequest",def:"interface GenerateImageRequest {\n  prompt: string\n  modelId: string\n  categoryId?: string\n  aspectRatio?: string         // e.g. '16:9', '1:1'\n  resolution?: string\n}"},
    {name:"ExportEditorTimelineRequest",def:"interface ExportEditorTimelineRequest {\n  title?: string\n  categoryId?: string\n  clips: EditorTimelineClip[]\n  overlays?: EditorOverlayClip[]\n}"},
    {name:"AppPage",def:"type AppPage = 'tiles' | 'chat' | 'imagine' | 'voice' | 'editor' | 'ide' | 'hands' | 'music'"},
    {name:"ProviderId",def:"type ProviderId = 'xai' | 'ollama'"},
],
modules_rust: [
    {name:"lib.rs",area:"Tauri Commands",desc:"Main entry point. Registers all 60+ Tauri commands, initializes DB, starts terminal, manages app lifecycle."},
    {name:"providers.rs",area:"AI Providers",desc:"xAI and Ollama API integration. Chat streaming, image/video generation, TTS, model listing."},
    {name:"agent.rs",area:"Agent Loop",desc:"Tool-calling agent with iteration limits. Executes tools from registry, emits agent://event progress."},
    {name:"tools.rs",area:"Tool Definitions",desc:"ToolRegistry and ToolDefinition for agent function-calling. Dynamically builds tool list from workspace."},
    {name:"db.rs",area:"Database",desc:"SQLite operations for conversations, messages, workspaces, media, settings. Schema migrations."},
    {name:"terminal.rs",area:"PTY Management",desc:"Terminal session registry. UTF-8-safe PTY reader (buffers incomplete multi-byte chars). Early output buffering."},
    {name:"workspace.rs",area:"File Indexing",desc:"WalkDir-based file scanner. Chunks large files for RAG context. Supports 20+ file types."},
    {name:"editor.rs",area:"Video Export",desc:"FFmpeg-based timeline export. Combines clips, overlays, and audio into MP4 (1280x720@30fps)."},
    {name:"hands.rs",area:"Remote Desktop",desc:"WebSocket server for mobile bridge. Relay client, tunnel integration, pairing codes, activity tracking."},
    {name:"keychain.rs",area:"Secrets",desc:"FileSecretStore for API key storage. Platform-conditional: macOS native keychain or file-based."},
    {name:"realtime_proxy.rs",area:"Voice Proxy",desc:"Local Axum WebSocket proxy for xAI realtime voice. Browser WebSocket can't set auth headers."},
    {name:"window.rs",area:"Window Mgmt",desc:"Global hotkey registration, always-on-top toggle, system tray menu."},
    {name:"types.rs",area:"Core Types",desc:"ProviderId, MessageRole, and other shared Rust type definitions."},
    {name:"error.rs",area:"Error Handling",desc:"AppError and AppResult types for consistent error propagation."},
],
modules_av: [
    {name:"main.rs",area:"TUI Core",desc:"~4000 lines. Main event loop, UI rendering, keybindings, tiling layout, intro sequence."},
    {name:"ai.rs",area:"Multi-AI Chat",desc:"AIProvider enum: Claude, Grok, OpenAI, Gemini, Ollama. Streaming responses."},
    {name:"tiling.rs",area:"Window Manager",desc:"TilingManager with 6 layout presets. PanelKind enum (13 panel types). Focus/swap/cycle."},
    {name:"effects.rs",area:"3D Effects",desc:"EffectsEngine: Matrix rain, Plasma, Starfield, Wireframe cube, Fire, Particle storms."},
    {name:"video.rs",area:"Video Player",desc:"FFmpeg-based ASCII video. Decodes frames, converts to terminal characters with color."},
    {name:"webcam.rs",area:"Webcam",desc:"Live webcam capture with real-time ASCII rendering."},
    {name:"games.rs",area:"Games",desc:"GameKind: PacMan, SpaceInvaders, Penguin3D. OpenTUI PTY + built-in ASCII fallback."},
    {name:"theme.rs",area:"Themes",desc:"F9/F10 theme system. Color palette definitions, randomization, reset."},
    {name:"sysmon.rs",area:"System Monitor",desc:"CPU, memory, network, process count. Rendered as TUI dashboard."},
    {name:"analytics.rs",area:"Analytics",desc:"Performance metrics panel. Frame timing, render stats."},
    {name:"memory.rs",area:"Agent Memory",desc:"Key-value facts storage for AI context. /remember, /forget, /recall commands."},
    {name:"shell.rs",area:"Shell Exec",desc:"Zsh command execution with 90s timeout. Used by /run, /bash, /curl, /brew."},
    {name:"tools.rs",area:"Tool Defs",desc:"ToolDefinition, ToolCall, ToolResult, TrustLevel for agent function-calling."},
    {name:"tiles.rs",area:"Multi-Terminal",desc:"Multi-terminal tile panel with public TerminalSession interface."},
    {name:"server.rs",area:"Video Chat Srv",desc:"Axum-based WebSocket server for video chat."},
    {name:"client.rs",area:"Video Chat Cli",desc:"Connects to remote video chat server. Sends/receives ASCII frames."},
    {name:"message.rs",area:"Chat Protocol",desc:"WsMessage enum for video chat WebSocket protocol."},
    {name:"db.rs",area:"Chat History",desc:"SQLite persistence for asciivision-core chat conversations."},
    {name:"modules.rs",area:"Module Registry",desc:"Module registry for optional features (video, webcam, sysmon, etc.)."},
    {name:"ops.rs",area:"Ops Deck",desc:"Operations log. Records all user actions and system events."},
],
cli: [
    {cat:"Help",cmds:[{n:"/help",d:"Show the operator manual."},{n:"/clear",d:"Purge the terminal transcript buffer."}]},
    {cat:"Video & Media",cmds:[{n:"/video",d:"Toggle the video bus panel."},{n:"/video <path>",d:"Load a local video file."},{n:"/youtube <url>",d:"Stream a YouTube video via yt-dlp."},{n:"/webcam",d:"Toggle live ASCII webcam."}]},
    {cat:"Effects & Layout",cmds:[{n:"/3d, /effects, /fx",d:"Toggle/cycle 3D effects."},{n:"/layout",d:"Cycle layout presets."},{n:"/layout <preset>",d:"Set layout: default, dual, triple, quad, webcam, focus."}]},
    {cat:"Panels & UI",cmds:[{n:"/analytics",d:"Show analytics panel."},{n:"/sysmon",d:"Show system monitor."},{n:"/games",d:"Open the arcade panel."},{n:"/games <game>",d:"Launch: pacman, space, penguin."},{n:"/tiles",d:"Boot tiles panel."},{n:"/tiles <n>",d:"Boot with N terminals (1-8)."}]},
    {cat:"Video Chat",cmds:[{n:"/server <port>",d:"Start local video chat server."},{n:"/connect <url>",d:"Connect to remote server."},{n:"/chat <msg>",d:"Send chat message."},{n:"/username <name>",d:"Set display name."}]},
    {cat:"AI & Models",cmds:[{n:"/provider <name>",d:"Switch provider: claude, grok, gpt5, gemini, ollama."},{n:"/ollama",d:"Open Ollama model picker."}]},
    {cat:"Memory & Trust",cmds:[{n:"/remember <k=v>",d:"Store fact in agent memory."},{n:"/forget <key>",d:"Remove fact."},{n:"/recall <key>",d:"Look up fact."},{n:"/memory",d:"Dump full agent memory."},{n:"/trust",d:"Cycle trust policy."}]},
    {cat:"Shell Operations",cmds:[{n:"/run <cmd>",d:"Execute zsh command (90s timeout)."},{n:"/bash <cmd>",d:"Execute bash command."},{n:"/curl <cmd>",d:"Run curl command."},{n:"/brew <cmd>",d:"Run Homebrew command."}]},
    {cat:"Display",cmds:[{n:"/pin",d:"Pin prompt to sysmon."},{n:"/unpin",d:"Remove pinned prompt."},{n:"/stream",d:"Toggle AI streaming."},{n:"/theme random",d:"Randomize theme."},{n:"/theme reset",d:"Reset theme."}]},
],
pages: [
    {name:"ChatPage",file:"src/pages/ChatPage.tsx",desc:"Conversation UI with message history, composer, agent mode, workspace context, streaming."},
    {name:"ImaginePage",file:"src/pages/ImaginePage.tsx",desc:"AI image/video generation. xAI and Ollama. Gallery with categories, drag-and-drop."},
    {name:"VoiceAudioPage",file:"src/pages/VoiceAudioPage.tsx",desc:"Real-time voice (push-to-talk, auto), TTS generation, audio gallery."},
    {name:"EditorPage",file:"src/pages/EditorPage.tsx",desc:"NLE timeline editor. Visual/audio/overlay/subtitle tracks. FFmpeg export."},
    {name:"IdePage",file:"src/pages/IdePage.tsx",desc:"Multi-tab code editor, syntax highlighting, file explorer, Quick Open, AI copilot."},
    {name:"MusicPage",file:"src/pages/MusicPage.tsx",desc:"Music player with playlists, metadata, cover art, drag-and-drop import."},
    {name:"TilesPage",file:"src/pages/TilesPage.tsx",desc:"Multi-terminal grid (1x2, 2x2, 3x3). Sessions persist across layout changes."},
    {name:"HandsPage",file:"src/pages/HandsPage.tsx",desc:"Remote mobile dashboard. WebSocket relay, tunnel, pairing codes, activity."},
],
stores: [
    {name:"appStore",file:"src/store/appStore.ts",desc:"Init, provider status, models, settings, error state, API key management."},
    {name:"chatStore",file:"src/store/chatStore.ts",desc:"Conversations, active conversation, composer, agent mode, tool calls, streams."},
    {name:"mediaStore",file:"src/store/mediaStore.ts",desc:"Media categories, assets, generation status, realtime session, editor export."},
    {name:"workspaceStore",file:"src/store/workspaceStore.ts",desc:"Workspaces, active workspace, indexed items, selection, scan progress."},
    {name:"musicStore",file:"src/store/musicStore.ts",desc:"Tracks, categories, playback state, volume, repeat mode."},
    {name:"terminalStore",file:"src/store/terminalStore.ts",desc:"Terminal sessions, output buffer, session count."},
    {name:"handsStore",file:"src/store/handsStore.ts",desc:"Hands status, connections, activity log, generated assets."},
    {name:"tileStore",file:"src/store/tileStore.ts",desc:"Tile layout, active tile, session management."},
]};

// ═══════════════════════════════════════════════════════════════════════
// RENDER THE SINGLE PAGE
// ═══════════════════════════════════════════════════════════════════════
let convs=[], activeConvId=null, sending=false;

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

function renderPage(){
    let h='';
    // ── Tauri IPC Commands ──
    h+=`<div class="sec" id="sec-commands"><h2 class="sec-hdr" id="hdr-commands"><span class="ico">&#9632;</span> Tauri IPC Commands</h2>`;
    h+=`<p>The Rust backend exposes these commands to the React frontend via Tauri's invoke() IPC. Defined in <code>src-tauri/src/lib.rs</code>.</p>`;
    D.groups.forEach(g=>{
        h+=`<h3 id="grp-${g.id}">${g.name}</h3><p>${g.desc} <span class="file-ref">${g.file}</span></p>`;
        g.commands.forEach(c=>{
            h+=`<div class="cmd-card" id="cmd-${c.name}"><div class="cmd-head" onclick="toggle(this)"><span class="cmd-method invoke">invoke</span><span class="cmd-name">${c.name}</span><span class="cmd-sig">${c.sig}</span></div>`;
            h+=`<div class="cmd-body"><div class="cmd-desc">${c.desc}</div>`;
            if(c.params.length){
                h+=`<table class="cmd-params"><tr><th>Param</th><th>Type</th><th>Description</th></tr>`;
                c.params.forEach(p=>{h+=`<tr><td class="pn">${p.n}</td><td class="pt">${esc(p.t)}</td><td>${p.d}</td></tr>`;});
                h+=`</table>`;
            }
            h+=`</div></div>`;
        });
    });
    h+=`</div>`;

    // ── Events ──
    h+=`<div class="sec" id="sec-events"><h2 class="sec-hdr" id="hdr-events"><span class="ico">&#9632;</span> Events (Backend -> Frontend)</h2>`;
    h+=`<p>Subscribed via Tauri's listen() API in <code>src/lib/tauri.ts</code>.</p>`;
    D.events.forEach(e=>{
        h+=`<div class="cmd-card" id="evt-${e.name.replace(/[:/]/g,'-')}"><div class="cmd-head" onclick="toggle(this)"><span class="cmd-method event">event</span><span class="cmd-name">${e.name}</span><span class="cmd-sig">${e.type}</span></div>`;
        h+=`<div class="cmd-body"><div class="cmd-desc">${e.desc}</div><p style="font-size:10px;color:var(--text-dim)">Fields: ${e.fields}</p></div></div>`;
    });
    h+=`</div>`;

    // ── Types ──
    h+=`<div class="sec" id="sec-types"><h2 class="sec-hdr" id="hdr-types"><span class="ico">&#9632;</span> TypeScript Interfaces</h2>`;
    h+=`<p>Defined in <code>src/types.ts</code>. Map 1:1 with Rust backend structs serialized as JSON over IPC.</p>`;
    D.types.forEach(t=>{
        h+=`<h3 id="type-${t.name}">${t.name}</h3><pre class="td">${esc(t.def)}</pre>`;
    });
    h+=`</div>`;

    // ── Rust Backend Modules ──
    h+=`<div class="sec" id="sec-rust-modules"><h2 class="sec-hdr" id="hdr-rust-modules"><span class="ico">&#9632;</span> Rust Backend Modules</h2>`;
    h+=`<p>Located in <code>src-tauri/src/</code>.</p>`;
    D.modules_rust.forEach(m=>{
        h+=`<div class="cmd-card" id="mod-rust-${m.name.replace('.','_')}"><div class="cmd-head" onclick="toggle(this)"><span class="cmd-method module">mod</span><span class="cmd-name">${m.name}</span><span class="cmd-sig">${m.area}</span></div>`;
        h+=`<div class="cmd-body"><div class="cmd-desc">${m.desc}</div><p class="file-ref">src-tauri/src/${m.name}</p></div></div>`;
    });
    h+=`</div>`;

    // ── ASCIIVision Core Modules ──
    h+=`<div class="sec" id="sec-av-modules"><h2 class="sec-hdr" id="hdr-av-modules"><span class="ico">&#9632;</span> ASCIIVision Core Modules</h2>`;
    h+=`<p>Located in <code>asciivision-core/src/</code>. The standalone ratatui TUI.</p>`;
    D.modules_av.forEach(m=>{
        h+=`<div class="cmd-card" id="mod-av-${m.name.replace('.','_')}"><div class="cmd-head" onclick="toggle(this)"><span class="cmd-method module">mod</span><span class="cmd-name">${m.name}</span><span class="cmd-sig">${m.area}</span></div>`;
        h+=`<div class="cmd-body"><div class="cmd-desc">${m.desc}</div><p class="file-ref">asciivision-core/src/${m.name}</p></div></div>`;
    });
    h+=`</div>`;

    // ── Frontend Pages ──
    h+=`<div class="sec" id="sec-pages"><h2 class="sec-hdr" id="hdr-pages"><span class="ico">&#9632;</span> Frontend Pages</h2>`;
    h+=`<p>React page components in <code>src/pages/</code>. Lazy-loaded via React.lazy() + Suspense.</p>`;
    D.pages.forEach(p=>{
        h+=`<div class="cmd-card" id="page-${p.name}"><div class="cmd-head" onclick="toggle(this)"><span class="cmd-method page">page</span><span class="cmd-name">${p.name}</span><span class="cmd-sig">${p.file}</span></div>`;
        h+=`<div class="cmd-body"><div class="cmd-desc">${p.desc}</div></div></div>`;
    });
    h+=`</div>`;

    // ── Zustand Stores ──
    h+=`<div class="sec" id="sec-stores"><h2 class="sec-hdr" id="hdr-stores"><span class="ico">&#9632;</span> Zustand Stores</h2>`;
    h+=`<p>State management split into domain stores in <code>src/store/</code>.</p>`;
    D.stores.forEach(s=>{
        h+=`<div class="cmd-card" id="store-${s.name}"><div class="cmd-head" onclick="toggle(this)"><span class="cmd-method module">store</span><span class="cmd-name">${s.name}</span><span class="cmd-sig">${s.file}</span></div>`;
        h+=`<div class="cmd-body"><div class="cmd-desc">${s.desc}</div></div></div>`;
    });
    h+=`</div>`;

    // ── CLI Commands ──
    h+=`<div class="sec" id="sec-cli"><h2 class="sec-hdr" id="hdr-cli"><span class="ico">&#9632;</span> ASCIIVision CLI Commands</h2>`;
    h+=`<p>Slash commands available inside the asciivision-core TUI transmit bar.</p>`;
    D.cli.forEach(cat=>{
        h+=`<h3 id="cli-${cat.cat.replace(/\s+/g,'-').toLowerCase()}">${cat.cat}</h3>`;
        cat.cmds.forEach(c=>{
            h+=`<div class="cmd-card" id="cli-${c.n.replace(/[^a-zA-Z0-9]/g,'-')}"><div class="cmd-head"><span class="cmd-method slash">cmd</span><span class="cmd-name">${esc(c.n)}</span></div>`;
            h+=`<div class="cmd-body open"><div class="cmd-desc">${c.d}</div></div></div>`;
        });
    });
    h+=`</div>`;

    document.getElementById('content').innerHTML = h;
}

// ── Sidebar ─────────────────────────────────────────────────────────
function renderSidebar(){
    const f=(document.getElementById('sb-filter')?.value||'').toLowerCase();
    let h='';
    // Commands
    D.groups.forEach(g=>{
        const cmds=g.commands.filter(c=>!f||c.name.includes(f)||c.desc.toLowerCase().includes(f));
        if(!cmds.length&&f)return;
        h+=`<div class="sb-group" onclick="goTo('grp-${g.id}')">${g.name}</div>`;
        (f?cmds:g.commands).forEach(c=>{
            h+=`<div class="sb-item" onclick="goTo('cmd-${c.name}')"><span class="sb-dot" style="background:var(--accent)"></span>${c.name}</div>`;
        });
    });
    // Events
    const evts=D.events.filter(e=>!f||e.name.toLowerCase().includes(f));
    if(evts.length){
        h+=`<div class="sb-group" onclick="goTo('sec-events')">Events</div>`;
        evts.forEach(e=>{h+=`<div class="sb-item" onclick="goTo('evt-${e.name.replace(/[:/]/g,'-')}')"><span class="sb-dot" style="background:var(--purple)"></span>${e.name}</div>`;});
    }
    // Types
    const types=D.types.filter(t=>!f||t.name.toLowerCase().includes(f));
    if(types.length){
        h+=`<div class="sb-group" onclick="goTo('sec-types')">Types</div>`;
        types.forEach(t=>{h+=`<div class="sb-item" onclick="goTo('type-${t.name}')"><span class="sb-dot" style="background:var(--amber)"></span>${t.name}</div>`;});
    }
    // Rust Modules
    const rmods=D.modules_rust.filter(m=>!f||m.name.toLowerCase().includes(f)||m.area.toLowerCase().includes(f));
    if(rmods.length){
        h+=`<div class="sb-group" onclick="goTo('sec-rust-modules')">Backend Modules</div>`;
        rmods.forEach(m=>{h+=`<div class="sb-item" onclick="goTo('mod-rust-${m.name.replace('.','_')}')"><span class="sb-dot" style="background:var(--pink)"></span>${m.name} <span class="sb-badge">${m.area}</span></div>`;});
    }
    // AV Modules
    const amods=D.modules_av.filter(m=>!f||m.name.toLowerCase().includes(f)||m.area.toLowerCase().includes(f));
    if(amods.length){
        h+=`<div class="sb-group" onclick="goTo('sec-av-modules')">ASCIIVision Modules</div>`;
        amods.forEach(m=>{h+=`<div class="sb-item" onclick="goTo('mod-av-${m.name.replace('.','_')}')"><span class="sb-dot" style="background:var(--pink)"></span>${m.name} <span class="sb-badge">${m.area}</span></div>`;});
    }
    // Pages
    const pgs=D.pages.filter(p=>!f||p.name.toLowerCase().includes(f));
    if(pgs.length){
        h+=`<div class="sb-group" onclick="goTo('sec-pages')">Pages</div>`;
        pgs.forEach(p=>{h+=`<div class="sb-item" onclick="goTo('page-${p.name}')"><span class="sb-dot" style="background:var(--blue)"></span>${p.name}</div>`;});
    }
    // Stores
    const sts=D.stores.filter(s=>!f||s.name.toLowerCase().includes(f));
    if(sts.length){
        h+=`<div class="sb-group" onclick="goTo('sec-stores')">Stores</div>`;
        sts.forEach(s=>{h+=`<div class="sb-item" onclick="goTo('store-${s.name}')"><span class="sb-dot" style="background:var(--pink)"></span>${s.name}</div>`;});
    }
    // CLI
    D.cli.forEach(cat=>{
        const cmds=cat.cmds.filter(c=>!f||c.n.toLowerCase().includes(f)||c.d.toLowerCase().includes(f));
        if(!cmds.length&&f)return;
        h+=`<div class="sb-group" onclick="goTo('cli-${cat.cat.replace(/\\s+/g,'-').toLowerCase()}')">${cat.cat}</div>`;
        (f?cmds:cat.cmds).forEach(c=>{h+=`<div class="sb-item" onclick="goTo('cli-${c.n.replace(/[^a-zA-Z0-9]/g,'-')}')"><span class="sb-dot" style="background:var(--cyan)"></span>${esc(c.n)}</div>`;});
    });
    document.getElementById('sb-list').innerHTML=h;
}
function filterSidebar(){renderSidebar();}

function goTo(id){
    const el=document.getElementById(id);
    if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
}
function toggle(el){el.nextElementSibling?.classList.toggle('open');}

// ── Copy All ────────────────────────────────────────────────────────
function copyAll(){
    const content=document.getElementById('content');
    const text=content.innerText;
    navigator.clipboard.writeText(text).then(()=>{
        const btn=document.getElementById('copy-btn');
        btn.textContent='Copied!';btn.classList.add('copied');
        setTimeout(()=>{btn.textContent='Copy All';btn.classList.remove('copied');},2000);
    });
}

// ── Ollama & Chat ───────────────────────────────────────────────────
async function checkOllama(){try{const r=await fetch('?api=models&ollama_url='+encodeURIComponent(document.getElementById('ollama-url').value));const d=await r.json();document.getElementById('ollama-dot').className='status-dot'+(d.models?.length?' on':'');}catch{document.getElementById('ollama-dot').className='status-dot';}}
async function loadModels(){const s=document.getElementById('model-sel');try{const r=await fetch('?api=models&ollama_url='+encodeURIComponent(document.getElementById('ollama-url').value));const d=await r.json();if(d.models?.length){s.innerHTML=d.models.map(m=>`<option value="${m}">${m}</option>`).join('');}else{s.innerHTML='<option value="" disabled selected>No models found</option>';}}catch{s.innerHTML='<option value="" disabled selected>Ollama not running</option>';}}
function renderConvs(){const el=document.getElementById('conv-list');if(!convs.length){el.innerHTML='';return;}el.innerHTML=convs.map(c=>`<div class="conv-row ${activeConvId===c.id?'active':''}" onclick="loadConv(${c.id})"><span>${esc(c.title)}</span><span class="conv-del" onclick="event.stopPropagation();delConv(${c.id})">&times;</span></div>`).join('');}
async function loadConv(id){activeConvId=id;renderConvs();const r=await fetch('?api=history&conversation_id='+id);const msgs=await r.json();const el=document.getElementById('chat-msgs');if(!msgs.length){el.innerHTML='<div class="msg system">New conversation.</div>';return;}el.innerHTML=msgs.map(m=>renderMsg(m.role,m.content)).join('');el.scrollTop=el.scrollHeight;}
async function newChat(){const r=await fetch('?api=new_chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'New Chat'})});const d=await r.json();convs.unshift({id:d.id,title:d.title});activeConvId=d.id;renderConvs();document.getElementById('chat-msgs').innerHTML='<div class="msg system">New conversation.</div>';}
async function delConv(id){await fetch('?api=delete_chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});convs=convs.filter(c=>c.id!==id);if(activeConvId===id){activeConvId=null;document.getElementById('chat-msgs').innerHTML='<div class="msg system">Select or start a conversation.</div>';}renderConvs();}
function renderMsg(role,content){if(role==='user')return `<div class="msg user"><div class="msg-lbl">You</div>${esc(content)}</div>`;return `<div class="msg assistant"><div class="msg-lbl">AI</div><div class="msg-md">${content}</div></div>`;}
async function sendMsg(){
    if(sending)return;
    const inp=document.getElementById('chat-in');
    const msg=inp.value.trim();
    if(!msg)return;
    if(!activeConvId)await newChat();
    inp.value='';inp.style.height='auto';
    const el=document.getElementById('chat-msgs');
    el.innerHTML+=renderMsg('user',msg);
    // Create the assistant message container for streaming
    const aiDiv=document.createElement('div');
    aiDiv.className='msg assistant';
    aiDiv.innerHTML='<div class="msg-lbl">AI</div><div class="msg-md" id="stream-target"><span style="color:var(--accent)">Thinking...</span></div>';
    el.appendChild(aiDiv);
    el.scrollTop=el.scrollHeight;
    sending=true;document.getElementById('send-btn').disabled=true;
    try{
        const r=await fetch('?api=chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation_id:activeConvId,message:msg,model:document.getElementById('model-sel').value,ollama_url:document.getElementById('ollama-url').value})});
        if(!r.ok) throw new Error('HTTP '+r.status);
        const reader=r.body.getReader();
        const decoder=new TextDecoder();
        let full='',buf='',started=false;
        while(true){
            const {done,value}=await reader.read();
            if(done)break;
            buf+=decoder.decode(value,{stream:true});
            const lines=buf.split('\n');
            buf=lines.pop();
            for(const line of lines){
                const trimmed=line.trim();
                if(!trimmed.startsWith('data: '))continue;
                const json=trimmed.slice(6);
                try{
                    const d=JSON.parse(json);
                    if(d.error){
                        document.getElementById('stream-target').innerHTML=`<span style="color:var(--red)">${esc(d.error)}</span>`;
                        break;
                    }
                    if(d.token){
                        if(!started){document.getElementById('stream-target').textContent='';started=true;}
                        full+=d.token;
                        document.getElementById('stream-target').textContent=full;
                        el.scrollTop=el.scrollHeight;
                    }
                    if(d.done){
                        // Final render with proper text
                        document.getElementById('stream-target').textContent=full;
                        document.getElementById('stream-target').removeAttribute('id');
                        const cv=convs.find(c=>c.id===activeConvId);
                        if(cv&&cv.title==='New Chat'){cv.title=msg.substring(0,50);renderConvs();}
                    }
                }catch{}
            }
        }
        if(!started && full===''){
            document.getElementById('stream-target')?.remove();
            el.innerHTML+=`<div class="msg system">No response received. Check that the model is loaded in Ollama.</div>`;
        }
    }catch(e){
        const st=document.getElementById('stream-target');
        if(st)st.innerHTML=`<span style="color:var(--red)">Error: ${esc(e.message)}</span>`;
        else el.innerHTML+=`<div class="msg system">Error: ${esc(e.message)}</div>`;
    }
    sending=false;document.getElementById('send-btn').disabled=false;el.scrollTop=el.scrollHeight;
}
function toggleChat(){const p=document.getElementById('chat-panel');const isOpen=p.classList.contains('overlay-open');if(isOpen){p.classList.remove('overlay-open');p.removeAttribute('style');}else{p.classList.add('overlay-open');}}

// ── Init ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',async()=>{
    renderPage();renderSidebar();
    const c=await fetch('?api=conversations').then(r=>r.json());convs=c;renderConvs();
    checkOllama();loadModels();
    document.getElementById('chat-in').addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,90)+'px';});
});
document.getElementById('ollama-url')?.addEventListener('change',()=>{checkOllama();loadModels();});
</script>
</body>
</html>

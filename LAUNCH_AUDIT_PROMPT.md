# Pre-Launch Audit Prompt

Paste this into a fresh Claude Code chat in the Super-Asciivision directory:

---

You are doing a pre-launch audit of Super ASCIIVision (Tauri 2 desktop app). The app ships tomorrow. Your job is to verify everything works and nothing embarrassing ships. Do NOT make changes — just report findings. Run these checks in parallel where possible:

## 1. Build verification
- Run `npx tsc --noEmit` — report any TypeScript errors
- Run `npm test` — report any test failures
- Run `cargo check --manifest-path src-tauri/Cargo.toml` — report any Rust errors
- Run `cargo check --manifest-path asciivision-core/Cargo.toml` — report any sidecar errors

## 2. Secret scan
- Search ALL tracked files for patterns: `sk-ant-`, `sk-proj-`, `xai-`, `AIzaSy`, `Bearer `, hardcoded API keys, passwords, tokens
- Run `git log --all -p | grep -E "sk-ant-|sk-proj-|xai-[a-zA-Z0-9]{20}" | head -20` to check git history for leaked keys
- Verify `.gitignore` covers: `.env`, `*.key`, `secrets/`, `node_modules/`, `target/`
- Check that `asciivision-core/.env` is NOT tracked: `git ls-files asciivision-core/.env`

## 3. Endpoint wiring
- Read `src-tauri/src/lib.rs` and extract every `#[tauri::command]` function name
- Grep `src/lib/tauri.ts` for every `invoke()` call
- Report any frontend invoke calls that don't have a matching backend command, or vice versa

## 4. README + landing page accuracy
- Read `README.md` — check that all install commands are correct, no dead links, no references to removed releases/downloads
- Read `index.html` — verify GitHub URL is correct, install commands match README, no broken anchor links
- Read `hands-relay/README.md` — verify deploy button URL points to the correct repo

## 5. Config sanity
- Read `src-tauri/tauri.conf.json` — verify version, identifier, CSP, bundle settings, no dev-only URLs in prod config
- Read `package.json` — verify version matches tauri.conf.json, no `file:` or `link:` dependencies
- Read `render.yaml` — verify it's generic (not pointing to a personal deployment)

## 6. Quick UX smoke check (read-only)
- Read each page component in `src/pages/` — look for hardcoded localhost URLs, TODO/FIXME/HACK comments, placeholder text that shouldn't ship, console.log statements
- Read `src/store/appStore.ts` — verify defaults are sane (default provider, fallback settings)
- Check that the `index.html` landing page video placeholder is clearly marked for replacement

## 7. Report
Give me a single summary with:
- PASS: things that checked out
- WARN: non-blocking issues worth knowing about
- FAIL: anything that would embarrass us on launch day

Be thorough but concise. Don't fix anything — just report.

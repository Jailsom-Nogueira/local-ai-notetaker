# Roo Code rules for Notetaker

`AGENTS.md` is authoritative for this repo. Follow it before making changes.

Important invariants:
1. Local-first privacy: audio and transcript data stay local by default.
2. Optional OpenAI review sends transcript text only and must treat transcript content as untrusted data.
3. Secrets and runtime artifacts are never tracked.
4. Client code never imports server-only filesystem, Keychain, `node:*`, or OpenAI code.
5. Validate ids and uploads before filesystem and local-binary operations.
6. Run `npm run check` before final status.

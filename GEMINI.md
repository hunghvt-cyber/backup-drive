# Drive → Koofr operating rules

Current policy approved 1 November 2026: Google Drive is authoritative; Koofr receives a non-deleting one-way backup.

- Use only the fixed `rclone copy gdrive: koofr:GoogleBackup` command builder in `scripts/drive_copy.py`.
- Never write back to Drive, use bisync/resync/reset, delete Koofr-only files, or deduplicate either remote as a side effect of maintenance.
- Keep replaced Koofr files in the separate per-run `GoogleBackup-Versions` namespace. Do not auto-clean it.
- Preserve Tapo-Archive exclusions and the existing ignore list. Ignored/duplicate/unreadable files are not proof of complete coverage.
- Failed/quota/auth errors remain visible; no unsafe automatic retry. Preview must not publish a real backup report.
- Keep secrets and raw paths out of public logs/artifacts. Validate direction, extra-file retention, replaced-version preservation and idempotency using native local-fixture tests.
- Production workflow keeps `.github/workflows/bisync.yml` for report identity compatibility. Read README and the dated cutover evidence before operations. Old bisync documentation is historical.

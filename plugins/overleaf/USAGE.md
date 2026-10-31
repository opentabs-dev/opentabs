# Overleaf usage and safety

## Supported workflow

This plugin supports hosted `overleaf.com` only, not self-hosted Overleaf.

1. Sign in to Overleaf and use `overleaf__list_projects` to obtain project IDs.
2. Open an existing project editor in the same browser profile. The dashboard can list projects, but the other tools require the editor's realtime client.
3. Use `overleaf__get_project` with an explicit `project_id` to obtain permissions, existing settings, and the complete ID-bearing file tree.
4. Pass those project and file IDs to `overleaf__read_file` or `overleaf__search_project`.
5. Call `overleaf__get_pdf` only when a fresh PDF is needed.

Every project operation requires `project_id`; it never silently reads whichever project is open. An editor tab can access another project that the signed-in user can read. When several tabs match the plugin, use OpenTabs' optional `tabId` targeting to select an editor tab.

## Read-only source access

There are exactly five tools. None edits or replaces source, creates or moves files/folders, changes settings, or modifies sharing, comments, or history. Reading and searching use server-saved source, not unsynced text in an editor. They never submit editor operations, flush browser editor buffers, or compile.

Opening an editor manually can trigger Overleaf's own normal auto-compile. That is separate from the plugin's read/search operations.

`get_project` returns folders, editable documents, and stored files with IDs and project-relative paths. Projects exceeding 2,000 entities or 40 nested folder levels are rejected rather than returned as a silently incomplete tree. Missing settings remain explicitly unavailable; the plugin does not invent or repair them.

## Listing and search limits

`list_projects` accepts an optional case-insensitive name substring and an `offset`/`limit` page, with at most 100 results per call. Overleaf's current dashboard backend returns the full filtered list and ignores its page fields, so pagination is explicitly client-side. Use the same filter on subsequent pages; changes to projects between requests can shift offsets. Unsupported partial backend lists are reported as errors.

`read_file` accepts one-based inclusive `start_line` and `end_line` values. It reads at most 1 MiB and returns at most 2,000 lines and 100,000 characters per call. Binary and invalid UTF-8 content is rejected. Results identify the file, returned range, truncation reasons, and whether the full line count is known. A byte-limited partial final line is omitted; a single line exceeding the output character limit is rejected.

`search_project` performs a literal single-line search, not a regular expression. Case sensitivity is optional; `path_filter` is a case-sensitive path substring, not a glob. It searches editable text documents and recognized source/bibliography text files, not PDFs, images, or fonts.

Search limits are 100 files, 100 matching lines, 1 MiB per file, 10 MiB overall, and two minutes per scan. Each matching line has one excerpt of at most 320 characters. Defaults are 50 files and 50 matches. The aggregate byte limit also applies to the final partially read file.

Always inspect `complete`, counts, and `issues`: a bounded or failed scan is not evidence that the whole project has no matches. Intentionally filtered/binary files, unread files, byte/match limits, and failed files are reported; issue details are capped at 100 with an explicit omitted count. Separate file reads are not an atomic project snapshot.

## PDF compilation and freshness

**`get_pdf` compiles**, despite its generated tool-table classification as “Read.” It is the only compilation entry point. There is no separate compile or diagnostics tool.

Each call currently requests a compile because an existing PDF or cached success does not prove freshness. The plugin preserves the existing main document and compiler configuration, waits for the real compile response, and never stops another compile. If the configured main document is unset or unavailable, it returns an explicit validation failure without changing settings.

Freshness refers to the source snapshot used by Overleaf's compile service. It excludes unsynced browser editor text. Source or settings can change during compilation or after that snapshot, so the result is not an atomic snapshot at return time.

A successful result includes a build-specific **authenticated** `pdf_url`, whether compilation ran, and a build ID when available. It does not contain PDF bytes, base64, a local download, or a public sharing link. Treat this URL and diagnostic contents as private project data. The URL requires the caller's Overleaf session and remains subject to Overleaf's output retention.

Overleaf can produce a PDF while reporting LaTeX errors or warnings. `success` reflects the server's successful output status and a safe PDF URL, not an assertion that the document is error-free. Always inspect the diagnostics.

On a failed build, no old PDF is returned as current. Transport, authentication, rate-limit, and timeout failures use structured tool errors. There is no blind retry: an ambiguous response may mean a compile is still running. A timestamp-only, project-scoped browser storage guard prevents another plugin submission for 13 minutes after that request. Confirmed responses clear the guard. Cross-tab Web Locks also prevent concurrent plugin submissions.

## Diagnostic coverage

PDF and logs are taken from the same confirmed build. The plugin reads `output.log` and bibliography `.blg` outputs, up to eight logs and 256 KiB per log, and returns at most 100 structured LaTeX/BibTeX/Biber diagnostics.

Log parsing is intentionally partial and pattern-based. Per-log `status`, `reason`, and `truncated` fields distinguish partial extraction, unparsed logs, and unavailable logs. Unrecognized logs have a bounded excerpt; omitted logs and diagnostic limits are explicit. Missing or mismatched-build logs are not silently replaced with cached logs.

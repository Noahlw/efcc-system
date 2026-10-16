# Preserve mobile coverage through UI refactors

Status: accepted design from the foundation planning interview; implementation pending.

Source selection will preserve the relevant mobile-engine coverage for browser UI capabilities when files are created, renamed or extracted. Coverage follows the capability rather than its current filenames. Narrower selection requires an explicit server-only or non-mobile justification; unknown paths continue to fail closed in affected and staged selection.

The existing selector and native discovery/execution remain the owners. This conservative policy may execute additional mobile cases, but avoids silently reducing coverage when a view moves into a new file. Regression evidence must exercise complete selection results for extraction, rename and subsequent edits to the new file.

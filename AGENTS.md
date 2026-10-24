# Repository working instructions

The user has explicitly authorized committing and pushing code changes by default. After completing an implementation task and its relevant checks, commit the changes and push to the repository's remote branch without asking for another confirmation, unless the user instructs otherwise. Preserve unrelated user changes; do not force-push or overwrite remote history.

Read README.md and docs/ACCEPTANCE.md for setup and verification. Use npm run accept for changes affecting language semantics, code generation, debugging, or other milestone functionality; use focused checks for smaller changes. Documentation-only updates do not require repeating the full acceptance suite. Do not edit application source while browser tests are running.

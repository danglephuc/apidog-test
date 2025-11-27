# Repository Guidelines

## Project Structure & Module Organization
- Core CLI logic lives in `src/apidog_test/__init__.py` (Typer app, Rich output, download/validation helpers).
- Templates used for initialization are in `templates/`; keep them minimal and versioned.
- Node-based helper scripts for scenario conversion sit in `scripts/node/*.js`.
- AI command definitions for editors are documented under `commands/` (Cursor/Copilot usage notes).
- `test-cursor/` is available for editor-driven experiments; keep generated artifacts out of version control.

## Build, Test, and Development Commands
- Install for local development (editable): `uv pip install -e .` (requires Python 3.11+).
- Run the CLI locally after edits: `uv run apidog-test --help` or `uv run apidog-test check --verbose`.
- Smoke-test initialization in a temp folder: `uv run apidog-test init /tmp/apidog-sample --ai none --force`.
- Build a wheel for distribution: `uv build` (uses hatchling backend defined in `pyproject.toml`).

## Coding Style & Naming Conventions
- Follow PEP 8 with 4-space indentation; keep functions small and typed (type hints are expected throughout).
- Use `snake_case` for functions/variables, `PascalCase` for classes, and ALL_CAPS for constants (e.g., `RETRY_CONFIG`).
- Keep CLI output routed through `rich.console.Console`; prefer structured panels/tables over raw prints.
- Avoid spreading logic across new modules unless the CLI entry file becomes unwieldy; favor cohesive helpers inside `__init__.py`.

## Testing Guidelines
- No automated test suite exists yet; perform manual smoke checks (`apidog-test version`, `apidog-test check`, and an `init` run) before submitting changes.
- When adding automated tests, place them under `tests/` and target the Typer commands and retry/download helpers; prefer `pytest` style with explicit fixtures.
- Ensure templates and scripts still match the expected manifest layout after modifications.

## Commit & Pull Request Guidelines
- Existing history uses short imperative messages (e.g., “Init”); keep commits concise, present-tense, and scoped to a single concern.
- In PRs, include: summary of behavior changes, manual test commands run, and any template/script diffs highlighted.
- Link related issues when available and attach terminal output snippets for CLI-facing changes (before/after where relevant).

## Security & Configuration Tips
- Network operations hit GitHub releases; honor exponential backoff defaults and avoid embedding access tokens in code or templates.
- If higher rate limits are needed, document `GH_TOKEN` usage in PR descriptions but do not commit secrets or `.env` files.

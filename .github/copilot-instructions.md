# Copilot Instructions for apidog-test

## Project Overview
- `apidog-test` is a CLI tool for initializing API test infrastructure with AI agent integration (Cursor, GitHub Copilot).
- Major directories:
  - `.apidog/`: CLI-managed files, templates, scenarios, and version info.
  - `src/apidog_test/`: Python source code for core logic.
  - `scripts/node/`: Node.js scripts for endpoint and scenario manipulation.
  - `specs/`: Markdown specs, plans, and contracts for API testing.
  - `.cursor/commands/` and `.github/agents/`: AI agent command/config folders (created by CLI based on selected agent).

## Key Workflows
- **Initialize Project:**
  - Run `apidog-test init .` to set up structure and download templates from `https://github.com/phucdl/apidog-templates`.
  - Use `--ai copilot` or `--ai cursor` to enable agent-specific features.
  - Use `--force` to overwrite existing `.apidog` folder.
- **Add OpenAPI Spec:**
  - Place your OpenAPI file (e.g., `openapi.json`) in the project root.
- **Generate Scenarios:**
  - Use agent commands (Cursor or Copilot) to generate test scenarios from OpenAPI specs.
  - Generated tests appear in `.apidog/scenarios/`.

## Patterns & Conventions
- **Templates:**
  - Located in `.apidog/templates/` (JSON, YAML). Used for scenario/test generation.
- **Scripts:**
  - Node.js scripts in `scripts/node/` for advanced manipulation (e.g., merging, converting scenarios).
- **Specs:**
  - Markdown files in `specs/001-apidog-cli-init/` document requirements, plans, and contracts.
- **AI Agent Integration:**
  - Cursor: Uses `.cursor/commands/` for custom commands.
  - Copilot: Uses `.github/agents/` for agent definitions and `.apidog/templates/` for test generation.

## Troubleshooting
- If downloads fail, CLI retries 3 times (exponential backoff).
- For network/firewall issues, set `GH_TOKEN` and use `--force` if needed.

## Example Commands
- `apidog-test init . --ai copilot`
- `apidog-test init . --force --ai cursor`
- `cp ~/openapi.json .`

## References
- See `README.md` for detailed setup, workflow, and troubleshooting steps.
- Key files: `.apidog/manifest.json`, `.apidog/templates/`, `src/apidog_test/`, `scripts/node/`, `specs/`

---
**For AI agents:**
- Always check `.apidog/` and `README.md` for current project state and conventions.
- Use agent-specific folders for commands/configuration.
- Prefer project templates and scripts for scenario/test generation and manipulation.

# Apidog Test CLI

Initialize Apidog test infrastructure with AI agent integration for automated test scenario generation.

## Overview

`apidog-test` is a command-line tool that sets up the foundation for API testing with Apidog. It downloads templates, scripts, and configuration from GitHub, then integrates with AI assistants (Cursor, GitHub Copilot) to enable intelligent test generation from OpenAPI specifications.

## Features

- 🚀 **Quick Setup**: Initialize `.apidog` folder structure with one command
- 🤖 **AI Integration**: Built-in support for Cursor and GitHub Copilot
- 📦 **Template Management**: Pulls the latest GitHub release assets (zip) with retries
- ✅ **Conflict Detection**: Manifest-based file tracking for safe updates
- 🔄 **Automatic Retry**: Network resilience with exponential backoff
- 🎨 **Rich UI**: Progress tracking and colorful terminal output

## Installation

### Via uv

```bash
uv tool install apidog-test --from git+https://github.com/danglephuc/apidog-test.git
```

## Quick Start


### Initialize a new project (downloads from GitHub)

```bash
apidog-test init my-api-tests
cd my-api-tests
```
This command downloads the latest templates, scripts, and configuration from GitHub to set up your project structure.

### Initialize in current directory

```bash
apidog-test init .
```

### Skip AI integration prompt

```bash
apidog-test init . --ai cursor
apidog-test init . --ai copilot
apidog-test init . --ai none
```

### Force overwrite existing installation

```bash
apidog-test init . --force
```

## Commands

### `init`

Initialize Apidog test infrastructure.

```bash
apidog-test init [PROJECT_NAME] [OPTIONS]
```

**Arguments:**
- `PROJECT_NAME` - Project directory name (optional, use `.` or `--here` for current directory)

**Options:**
- `--ai TEXT` - AI agent to set up: `cursor`, `copilot`, or `none` (skips interactive prompt)
- `--force` - Skip confirmations and overwrite existing files
- `--here` - Initialize in current directory
- `--github-token TEXT` - Optional; increase GitHub API rate limit if you run into throttling
- `--local-template PATH` - Use a local template zip (bypasses download; useful for testing)

**Examples:**
```bash
# Create new project with interactive AI selection
apidog-test init my-project

# Initialize here with Cursor integration
apidog-test init . --ai cursor

# Re-initialize with force
apidog-test init . --force --ai copilot

# Use a local template zip
apidog-test init . --local-template /path/to/template.zip
```

### `check`

Verify installation status and detect installed AI agents.

```bash
apidog-test check [OPTIONS]
```

**Options:**
- `--verbose` - Show detailed information

**Example:**
```bash
apidog-test check
```

### `version`

Display CLI version, template version, and system information.

```bash
apidog-test version
```

### `convert`

Convert a scenario YAML file to Apidog JSON via the bundled Node.js script.

```bash
apidog-test convert path/to/scenario.yaml [-o output.json] [--node-bin node]
# or convert all YAML files in a folder (recursive):
apidog-test convert path/to/folder
```

Defaults match the Node script behavior (writes to `.apidog/temp/` when `-o` is not provided). For directory input, all `*.yaml`/`*.yml` files are converted recursively (no `-o` in that mode). Requires `.apidog/scripts/convert_scenario.js` (installed via `init`) and Node.js on your PATH.

### `compare`

Compare OpenAPI endpoints against test case YAMLs to find untested endpoints:

```bash
apidog-test compare .apidog/openapi/<spec>.json .apidog/test-cases/<project>/ [apidog.json] [output.json]
```

Uses `.apidog/scripts/compare_endpoints.js`. Optionally include Apidog JSON for better mapping and an output path for the report.

### `merge`

Merge converted Apidog JSON test cases into a single Apidog collection file:

```bash
apidog-test merge .apidog/temp/ .apidog/collections/output/apidog.json
```

Wraps `.apidog/scripts/merge_test_cases.js`. Input is a folder of JSON test cases (from `convert`); output is the combined Apidog JSON.

### `reverse`

Reverse-convert Apidog JSON back into YAML:

```bash
apidog-test reverse .apidog/collections/output/apidog.json [output.yaml]
```

Wraps `.apidog/scripts/reverse_convert.js`. Provide an explicit output path or rely on script defaults.

## Folder Structure

After initialization, your project will have:

```
project-root/
├── .apidog/
│   ├── manifest.json          # Tracks CLI-managed files
│   ├── .version               # Version information
│   ├── templates/             # Test scenario templates
│   ├── scripts/               # Helper scripts
│   ├── collections/           # Apidog JSON input/output
│   ├── openapi/               # OpenAPI specs for generation
│   ├── temp/                  # Temporary files during conversion
│   ├── test-case/             # Generated test cases
│   └── scenarios/             # Your generated tests (create this)
├── .cursor/commands/          # Cursor AI commands (if selected)
└── .github/agents/            # GitHub Copilot agents (if selected)
```

## AI Agent Integration

### Cursor

After initialization with `--ai cursor`, you can use custom commands in the Cursor editor:

1. Open project in Cursor
2. Access commands in `.cursor/commands/`
3. Use Cursor's AI to generate test scenarios from your OpenAPI specs

### GitHub Copilot

After initialization with `--ai copilot`, agent definitions are available in `.github/agents/`:

1. Open project in VS Code with Copilot extension
2. Use agent commands for test generation
3. Copilot will use the templates in `.apidog/templates/`

## Workflow Example

```bash
# 1. Initialize with AI integration
apidog-test init my-api-project --ai cursor
cd my-api-project

# 2. Add your OpenAPI specification
cp ~/openapi.json .

# 3. Use AI to generate test scenarios
# (In Cursor: use custom commands)
# (In Copilot: use agent commands)

# 4. Generated tests appear in .apidog/scenarios/

# 5. Verify installation
apidog-test check
```

## Configuration

### GitHub Token (Optional)

The repo is public, so no token is required. If you hit rate limits, set `GH_TOKEN` or `GITHUB_TOKEN`:

```bash
export GH_TOKEN=ghp_your_token_here
apidog-test init .
```


## Troubleshooting

### Network Errors

The CLI automatically retries failed downloads (3 attempts with exponential backoff: 1s, 2s, 4s).

If downloads consistently fail:
1. Check internet connection
2. Verify GitHub is accessible
3. Set `GH_TOKEN` if behind firewall
4. Try again with `--force` flag

### Permission Errors

Ensure you have write permissions in the target directory:

```bash
# Check permissions
ls -la

# If needed, fix permissions
chmod u+w .
```

### Existing .apidog Folder

If `.apidog` exists, CLI will prompt for confirmation unless `--force` is used:

```bash
apidog-test init . --force
```


## Development


### Local Installation

```bash
uv pip install git+https://github.com/danglephuc/apidog-test
```


### Project Structure

- All logic in `src/apidog_test/__init__.py` (~1000-1500 lines)
- Core utilities: StepTracker, select_with_arrows, checksum functions
- Commands: init, check, version (update coming soon)

## Roadmap

- [ ] **Update Command** - Update templates to latest version with conflict detection
- [ ] **Dry Run Mode** - Preview changes before applying
- [ ] **Custom Template Repository** - Configure alternative GitHub repos
- [ ] **Template Versioning** - Support multiple template versions
- [ ] **Diff Viewer** - Built-in merge tool for conflicts

## License

MIT License - see [LICENSE](LICENSE) file for details

## Links

- **GitHub Repository**: https://github.com/phucdl/apidog-test

- **Issues**: https://github.com/phucdl/apidog-test/issues

## Credits

Architecture inspired by [GitHub's spec-kit](https://github.com/github/spec-kit).

---
description: Analyze OpenAPI JSON specification against test cases to identify untested API endpoints and generate coverage report.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Compare OpenAPI specification files with test case YAML files to identify:
- Untested API endpoints
- Test coverage percentage
- Endpoints grouped by tags/categories
- Detailed coverage report with recommendations

## Operating Constraints

**STRICTLY READ-ONLY**: Do **not** modify any files. Output a structured analysis report. The analysis is non-destructive and provides insights only.

## Execution Steps

### 1. Initialize Analysis Context

Parse user arguments to determine:
- Project name (optional, e.g., `front-admin`) OR explicit paths
- OpenAPI JSON file path (required if not using project name)
- Test cases directory path (required if not using project name)
- Apidog JSON file path (optional, for scenario reference mapping)
- Output path for JSON report (optional)

**Short form support:**
- If only project name provided (e.g., `front-admin`), auto-detect:
  - OpenAPI: `.apidog/openapi/Front Admin.openapi.json`
  - Test cases: `.apidog/test-cases/front-admin/`
  - Apidog: `.apidog/collections/input/Front Admin API.apidog.json`

If arguments are not provided, infer from common project structure:
- Look for OpenAPI files in `.apidog/openapi/` directory (flat structure)
- Look for test cases in `.apidog/test-cases/` directories (organized by project)
- Match by API name (e.g., `front-admin`, `front-login`, `front-external`)

**Default behavior if no arguments:**
- Search for OpenAPI files: `.apidog/openapi/*.openapi.json` (flat, no subdirectories)
- Search for matching test cases: `.apidog/test-cases/*/` (project subdirectories)
- Search for Apidog files: `.apidog/collections/input/*.apidog.json` (flat, no subdirectories)

### 2. Validate Input Files

Verify that:
- OpenAPI JSON file exists and is valid JSON
- Test cases directory exists and contains YAML files
- Apidog file exists (if provided) and is valid JSON

Abort with clear error messages if any required file is missing or invalid.

### 3. Run Comparison Script

Execute the comparison script:
```bash
node .apidog/scripts/compare_endpoints.js <openapi.json> <test-cases-dir> [apidog.json] [output.json]
```

Parse the JSON output to extract:
- Total API endpoints count
- Tested endpoints count
- Untested endpoints count
- Coverage percentage
- Test files analyzed
- Endpoints grouped by tags (tested and untested)

### 4. Build Analysis Report

Generate a structured Markdown report with the following sections:

#### A. Coverage Summary

Display key metrics:
- Total APIs in OpenAPI spec
- Tested APIs count
- Untested APIs count
- Coverage percentage
- Test files analyzed

#### B. Untested APIs by Category

For each tag/category, list:
- Category name
- Number of untested endpoints
- List of untested endpoints with:
  - HTTP method
  - API path
  - Summary/description
  - Operation ID

Format as a table:

| Method | Path | Summary | Operation ID |
|--------|------|---------|--------------|
| GET | /api/v1/health | Health check | getHealth |
| POST | /api/v1/users | Create user | createUser |

#### C. Tested APIs Summary (Optional)

If user requests detailed coverage, show tested endpoints grouped by category.

#### D. Recommendations

Provide actionable recommendations:
- **High Priority**: Critical endpoints that should be tested (P0)
- **Medium Priority**: Important features (P1)
- **Low Priority**: Secondary features (P2)

Suggest specific test case files to create or update.

### 5. Generate Output

Output the analysis report in Markdown format. Include:

**Coverage Analysis Report**

```
## Summary
- Total APIs: 112
- Tested APIs: 56 (50.00%)
- Untested APIs: 56 (50.00%)
- Test Files Analyzed: 14

## Untested APIs by Category

### Health (3 endpoints)
- GET /api/v1/health - 統合ヘルスチェック（Readiness Probe用）
- GET /api/v1/healthz - 軽量ヘルスチェック（Liveness Probe用）
- GET /api/v1/metrics - Prometheusメトリクス

### Authentication (1 endpoint)
- POST /api/v1/auth/authenticate - 管理者認証

[... more categories ...]

## Recommendations

### High Priority (P0)
1. Add health check endpoints to test cases
2. Verify authentication endpoint is properly tested

### Medium Priority (P1)
1. Create test cases for Banned URLs (6 endpoints)
2. Add Surveys test coverage (4 endpoints)
3. Add Templates test coverage (4 endpoints)

### Low Priority (P2)
1. Keycloak management endpoints (18 endpoints)
2. Security geo-blocking (3 endpoints)
```

### 6. Save Detailed Report (Optional)

If output path is specified or user requests it, save a detailed JSON report with:
- Complete endpoint lists
- Metadata (file paths, analysis timestamp)
- Grouped by tags
- Ready for programmatic processing

### 7. Provide Next Actions

At the end of the report, suggest next steps:
- "Run `/apidog.analyze` with specific API to focus on one area"
- "Create test cases for untested endpoints using existing test case templates"
- "Update README.md with new coverage statistics"

## Operating Principles

### Context Efficiency
- **Minimal token usage**: Focus on actionable findings
- **Progressive disclosure**: Show summary first, details on request
- **Deterministic results**: Same inputs produce same outputs
- **Clear error messages**: Help user fix input issues

### Analysis Guidelines
- **NEVER modify files** (read-only analysis)
- **NEVER hallucinate endpoints** (only report what exists in OpenAPI spec)
- **Prioritize by impact**: Critical endpoints first
- **Use examples**: Show specific endpoints, not generic patterns
- **Report zero issues gracefully**: Celebrate 100% coverage if achieved

### Output Format
- Use Markdown tables for structured data
- Group by tags/categories for readability
- Include operation IDs and summaries for context
- Provide actionable recommendations
- Link to existing test case files when relevant

## Context

$ARGUMENTS

## Example Usage

```bash
# Analyze front-admin API (minimal - auto-detects paths)
/apidog.analyze front-admin

# Analyze front-admin API (explicit paths)
/apidog.analyze .apidog/openapi/Front Admin.openapi.json .apidog/test-cases/front-admin/

# With Apidog file for scenario mapping
/apidog.analyze .apidog/openapi/Front Admin.openapi.json .apidog/test-cases/front-admin/ .apidog/collections/input/Front Admin API.apidog.json

# Save detailed report
/apidog.analyze .apidog/openapi/Front Admin.openapi.json .apidog/test-cases/front-admin/ .apidog/collections/input/Front Admin API.apidog.json coverage_report.json
```

**Note:** When providing only a project name (e.g., `front-admin`), the command will automatically:
- Find OpenAPI file: `.apidog/openapi/Front Admin.openapi.json`
- Find test cases: `.apidog/test-cases/front-admin/`
- Find Apidog file: `.apidog/collections/input/Front Admin API.apidog.json` (if needed)

## Notes

- The comparison script handles scenario references in test cases
- API name matching is used when direct path is not specified
- Path parameters are normalized for comparison (e.g., `/api/v1/users/{id}` matches `/api/v1/users/123`)
- Test case files must follow YAML format with `steps` array
- Apidog file is optional but improves accuracy by mapping scenario names to endpoints


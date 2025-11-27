---
description: Generate test case YAML files for untested API endpoints based on coverage analysis report.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Generate test case YAML files for untested API endpoints identified in the coverage analysis. The command should:
- Read the coverage analysis report (or run analysis first)
- Identify untested endpoints grouped by category
- Generate test case YAML files following the existing template structure
- Group endpoints logically by category/priority
- Use proper naming conventions and file organization

## Operating Constraints

**READ-ONLY for analysis, WRITE for generation**: 
- Read analysis reports and existing test cases
- Generate new test case YAML files
- Do NOT modify existing test case files unless explicitly requested
- Follow existing test case patterns and conventions

## Execution Steps

### 1. Read Template File

**FIRST STEP - Always read the template:**
- Read `.apidog/templates/scenario_template.yaml`
- Parse and understand the complete YAML structure
- Note all available options, formats, and patterns
- Use this as the authoritative source for all YAML generation
- Reference specific template sections when generating steps
- Store template structure for use in all subsequent generation steps

**Template Location:** `.apidog/templates/scenario_template.yaml`

### 2. Initialize Context

Parse user arguments to determine:
- Project name (e.g., `front-admin`) OR explicit paths
- Category filter (optional, e.g., `Health`, `Authentication`)
- Priority filter (optional, e.g., `P0`, `P1`, `P2`)
- Output directory (default: `.apidog/test-cases/<project>/`)
- Whether to update existing files or create new ones

**Short form support:**
- If only project name provided (e.g., `front-admin`), auto-detect:
  - Analysis report: `.apidog/test-cases/front-admin/COVERAGE_ANALYSIS.md`
  - Test cases directory: `.apidog/test-cases/front-admin/`
  - Source Apidog: `.apidog/collections/input/Front Admin API.apidog.json`

**If analysis report doesn't exist:**
- Run `/apidog.analyze` command first to generate the report
- Then proceed with generation

### 3. Read Analysis Report

Load the coverage analysis report:
- Read `.apidog/test-cases/<project>/COVERAGE_ANALYSIS.md`
- Parse untested endpoints grouped by category
- Extract endpoint details: method, path, summary, operationId
- Identify priority levels (P0/P1/P2) from recommendations

**Alternative:** If report doesn't exist, run analysis first:
```bash
node .apidog/scripts/compare_endpoints.js <openapi.json> <test-cases-dir> [apidog.json]
```

### 4. Analyze Existing Test Cases

Review existing test case files to:
- Understand naming conventions (e.g., `01_authentication_flow.yaml`)
- See how template structure is used in practice
- Identify which files should be updated vs. new files created
- Check existing step patterns and structure
- Determine appropriate file numbers for new test cases
- Note environment_id and other options from existing files

### 5. Group Endpoints for Generation

Group untested endpoints logically:
- **By Category**: Group endpoints from same category together
- **By Priority**: Prioritize P0 endpoints first
- **By Functionality**: Group related operations (CRUD operations together)
- **By File Size**: Keep files manageable (aim for < 20 endpoints per file)

**Grouping Strategy:**
- High Priority (P0): Create/update files immediately
- Medium Priority (P1): Group by category
- Low Priority (P2): Can be grouped together or deferred

### 6. Generate Test Case Files

**Use template structure from Step 1:**
- Reference the template structure already loaded in Step 1
- Use `.apidog/templates/scenario_template.yaml` as the base for all generation
- Follow exact formatting and structure from template

For each group of endpoints, generate a YAML file using the template structure:

1. **Start with template base**: Copy the structure from `.apidog/templates/scenario_template.yaml`
2. **Customize header fields**:
   - `name`: "<Number> - <Category> Flow"
   - `description`: "Test scenario for <category> endpoints"
   - `priority`: <1-4>  # 1=P0, 2=P1, 3=P2, 4=P3
   - `tags`: ["<category>", "<subcategory>"]
   - `source_apidog`: ".apidog/collections/input/<Project> API.apidog.json"

3. **Copy options section** from template (or from existing test cases if available)

4. **Initialize datasets** as empty array (or copy from template)

5. **Generate steps** following template patterns:
   - Use template examples for step structure
   - Follow template formatting for auth, request_body_override, etc.
   - Match template patterns for path_params_override, query_params_override

**Generation Rules:**
1. **File Naming**: Use next available number (e.g., `20_keycloak_management_flow.yaml`)
2. **Step Ordering**: Order steps logically (GET before POST, list before detail, etc.)
3. **Authentication**: Include login reference if endpoints require auth
4. **Path Parameters**: Extract from previous steps when possible (e.g., `{{$.2.response.body.id}}`)
5. **Request Bodies**: Include minimal required fields for POST/PUT/PATCH
6. **Assertions**: Add basic response validation assertions

### 7. Determine File Updates vs. New Files

**Important:** When updating existing files, preserve their structure and only add new steps following the template format.

**Update Existing Files When:**
- Endpoints belong to existing category (e.g., add health endpoints to `14_health_check_flow.yaml`)
- File covers same functional area
- Endpoints are closely related to existing tests

**Create New Files When:**
- New category with no existing file (e.g., Keycloak management)
- Existing file is already large (> 15 steps)
- Endpoints are functionally distinct

### 8. Generate Test Case Content

**Important:** All step structures must follow the patterns defined in `.apidog/templates/scenario_template.yaml`. Reference the template for:
- Step number formatting
- Type definitions (http, testCaseRef, if, delay, script)
- Auth structure
- Request body override format
- Path/query/header/cookie parameter override format
- Assertions structure
- Post-processors structure

For each endpoint, generate appropriate step:

**Step Generation Examples:**

All examples below reference the structure from `.apidog/templates/scenario_template.yaml`. Always read the template first to get the exact format.

**GET Endpoints:**
- Reference template lines 62-128 for HTTP step structure
- Use template's auth format (lines 73-75)
- Use template's path_params_override format (lines 110-114)
- Use template's query_params_override format (lines 104-108)

**POST Endpoints:**
- Reference template lines 62-128 for HTTP step structure
- Use template's request_body_override format (lines 77-82)
- Use template's auth format
- Follow template's data format (multiline string with `|`)

**PUT/PATCH Endpoints:**
- Reference template lines 62-128 for HTTP step structure
- Use template's path_params_override format (lines 110-114)
- Use template's request_body_override format (lines 77-82)
- Extract path parameter values from previous steps using template's variable syntax

**DELETE Endpoints:**
- Reference template lines 62-128 for HTTP step structure
- Use template's path_params_override format (lines 110-114)
- Extract path parameter values from previous steps

**Important:** Always read `.apidog/templates/scenario_template.yaml` to get the exact YAML structure, formatting, and all available options before generating any steps.

### 9. Generate Output

Create the test case YAML files in the appropriate directory:
- Save to: `.apidog/test-cases/<project>/<filename>.yaml`
- Use proper YAML formatting
- Include helpful comments
- Follow existing conventions

### 10. Provide Summary

Output a summary report:
- Files created/updated
- Endpoints covered
- Next steps (validation, conversion, etc.)

## Operating Principles

### Generation Guidelines
- **Template-first approach**: Always read and use `.apidog/templates/scenario_template.yaml` as the base
- **Exact format matching**: Match template structure, formatting, and conventions exactly
- **Follow existing patterns**: Match style of existing test case files (which also follow template)
- **Logical grouping**: Group related endpoints together
- **Proper sequencing**: Order steps logically (list → create → get → update → delete)
- **Reuse references**: Use testCaseRef for common steps (login, etc.) - follow template format (lines 49-60)
- **Minimal but complete**: Include required fields, use sensible defaults from template
- **Path parameter extraction**: Extract IDs from previous steps when possible (use template's variable syntax)

### File Organization
- **Naming**: `##_<category>_flow.yaml` (e.g., `20_keycloak_management_flow.yaml`)
- **Numbering**: Use next available number (check existing files)
- **Size**: Aim for 5-15 steps per file (adjust based on complexity)
- **Categories**: One file per major category, or group related categories

### Content Quality
- **API Name Matching**: Ensure step names match API names in source Apidog file
- **Authentication**: Include auth for protected endpoints
- **Parameter Handling**: Handle path/query/body parameters appropriately
- **Response Validation**: Add basic assertions for critical fields
- **Comments**: Include helpful comments explaining test purpose

## Context

$ARGUMENTS

## Example Usage

```bash
# Generate test cases for all untested endpoints in front-admin
/apidog.generate front-admin

# Generate test cases for specific category
/apidog.generate front-admin --category "Health"

# Generate test cases for specific priority
/apidog.generate front-admin --priority P0

# Generate and update existing file
/apidog.generate front-admin --update 14_health_check_flow.yaml

# Generate with custom output directory
/apidog.generate front-admin --output .apidog/test-cases/front-admin/new/
```

## Output Format

After generation, provide:

```
## Test Cases Generated

### Files Created
- `.apidog/test-cases/front-admin/20_keycloak_management_flow.yaml` (18 endpoints)
- `.apidog/test-cases/front-admin/21_health_endpoints_flow.yaml` (3 endpoints)

### Files Updated
- `.apidog/test-cases/front-admin/01_authentication_flow.yaml` (+1 endpoint)
- `.apidog/test-cases/front-admin/03_user_management_flow.yaml` (+7 endpoints)

### Summary
- Total endpoints covered: 29
- Files created: 2
- Files updated: 2
- Remaining untested: 7

### Next Steps
1. Review generated test cases
2. Validate YAML syntax: `node validate_scenario.js <file>`
3. Convert to Apidog format: `npm run convert <file>`
4. Merge into collection: `npm run merge front-admin`
5. Re-run analysis: `/apidog.analyze front-admin`
```

## Notes

- **Template-based generation**: All YAML structure is read from `.apidog/templates/scenario_template.yaml`
- **Exact format matching**: Generated files must match template structure exactly
- **API name matching**: Step names must match exactly with source Apidog file
- **Parameter handling**: Follow template patterns for path/query/header/cookie overrides
- **Authentication**: Use template's auth structure format
- **Request bodies**: Follow template's `request_body_override` format
- **Path parameters**: Extract from previous steps when possible (follow template variable syntax)
- **Review required**: Users should review and customize generated test cases as needed
- **Validation ready**: Generated files are ready for validation and conversion


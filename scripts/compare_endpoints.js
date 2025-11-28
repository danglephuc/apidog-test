#!/usr/bin/env node
/**
 * Compare OpenAPI spec endpoints with test cases
 * Analyzes API coverage by comparing OpenAPI JSON with test case YAML files
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Parse command line arguments
const args = process.argv.slice(2);
const openApiPath = args[0];
const testCaseDir = args[1];
const apidogPath = args[2] || null;
const outputPath = args[3] || null;

if (!openApiPath || !testCaseDir) {
  console.error('Usage: node .apidog/scripts/compare_endpoints.js <openapi.json> <test-cases-dir> [apidog.json] [output.json]');
  console.error('');
  console.error('Example:');
  console.error('  node .apidog/scripts/compare_endpoints.js .apidog/openapi/Front Admin.openapi.json .apidog/test-cases/front-admin/');
  console.error('  node .apidog/scripts/compare_endpoints.js .apidog/openapi/Front Admin.openapi.json .apidog/test-cases/front-admin/ .apidog/collections/input/Front Admin API.apidog.json');
  process.exit(1);
}

// Read OpenAPI spec endpoints
let openApiSpec;
try {
  openApiSpec = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
} catch (e) {
  console.error(`Error reading OpenAPI spec: ${e.message}`);
  process.exit(1);
}

const openApiEndpoints = new Map();
Object.keys(openApiSpec.paths || {}).forEach(path => {
  Object.keys(openApiSpec.paths[path]).forEach(method => {
    if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
      const op = openApiSpec.paths[path][method];
      const key = `${method.toUpperCase()} ${path}`;
      openApiEndpoints.set(key, {
        path,
        method: method.toUpperCase(),
        operationId: op.operationId || '',
        tags: op.tags || [],
        summary: op.summary || ''
      });
    }
  });
});

// Read Apidog file to extract scenario endpoints (if provided)
const scenarioEndpointsMap = {};
const apiNameToEndpoint = new Map();

if (apidogPath && fs.existsSync(apidogPath)) {
  try {
    const apidogFile = JSON.parse(fs.readFileSync(apidogPath, 'utf8'));

    // Build scenario endpoints map
    function extractScenarioEndpoints(items) {
      items.forEach(item => {
        if (item.name && item.steps) {
          const scenarioName = item.name;
          scenarioEndpointsMap[scenarioName] = [];
          item.steps.forEach(step => {
            if (step.httpApiCase) {
              const method = (step.httpApiCase.method || 'GET').toUpperCase();
              const url = step.httpApiCase.path || '';
              if (url) {
                scenarioEndpointsMap[scenarioName].push({ method, path: url });
              }
            }
          });
        }
        if (item.children && Array.isArray(item.children)) {
          extractScenarioEndpoints(item.children);
        }
        if (item.items && Array.isArray(item.items)) {
          extractScenarioEndpoints(item.items);
        }
      });
    }

    if (apidogFile.scenarios) {
      apidogFile.scenarios.forEach(scenario => {
        if (scenario.children) {
          extractScenarioEndpoints(scenario.children);
        }
        if (scenario.items) {
          extractScenarioEndpoints(scenario.items);
        }
      });
    }

    // Build API name to endpoint map
    function buildApiNameMap(items) {
      items.forEach(item => {
        if (item.api) {
          const method = (item.api.method || 'GET').toUpperCase();
          const apiPath = item.api.path || '';
          if (apiPath && item.name) {
            apiNameToEndpoint.set(item.name, { method, path: apiPath });
          }
        }
        if (item.items && Array.isArray(item.items)) {
          buildApiNameMap(item.items);
        }
      });
    }

    if (apidogFile.apiCollection) {
      apidogFile.apiCollection.forEach(collection => {
        if (collection.items) {
          buildApiNameMap(collection.items);
        }
      });
    }
  } catch (e) {
    console.error(`Warning: Error reading Apidog file: ${e.message}`);
  }
}

// Extract tested endpoints from test case YAML files
const testedEndpoints = new Set();
let testFiles = [];

if (!fs.existsSync(testCaseDir)) {
  console.error(`Test cases directory not found: ${testCaseDir}`);
  process.exit(1);
}

try {
  testFiles = fs.readdirSync(testCaseDir).filter(f => f.endsWith('.yaml') && !f.includes('README'));
} catch (e) {
  console.error(`Error reading test cases directory: ${e.message}`);
  process.exit(1);
}

testFiles.forEach(file => {
  try {
    const content = fs.readFileSync(path.join(testCaseDir, file), 'utf8');
    const doc = yaml.load(content);
    if (doc.steps) {
      doc.steps.forEach(step => {
        // Check if step references a scenario
        if (step.ref_name && scenarioEndpointsMap[step.ref_name]) {
          scenarioEndpointsMap[step.ref_name].forEach(ep => {
            testedEndpoints.add(`${ep.method} ${ep.path}`);
          });
        }
        // Check if step has direct path
        if (step.path) {
          const method = (step.method || 'GET').toUpperCase();
          testedEndpoints.add(`${method} ${step.path}`);
        }
        // Check if step name matches an API name
        if (step.name && apiNameToEndpoint.has(step.name)) {
          const ep = apiNameToEndpoint.get(step.name);
          testedEndpoints.add(`${ep.method} ${ep.path}`);
        }
      });
    }
  } catch (e) {
    console.error(`Error reading ${file}: ${e.message}`);
  }
});

// Compare
const allOpenApiEndpoints = Array.from(openApiEndpoints.keys());
const allTestedEndpoints = Array.from(testedEndpoints);
const untestedEndpoints = allOpenApiEndpoints.filter(ep => !testedEndpoints.has(ep));
const testedEndpointsList = allOpenApiEndpoints.filter(ep => testedEndpoints.has(ep));

// Group by tags
const untestedByTag = {};
const testedByTag = {};

untestedEndpoints.forEach(key => {
  const endpoint = openApiEndpoints.get(key);
  const tag = endpoint.tags[0] || 'Other';
  if (!untestedByTag[tag]) {
    untestedByTag[tag] = [];
  }
  untestedByTag[tag].push({
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary,
    operationId: endpoint.operationId
  });
});

testedEndpointsList.forEach(key => {
  const endpoint = openApiEndpoints.get(key);
  const tag = endpoint.tags[0] || 'Other';
  if (!testedByTag[tag]) {
    testedByTag[tag] = [];
  }
  testedByTag[tag].push({
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary,
    operationId: endpoint.operationId
  });
});

// Generate report
const report = {
  summary: {
    total: allOpenApiEndpoints.length,
    tested: allTestedEndpoints.length,
    untested: untestedEndpoints.length,
    coverage: ((allTestedEndpoints.length / allOpenApiEndpoints.length) * 100).toFixed(2) + '%',
    testFiles: testFiles.length
  },
  tested: testedByTag,
  untested: untestedByTag,
  metadata: {
    openApiPath: path.resolve(openApiPath),
    testCaseDir: path.resolve(testCaseDir),
    apidogPath: apidogPath ? path.resolve(apidogPath) : null,
    analyzedAt: new Date().toISOString()
  }
};

// Output results
if (outputPath) {
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`Report saved to: ${outputPath}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}


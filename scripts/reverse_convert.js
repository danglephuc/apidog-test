#!/usr/bin/env node

/**
 * 🔄 Apidog Reverse Converter (Node.js)
 * 
 * Converts Apidog JSON test cases back to human-readable YAML scenario format.
 * Useful when updates are made directly in Apidog and need to be synced back to YAML.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class ApidogReverseConverter {
    constructor() {
        this.sourceApidog = null;
        this.testCases = new Map();  // Key: test case ID, Value: test case item
        this.testCasesByName = new Map();  // Key: test case name, Value: test case item
    }

    /**
     * Load and index the source Apidog JSON file
     */
    loadSourceApidog(filePath) {
        console.log(`[INFO] Loading source Apidog file: ${filePath}`);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`Source Apidog file not found: ${filePath}`);
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        this.sourceApidog = JSON.parse(content);

        // Index test cases by ID and name
        if (this.sourceApidog.apiTestCaseCollection) {
            this.indexTestCases(this.sourceApidog.apiTestCaseCollection);
        }

        console.log(`[INFO] Indexed ${this.testCases.size} test cases`);
    }

    /**
     * Index test cases by ID and name
     */
    indexTestCases(collections) {
        for (const collection of collections) {
            // Index items in this collection
            if (collection.items) {
                for (const item of collection.items) {
                    if (item.id) {
                        this.testCases.set(item.id, item);
                    }
                    if (item.name) {
                        this.testCasesByName.set(item.name, item);
                    }
                }
            }

            // Recursively index children
            if (collection.children) {
                this.indexTestCases(collection.children);
            }
        }
    }

    /**
     * Convert postProcessors to assertions
     */
    convertPostProcessorsToAssertions(postProcessors) {
        if (!postProcessors || postProcessors.length === 0) {
            return [];
        }

        const assertions = [];
        for (const processor of postProcessors) {
            if (processor.type === 'assertion' && processor.data) {
                const data = processor.data;
                assertions.push({
                    name: data.name || '',
                    subject: data.subject || 'responseJson',
                    comparison: data.comparison || 'equal',
                    value: data.value || '',
                    path: data.path || data.extractSettings?.expression || ''
                });
            }
        }

        return assertions;
    }

    /**
     * Convert postProcessors to custom postProcessors format
     */
    convertPostProcessors(postProcessors) {
        if (!postProcessors || postProcessors.length === 0) {
            return [];
        }

        const converted = [];
        for (const processor of postProcessors) {
            if (processor.type === 'assertion') {
                // Skip assertions - they're handled separately
                continue;
            }

            const convertedProcessor = {
                type: processor.type || 'unknown',
                enable: processor.enable !== undefined ? processor.enable : true,
                default_enable: processor.defaultEnable !== undefined ? processor.defaultEnable : false
            };

            if (processor.type === 'customScript' && typeof processor.data === 'string') {
                // Normalize line endings from \r\n to \n for YAML
                convertedProcessor.data = processor.data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            } else {
                convertedProcessor.data = processor.data || {};
            }

            converted.push(convertedProcessor);
        }

        return converted;
    }

    /**
     * Convert preProcessors
     */
    convertPreProcessors(preProcessors) {
        if (!preProcessors || preProcessors.length === 0) {
            return [];
        }

        const converted = [];
        for (const processor of preProcessors) {
            // Skip placeholder and inheritProcessors
            if (processor.type === 'placeholder' || processor.type === 'inheritProcessors') {
                continue;
            }

            const convertedProcessor = {
                type: processor.type || 'unknown',
                enable: processor.enable !== undefined ? processor.enable : true,
                default_enable: processor.defaultEnable !== undefined ? processor.defaultEnable : false
            };

            if (processor.type === 'customScript' && typeof processor.data === 'string') {
                // Normalize line endings from \r\n to \n for YAML
                convertedProcessor.data = processor.data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            } else {
                convertedProcessor.data = processor.data || {};
            }

            converted.push(convertedProcessor);
        }

        return converted;
    }

    /**
     * Extract parameter overrides from Apidog step
     */
    extractParameterOverrides(parameters, originalParameters) {
        if (!parameters || !Array.isArray(parameters)) {
            return [];
        }

        const overrides = [];
        const originalMap = new Map();
        if (originalParameters && Array.isArray(originalParameters)) {
            originalParameters.forEach(p => {
                if (p.name) {
                    originalMap.set(p.name, p);
                }
            });
        }

        for (const param of parameters) {
            if (!param.enable && !param.value) {
                // Skip disabled parameters without values
                continue;
            }

            const original = originalMap.get(param.name);
            const hasOverride = original && (
                param.value !== original.value ||
                param.enable !== original.enable
            );

            // Include if it's an override or if it's a custom parameter (not in original)
            if (hasOverride || !original) {
                overrides.push({
                    name: param.name,
                    value: param.value || ''
                });
            }
        }

        return overrides;
    }

    /**
     * Extract request body override
     */
    extractRequestBodyOverride(httpApiCase) {
        if (!httpApiCase.requestBody) {
            return null;
        }

        const requestBody = httpApiCase.requestBody;
        
        // Check if there's actual data to override
        if (requestBody.type === 'none' || !requestBody.data) {
            return null;
        }

        // For multipart/form-data, check if there are parameter overrides
        if (requestBody.type === 'multipart/form-data' && requestBody.parameters) {
            const formDataOverrides = [];
            for (const param of requestBody.parameters) {
                if (param.enable && param.value !== undefined) {
                    formDataOverrides.push({
                        name: param.name,
                        type: param.type || 'string',
                        value: param.value,
                        enable: param.enable !== undefined ? param.enable : true
                    });
                }
            }
            if (formDataOverrides.length > 0) {
                return {
                    type: 'form_data',
                    form_data_override: formDataOverrides
                };
            }
        }

        // For JSON and other types, return data override
        if (requestBody.data && requestBody.data.trim()) {
            return {
                type: requestBody.type || 'application/json',
                data: requestBody.data.trim()
            };
        }

        return null;
    }

    /**
     * Convert HTTP step to YAML format
     */
    convertHttpStep(step, apiDefinitions) {
        const stepNumber = step.number || 1;
        const stepName = step.name || `Step ${stepNumber}`;
        const httpApiCase = step.httpApiCase;

        if (!httpApiCase) {
            console.warn(`[WARNING] Step ${stepNumber} has type "http" but no httpApiCase`);
            return null;
        }

        const yamlStep = {
            number: stepNumber,
            name: stepName,
            type: 'http'
        };

        // Add folder path if API is found in a specific folder
        // (This would require additional logic to track folder paths)

        // Add path/method if needed for disambiguation
        if (httpApiCase.path) {
            yamlStep.path = httpApiCase.path;
        }
        if (httpApiCase.method) {
            yamlStep.method = httpApiCase.method.toUpperCase();
        }

        // Convert auth
        if (httpApiCase.auth) {
            if (httpApiCase.auth.type === 'bearer' && httpApiCase.auth.bearer) {
                yamlStep.auth = {
                    type: 'bearer',
                    token: httpApiCase.auth.bearer.token || ''
                };
            } else if (httpApiCase.auth.type) {
                yamlStep.auth = httpApiCase.auth;
            }
        }

        // Extract request body override
        const requestBodyOverride = this.extractRequestBodyOverride(httpApiCase);
        if (requestBodyOverride) {
            if (requestBodyOverride.type === 'form_data') {
                yamlStep.request_form_data_override = requestBodyOverride.form_data_override;
            } else {
                yamlStep.request_body_override = {
                    type: requestBodyOverride.type,
                    data: requestBodyOverride.data
                };
            }
        }

        // Extract parameter overrides
        // Note: We need the original API definition to compare, but for now we'll include all enabled parameters
        if (httpApiCase.parameters) {
            // Query parameters
            if (httpApiCase.parameters.query && httpApiCase.parameters.query.length > 0) {
                const queryOverrides = this.extractParameterOverrides(
                    httpApiCase.parameters.query,
                    null  // Original parameters would come from API definition
                );
                if (queryOverrides.length > 0) {
                    yamlStep.query_params_override = queryOverrides;
                }
            }

            // Path parameters
            if (httpApiCase.parameters.path && httpApiCase.parameters.path.length > 0) {
                const pathOverrides = this.extractParameterOverrides(
                    httpApiCase.parameters.path,
                    null
                );
                if (pathOverrides.length > 0) {
                    yamlStep.path_params_override = pathOverrides;
                }
            }

            // Header parameters
            if (httpApiCase.parameters.header && httpApiCase.parameters.header.length > 0) {
                const headerOverrides = this.extractParameterOverrides(
                    httpApiCase.parameters.header,
                    null
                );
                if (headerOverrides.length > 0) {
                    yamlStep.header_params_override = headerOverrides;
                }
            }

            // Cookie parameters
            if (httpApiCase.parameters.cookie && httpApiCase.parameters.cookie.length > 0) {
                const cookieOverrides = this.extractParameterOverrides(
                    httpApiCase.parameters.cookie,
                    null
                );
                if (cookieOverrides.length > 0) {
                    yamlStep.cookie_params_override = cookieOverrides;
                }
            }
        }

        // Convert preProcessors
        if (httpApiCase.preProcessors && httpApiCase.preProcessors.length > 0) {
            const preProcessors = this.convertPreProcessors(httpApiCase.preProcessors);
            if (preProcessors.length > 0) {
                yamlStep.pre_processors = preProcessors;
            }
        }

        // Convert postProcessors to assertions and custom postProcessors
        if (httpApiCase.postProcessors && httpApiCase.postProcessors.length > 0) {
            const assertions = this.convertPostProcessorsToAssertions(httpApiCase.postProcessors);
            if (assertions.length > 0) {
                yamlStep.assertions = assertions;
            }

            const postProcessors = this.convertPostProcessors(httpApiCase.postProcessors);
            if (postProcessors.length > 0) {
                yamlStep.post_processors = postProcessors;
            }
        }

        // Check if response validation is disabled (responseId === 0)
        if (httpApiCase.responseId === 0 || httpApiCase.responseId === '0') {
            yamlStep.disable_response_validation = true;
        }

        return yamlStep;
    }

    /**
     * Convert testCaseRef step to YAML format
     */
    convertTestCaseRefStep(step) {
        const stepNumber = step.number || 1;
        const stepName = step.name || `Step ${stepNumber}`;
        const relatedId = step.relatedId;

        const yamlStep = {
            number: stepNumber,
            type: 'testCaseRef',
            name: stepName
        };

        // Try to find test case by ID
        if (relatedId) {
            const testCase = this.testCases.get(String(relatedId)) || this.testCases.get(parseInt(relatedId));
            if (testCase && testCase.name) {
                yamlStep.ref_name = testCase.name;
            } else {
                yamlStep.ref_id = relatedId;
            }
        }

        if (step.disable !== undefined) {
            yamlStep.disable = step.disable;
        }

        if (step.parameters && Object.keys(step.parameters).length > 0) {
            yamlStep.parameters = step.parameters;
        }

        return yamlStep;
    }

    /**
     * Convert delay step to YAML format
     */
    convertDelayStep(step) {
        const stepNumber = step.number || 1;
        const timeout = step.parameters?.timeout || 1000;

        return {
            number: stepNumber,
            type: 'delay',
            timeout: timeout
        };
    }

    /**
     * Convert script step to YAML format
     */
    convertScriptStep(step) {
        const stepNumber = step.number || 1;
        const stepName = step.name || '';
        const scriptData = step.parameters?.data || '';

        const yamlStep = {
            number: stepNumber,
            type: 'script',
            data: scriptData.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        };

        if (stepName) {
            yamlStep.name = stepName;
        }

        if (step.parameters) {
            if (step.parameters.enable !== undefined) {
                yamlStep.enable = step.parameters.enable;
            }
            if (step.parameters.defaultEnable !== undefined) {
                yamlStep.default_enable = step.parameters.defaultEnable;
            }
        }

        if (step.disable !== undefined) {
            yamlStep.disable = step.disable;
        }

        return yamlStep;
    }

    /**
     * Convert IF step to YAML format
     */
    convertIfStep(step) {
        const stepNumber = step.number || 1;
        const parameters = step.parameters || {};

        const yamlStep = {
            number: stepNumber,
            type: 'if',
            condition: {
                variable: parameters.keyVariable || '',
                operator: parameters.operator || 'equal',
                value: parameters.valueVariable || ''
            }
        };

        // Convert children
        if (step.children && Array.isArray(step.children)) {
            yamlStep.children = [];
            for (const child of step.children) {
                const childType = child.type;
                let convertedChild = null;

                if (childType === 'http') {
                    convertedChild = this.convertHttpStep(child, null);
                } else if (childType === 'testCaseRef') {
                    convertedChild = this.convertTestCaseRefStep(child);
                } else if (childType === 'delay') {
                    convertedChild = this.convertDelayStep(child);
                } else if (childType === 'script') {
                    convertedChild = this.convertScriptStep(child);
                } else if (childType === 'if') {
                    convertedChild = this.convertIfStep(child);
                }

                if (convertedChild) {
                    yamlStep.children.push(convertedChild);
                }
            }
        }

        return yamlStep;
    }

    /**
     * Convert datasets
     */
    convertDatasets(apiTestDataSets) {
        if (!apiTestDataSets || apiTestDataSets.length === 0) {
            return [];
        }

        const datasets = [];
        for (const dataset of apiTestDataSets) {
            const yamlDataset = {
                name: dataset.name || `Data ${datasets.length + 1}`
            };

            // Include IDs if present (for sync consistency)
            if (dataset.id) {
                yamlDataset.id = dataset.id;
            }

            // Extract data from apiTestDataList
            if (dataset.apiTestDataList && dataset.apiTestDataList.length > 0) {
                const dataList = dataset.apiTestDataList[0];
                if (dataList.id) {
                    yamlDataset.data_list_id = dataList.id;
                }
                if (dataList.data) {
                    yamlDataset.data = dataList.data.trim();
                }
            }

            datasets.push(yamlDataset);
        }

        return datasets;
    }

    /**
     * Convert Apidog JSON test case to YAML format
     */
    convert(testCase, sourceApidogPath) {
        const yamlData = {
            name: testCase.name || 'Test Scenario',
            description: testCase.description || '',
            priority: testCase.priority || 2,
            tags: testCase.tags || []
        };

        // Add source Apidog path (relative to .apidog/collections/input/)
        if (sourceApidogPath) {
            yamlData.source_apidog = sourceApidogPath;
        }

        // Convert options
        if (testCase.options) {
            yamlData.options = {
                environment_id: testCase.options.environmentId || 0,
                iteration_count: testCase.options.iterationCount || 1,
                thread_count: testCase.options.threadCount || 1,
                on_error: testCase.options.onError || 'ignore',
                delay_item: testCase.options.delayItem || 0,
                save_report_detail: testCase.options.saveReportDetail || 'all'
            };
        }

        // Convert datasets
        if (testCase.apiTestDataSets) {
            yamlData.datasets = this.convertDatasets(testCase.apiTestDataSets);
        } else {
            yamlData.datasets = [];
        }

        // Convert steps
        yamlData.steps = [];
        if (testCase.steps && Array.isArray(testCase.steps)) {
            for (const step of testCase.steps) {
                const stepType = step.type;
                let convertedStep = null;

                if (stepType === 'http') {
                    convertedStep = this.convertHttpStep(step, null);
                } else if (stepType === 'testCaseRef') {
                    convertedStep = this.convertTestCaseRefStep(step);
                } else if (stepType === 'delay') {
                    convertedStep = this.convertDelayStep(step);
                } else if (stepType === 'script') {
                    convertedStep = this.convertScriptStep(step);
                } else if (stepType === 'if') {
                    convertedStep = this.convertIfStep(step);
                }

                if (convertedStep) {
                    yamlData.steps.push(convertedStep);
                }
            }
        }

        return yamlData;
    }
}

/**
 * Main entry point
 */
function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log('Usage: node .apidog/scripts/reverse_convert.js <input.json> [output.yaml] [source_apidog.json]');
        console.log('\nExample:');
        console.log('  node .apidog/scripts/reverse_convert.js test_case.json');
        console.log('  node .apidog/scripts/reverse_convert.js test_case.json output.yaml');
        console.log('  node .apidog/scripts/reverse_convert.js test_case.json output.yaml ".apidog/collections/input/Front Admin API.apidog.json"');
        console.log('\nDefault output: Same directory as input file with .yaml extension');
        process.exit(1);
    }

    const inputFile = args[0];
    let outputFile = args[1];
    const sourceApidogFile = args[2];

    // Determine output file
    if (!outputFile) {
        const baseName = path.basename(inputFile, path.extname(inputFile));
        const inputDir = path.dirname(inputFile);
        outputFile = path.join(inputDir, `${baseName}.yaml`);
    }

    // Determine source Apidog file path for YAML
    let sourceApidogPath = null;
    if (sourceApidogFile) {
        // Make path relative to .apidog/collections/input/ if possible
        const normalizedPath = path.normalize(sourceApidogFile);
        if (normalizedPath.includes('.apidog/collections/input/')) {
            const parts = normalizedPath.split('.apidog/collections/input/');
            sourceApidogPath = `.apidog/collections/input/${parts[parts.length - 1]}`;
        } else {
            sourceApidogPath = sourceApidogFile;
        }
    }

    // Check if input file exists
    if (!fs.existsSync(inputFile)) {
        console.error(`[ERROR] Input file not found: ${inputFile}`);
        process.exit(1);
    }

    try {
        // Load JSON
        console.log(`[INFO] Loading JSON file: ${inputFile}`);
        const jsonContent = fs.readFileSync(inputFile, 'utf-8');
        const testCase = JSON.parse(jsonContent);

        // Load source Apidog file if provided (for test case references)
        const converter = new ApidogReverseConverter();
        if (sourceApidogFile && fs.existsSync(sourceApidogFile)) {
            converter.loadSourceApidog(sourceApidogFile);
        } else if (sourceApidogPath) {
            // Try to find source file from relative path
            const possiblePath = path.join(process.cwd(), sourceApidogPath);
            if (fs.existsSync(possiblePath)) {
                converter.loadSourceApidog(possiblePath);
            }
        }

        // Convert to YAML
        console.log('[INFO] Converting to YAML format...');
        const yamlData = converter.convert(testCase, sourceApidogPath);

        // Ensure output directory exists
        const outputDir = path.dirname(outputFile);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Save YAML
        console.log(`[INFO] Saving YAML file: ${outputFile}`);
        const yamlContent = yaml.dump(yamlData, {
            indent: 2,
            lineWidth: -1,
            noRefs: true,
            quotingType: '"',
            forceQuotes: false
        });

        fs.writeFileSync(outputFile, yamlContent, 'utf-8');

        console.log('\n[SUCCESS] ✅ Reverse conversion completed!');
        console.log(`   Input:  ${inputFile}`);
        console.log(`   Output: ${outputFile}`);
        console.log(`\n📝 Review and update the YAML file as needed`);

    } catch (error) {
        if (error.name === 'SyntaxError') {
            console.error(`[ERROR] JSON parsing error: ${error.message}`);
        } else {
            console.error(`[ERROR] ${error.message}`);
            console.error(error.stack);
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { ApidogReverseConverter };


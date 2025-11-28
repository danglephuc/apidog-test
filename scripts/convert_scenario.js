#!/usr/bin/env node

/**
 * 📝 Apidog Scenario Converter (Node.js)
 * 
 * Converts human-readable YAML test scenarios to Apidog JSON format.
 * Looks up API definitions from the source Apidog file by name.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class ApidogConverter {
    constructor() {
        this.nextId = 10000000;
        this.apiDefinitions = new Map();  // Key: API name, Value: API item or array of items
        this.apiByPath = new Map();       // Key: "folder/path/name", Value: API item
        this.sourceApidog = null;
    }

    generateId() {
        return ++this.nextId;
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

        // Index API definitions by name
        if (this.sourceApidog.apiCollection) {
            this.indexApiCollection(this.sourceApidog.apiCollection);
        }

        // Index test cases by name and ID
        this.testCases = new Map();  // Key: test case name, Value: test case item
        this.testCasesById = new Map();  // Key: test case ID, Value: test case item
        if (this.sourceApidog.apiTestCaseCollection) {
            this.indexTestCases(this.sourceApidog.apiTestCaseCollection);
        }

        console.log(`[INFO] Indexed ${this.apiDefinitions.size} API definitions`);
        console.log(`[INFO] Indexed ${this.testCases.size} test cases`);
    }

    /**
     * Index test cases by name and ID
     */
    indexTestCases(collections) {
        for (const collection of collections) {
            // Index items in this collection
            if (collection.items) {
                for (const item of collection.items) {
                    if (item.name && item.steps) {
                        // Index by name
                        this.testCases.set(item.name, item);
                        // Index by ID if available
                        if (item.id) {
                            this.testCasesById.set(item.id, item);
                        }
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
     * Recursively index API collections
     */
    indexApiCollection(collections, parentPath = '') {
        for (const collection of collections) {
            const currentPath = parentPath ? `${parentPath}/${collection.name}` : collection.name;
            
            // Index items in this collection
            if (collection.items) {
                for (const item of collection.items) {
                    if (item.name && item.api) {
                        const fullPath = `${currentPath}/${item.name}`;
                        
                        // Store by full path (unique)
                        this.apiByPath.set(fullPath, item);
                        
                        // Store by name only (might have duplicates)
                        const existing = this.apiDefinitions.get(item.name);
                        if (existing) {
                            // Multiple APIs with same name - convert to array
                            if (Array.isArray(existing)) {
                                existing.push({ item, path: fullPath });
                            } else {
                                this.apiDefinitions.set(item.name, [
                                    { item: existing, path: this.findPathForItem(existing) },
                                    { item, path: fullPath }
                                ]);
                            }
                        } else {
                            // Store the full item (which contains the api object)
                            this.apiDefinitions.set(item.name, item);
                        }
                    } else if (item.items) {
                        // This item is a nested collection
                        this.indexApiCollection([item], currentPath);
                    }
                }
            }

            // Recursively index children
            if (collection.children) {
                this.indexApiCollection(collection.children, currentPath);
            }
        }
    }
    
    /**
     * Find path for an item (helper for duplicate detection)
     */
    findPathForItem(searchItem) {
        for (const [path, item] of this.apiByPath.entries()) {
            if (item === searchItem) {
                return path;
            }
        }
        return 'Unknown';
    }

    /**
     * Find API by HTTP method and path (prefer exact match)
     */
    findApiByMethodAndPath(method, apiPath) {
        if (!apiPath) return null;
        const desiredMethod = method ? String(method).toLowerCase() : null;
        for (const item of this.apiByPath.values()) {
            if (!item || !item.api) continue;
            const samePath = item.api.path === apiPath;
            const sameMethod = desiredMethod ? (String(item.api.method || '').toLowerCase() === desiredMethod) : true;
            if (samePath && sameMethod) {
                return item;
            }
        }
        return null;
    }

    /**
     * Find API by name, disambiguating by expected path when duplicates exist
     */
    findApiByNameAndPath(name, expectedPath, folderPath = null) {
        // If folder path is specified, try to find by folder first
        if (folderPath) {
            const apiByFolder = this.findApiByName(name, folderPath);
            
            // If found and expectedPath is provided, verify it matches
            if (apiByFolder && apiByFolder.api) {
                if (expectedPath && apiByFolder.api.path !== expectedPath) {
                    // Path doesn't match, try to find another API with same name in folder but different path
                    console.warn(`[WARNING] API found in folder "${folderPath}" but path doesn't match. Expected: ${expectedPath}, Found: ${apiByFolder.api.path}`);
                    // Continue to search by path
                } else {
                    return apiByFolder;
                }
            }
        }

        // Try to find by name and path
        const api = this.apiDefinitions.get(name);
        if (!api) {
            console.warn(`[WARNING] API definition not found for: ${name}`);
            return null;
        }

        // If multiple APIs with same name, use path to disambiguate
        if (Array.isArray(api)) {
            if (expectedPath) {
                const match = api.find(entry => {
                    if (!entry.item || !entry.item.api) return false;
                    return entry.item.api.path === expectedPath;
                });
                if (match) {
                    return match.item;
                }
                // If path specified but no match, warn about available paths
                console.warn(`[WARNING] API "${name}" found but path "${expectedPath}" doesn't match. Available paths:`);
                api.forEach((entry, idx) => {
                    if (entry.item && entry.item.api) {
                        console.warn(`  ${idx + 1}. ${entry.item.api.path} (method: ${entry.item.api.method || 'N/A'})`);
                    }
                });
            }
            // fallback to first if no path match
            if (api.length > 0 && api[0].item) {
                return api[0].item;
            }
        }
        return api;
    }

    /**
     * Find API definition by name and optional folder path
     */
    findApiByName(name, folderPath = null) {
        // If folder path is specified, try exact path match first
        if (folderPath) {
            const fullPath = `${folderPath}/${name}`;
            const apiByFullPath = this.apiByPath.get(fullPath);
            if (apiByFullPath) {
                return apiByFullPath;
            }
            
            // Try partial path match (ends with the specified path)
            for (const [path, item] of this.apiByPath.entries()) {
                if (path.endsWith(`/${folderPath}/${name}`)) {
                    return item;
                }
            }
            
            console.warn(`[WARNING] API not found at path: ${fullPath}`);
        }
        
        // Try name-only lookup
        const api = this.apiDefinitions.get(name);
        if (!api) {
            console.warn(`[WARNING] API definition not found for: ${name}`);
            return null;
        }
        
        // Check if there are multiple APIs with same name
        if (Array.isArray(api)) {
            console.warn(`[WARNING] Multiple APIs found with name "${name}":`);
            api.forEach((entry, idx) => {
                if (entry.item && entry.item.api) {
                    console.warn(`  ${idx + 1}. Path: ${entry.item.api.path}, Method: ${entry.item.api.method || 'N/A'}`);
                } else {
                    console.warn(`  ${idx + 1}. ${entry.path || 'Unknown'}`);
                }
            });
            console.warn(`[WARNING] Using first match. Specify "folder" or "path" field to disambiguate.`);
            return api[0].item;
        }
        
        return api;
    }

    /**
     * Convert HTTP step using API definition from source
     */
    convertHttpStep(step, parentModuleId = 936828) {
        const stepNumber = step.number || 1;
        const stepName = step.name || `Step ${stepNumber}`;
        const folderPath = step.folder || null;
        const stepPath = step.path || null;
        const stepMethod = step.method || null;

        // Prefer disambiguation by explicit path/method when provided
        let apiItem = null;
        if (stepPath) {
            apiItem = this.findApiByMethodAndPath(stepMethod, stepPath);
        }
        // Fallback to name (and expected path if duplicates)
        if (!apiItem) {
            apiItem = this.findApiByNameAndPath(stepName, stepPath, folderPath);
        }
        
        if (!apiItem || !apiItem.api) {
            // Create a basic step if API not found
            return this.createBasicHttpStep(step, parentModuleId);
        }

        // Clone the API object
        const api = apiItem.api;
        
        // Check if response validation is disabled
        const disableResponseValidation = step.disable_response_validation !== undefined 
            ? step.disable_response_validation 
            : (step.response_validation === false);
        
        // Get responseId from the first response (usually 200 OK)
        // If response validation is disabled, set responseId to 0
        const responseId = disableResponseValidation 
            ? 0 
            : (api.responses && api.responses.length > 0 
                ? parseInt(api.responses[0].id) 
                : this.generateId());
        
        // Build simplified requestBody for test case (not full API definition)
        let requestBody = {
            parameters: [],
            type: 'none',
            data: '',
            generateMode: "normal"
        };
        
        if (api.requestBody) {
            // Only copy essential fields, not examples, mediaType, etc.
            const baseBody = {
                parameters: api.requestBody.parameters || [],
                type: api.requestBody.type || 'none',
                data: api.requestBody.data || ''
            };
            
            // Add jsonSchema if present and type is application/json
            if (api.requestBody.jsonSchema && baseBody.type === 'application/json') {
                baseBody.jsonSchema = api.requestBody.jsonSchema;
            }
            
            // Always add generateMode at the end
            baseBody.generateMode = "normal";
            
            requestBody = baseBody;
        }
        
        const httpApiCase = {
            id: this.generateId(),
            name: stepName,
            method: api.method || 'get',
            path: api.path || '/',
            auth: api.auth || {},
            type: "http",
            options: {},
            parameters: {
                query: JSON.parse(JSON.stringify(api.parameters?.query || [])),
                header: JSON.parse(JSON.stringify(api.parameters?.header || [])),
                cookie: JSON.parse(JSON.stringify(api.parameters?.cookie || [])),
                path: JSON.parse(JSON.stringify(api.parameters?.path || []))
            },
            responseId: responseId,
            requestBody: requestBody,
            preProcessors: this.convertPreProcessors(step.pre_processors || step.preProcessors || []),
            postProcessors: this.mergePostProcessors(step.assertions || [], step.post_processors || step.postProcessors || []),
            advancedSettings: {
                disabledSystemHeaders: {},
                isDefaultUrlEncoding: 1,
                disableUrlEncoding: false
            },
            commonParameters: {
                query: [],
                body: [],
                header: [],
                cookie: []
            },
            inheritPreProcessors: {},
            inheritPostProcessors: {},
            inheritPreProcessorsSnapshot: [],
            inheritPostProcessorsSnapshot: [],
            moduleId: parentModuleId,
            apiId: api.id ? parseInt(api.id) : undefined
        };
        
        // Override request body data if provided
        if (step.request_body_override && step.request_body_override.data) {
            httpApiCase.requestBody.data = step.request_body_override.data.trim();
            httpApiCase.requestBody.type = step.request_body_override.type || 'application/json';
        }

        // Override form data (multipart/form-data) if provided
        if (step.request_form_data_override && Array.isArray(step.request_form_data_override)) {
            httpApiCase.requestBody.type = 'multipart/form-data';
            
            // Build parameters array for form data
            const formDataParameters = [];
            for (const formField of step.request_form_data_override) {
                const fieldName = formField.name;
                const fieldType = formField.type || 'string';
                const fieldValue = formField.value || '';
                const fieldEnable = formField.enable !== undefined ? formField.enable : true;
                
                // Find existing parameter by name
                const existingParam = httpApiCase.requestBody.parameters.find(
                    p => p.name === fieldName
                );
                
                if (existingParam) {
                    // Update existing parameter
                    existingParam.value = fieldValue;
                    existingParam.enable = fieldEnable;
                    existingParam.type = fieldType;
                } else {
                    // Add new parameter
                    const newParam = {
                        id: `custom_${this.generateId()}`,
                        name: fieldName,
                        required: false,
                        enable: fieldEnable,
                        value: fieldValue,
                        type: fieldType,
                        description: formField.description || ''
                    };
                    
                    // Add schema field to match API definition structure
                    if (fieldType === 'file') {
                        newParam.schema = {
                            type: 'string',
                            format: 'binary',
                            description: formField.description || ''
                        };
                    } else {
                        newParam.schema = {
                            type: 'string',
                            description: formField.description || ''
                        };
                    }
                    
                    formDataParameters.push(newParam);
                }
            }
            
            // Add new parameters if any
            if (formDataParameters.length > 0) {
                httpApiCase.requestBody.parameters.push(...formDataParameters);
            }
            
            // Ensure generateMode is set
            httpApiCase.requestBody.generateMode = "normal";
        }

        // Override query parameters if provided
        if (step.query_params_override && Array.isArray(step.query_params_override)) {
            for (const override of step.query_params_override) {
                const paramName = override.name;
                const paramValue = override.value;
                
                // Skip null or undefined values - remove them from query params
                if (paramValue === null || paramValue === undefined) {
                    // Find and remove existing parameter if it exists
                    const existingParamIndex = httpApiCase.parameters.query.findIndex(p => p.name === paramName);
                    if (existingParamIndex !== -1) {
                        httpApiCase.parameters.query.splice(existingParamIndex, 1);
                        console.log(`[INFO] Removed query parameter "${paramName}" (value was null)`);
                    }
                    continue;
                }
                
                // Find existing parameter by name
                const existingParam = httpApiCase.parameters.query.find(p => p.name === paramName);
                
                if (existingParam) {
                    // Update existing parameter value
                    existingParam.value = paramValue;
                    existingParam.enable = true;
                } else {
                    // Add new parameter if not found
                    httpApiCase.parameters.query.push({
                        id: `custom_${this.generateId()}`,
                        name: paramName,
                        required: false,
                        enable: true,
                        value: paramValue,
                        type: "string",
                        description: ""
                    });
                }
            }
        }

        // Override path parameters if provided
        if (step.path_params_override && Array.isArray(step.path_params_override)) {
            for (const override of step.path_params_override) {
                const paramName = override.name;
                const paramValue = override.value;
                
                // Skip null or undefined values - remove them from path params
                if (paramValue === null || paramValue === undefined) {
                    // Find and remove existing parameter if it exists
                    const existingParamIndex = httpApiCase.parameters.path.findIndex(p => p.name === paramName);
                    if (existingParamIndex !== -1) {
                        httpApiCase.parameters.path.splice(existingParamIndex, 1);
                        console.log(`[INFO] Removed path parameter "${paramName}" (value was null)`);
                    }
                    continue;
                }
                
                // Find existing parameter by name
                const existingParam = httpApiCase.parameters.path.find(p => p.name === paramName);
                
                if (existingParam) {
                    // Update existing parameter value
                    existingParam.value = paramValue;
                    existingParam.enable = true;
                } else {
                    // Add new parameter if not found
                    httpApiCase.parameters.path.push({
                        id: `custom_${this.generateId()}`,
                        name: paramName,
                        required: false,
                        enable: true,
                        value: paramValue,
                        type: "string",
                        description: ""
                    });
                }
            }
        }

        // Override cookie parameters if provided
        if (step.cookie_params_override && Array.isArray(step.cookie_params_override)) {
            for (const override of step.cookie_params_override) {
                const paramName = override.name;
                const paramValue = override.value;
                
                // Skip null or undefined values - remove them from cookie params
                if (paramValue === null || paramValue === undefined) {
                    // Find and remove existing parameter if it exists
                    const existingParamIndex = httpApiCase.parameters.cookie.findIndex(p => p.name === paramName);
                    if (existingParamIndex !== -1) {
                        httpApiCase.parameters.cookie.splice(existingParamIndex, 1);
                        console.log(`[INFO] Removed cookie parameter "${paramName}" (value was null)`);
                    }
                    continue;
                }
                
                // Find existing parameter by name
                const existingParam = httpApiCase.parameters.cookie.find(p => p.name === paramName);
                
                if (existingParam) {
                    // Update existing parameter value
                    existingParam.value = paramValue;
                    existingParam.enable = true;
                } else {
                    // Add new parameter if not found
                    httpApiCase.parameters.cookie.push({
                        id: `custom_${this.generateId()}`,
                        name: paramName,
                        required: false,
                        enable: true,
                        value: paramValue,
                        type: "string",
                        description: "",
                        isDelete: false
                    });
                }
            }
        }

        // Override header parameters if provided
        if (step.header_params_override && Array.isArray(step.header_params_override)) {
            for (const override of step.header_params_override) {
                const paramName = override.name;
                const paramValue = override.value;
                
                // Skip null or undefined values - remove them from header params
                if (paramValue === null || paramValue === undefined) {
                    // Find and remove existing parameter if it exists (case-insensitive match)
                    const existingParamIndex = httpApiCase.parameters.header.findIndex(
                        p => p.name && p.name.toLowerCase() === paramName.toLowerCase()
                    );
                    if (existingParamIndex !== -1) {
                        httpApiCase.parameters.header.splice(existingParamIndex, 1);
                        console.log(`[INFO] Removed header parameter "${paramName}" (value was null)`);
                    }
                    continue;
                }
                
                // Find existing parameter by name (case-insensitive match)
                const existingParam = httpApiCase.parameters.header.find(
                    p => p.name && p.name.toLowerCase() === paramName.toLowerCase()
                );
                
                if (existingParam) {
                    // Update existing parameter value
                    existingParam.value = paramValue;
                    existingParam.enable = true;
                } else {
                    // Add new parameter if not found
                    httpApiCase.parameters.header.push({
                        id: `custom_${this.generateId()}`,
                        name: paramName,
                        required: false,
                        enable: true,
                        value: paramValue,
                        type: "string",
                        description: ""
                    });
                }
            }
        }

        // Override auth if provided
        if (step.auth) {
            // Convert auth to proper Apidog format
            if (step.auth.type === 'bearer') {
                httpApiCase.auth = {
                    type: 'bearer',
                    bearer: {
                        token: step.auth.token || ''
                    }
                };
            } else {
                // For other auth types, use as-is
                httpApiCase.auth = step.auth;
            }
        }

        // Handle user agent (step-level)
        const userAgent = step.user_agent;
        if (userAgent) {
            // Find existing User-Agent header
            const existingUserAgentHeader = httpApiCase.parameters.header.find(
                h => h.name && h.name.toLowerCase() === 'user-agent'
            );
            
            if (existingUserAgentHeader) {
                // Update existing User-Agent header
                existingUserAgentHeader.value = userAgent;
                existingUserAgentHeader.enable = true;
            } else {
                // Add new User-Agent header
                httpApiCase.parameters.header.push({
                    id: `custom_${this.generateId()}`,
                    name: 'User-Agent',
                    required: false,
                    enable: true,
                    value: userAgent,
                    type: 'string',
                    description: ''
                });
            }
        }

        // Build step wrapper
        return {
            name: stepName,
            number: stepNumber,
            type: "http",
            bind: false,
            disable: false,
            bindType: "API",
            bindId: api.id ? parseInt(api.id) : 0,
            syncMode: "MANUAL",
            httpApiCase
        };
    }

    /**
     * Recursively find a step by number in steps array (including nested children)
     */
    findStepByNumber(steps, targetNumber) {
        if (!steps || !Array.isArray(steps)) {
            return null;
        }

        for (const step of steps) {
            // Check if this step matches the target number
            if (step.number === targetNumber) {
                return step;
            }

            // Recursively search in children (for IF conditions, etc.)
            if (step.children && Array.isArray(step.children)) {
                const found = this.findStepByNumber(step.children, targetNumber);
                if (found) {
                    return found;
                }
            }
        }

        return null;
    }

    /**
     * Recursively collect all step numbers from steps array (including nested children)
     */
    collectAllStepNumbers(steps, numbers = []) {
        if (!steps || !Array.isArray(steps)) {
            return numbers;
        }

        for (const step of steps) {
            if (step.number !== undefined && step.number !== null) {
                numbers.push(step.number);
            }

            // Recursively collect from children
            if (step.children && Array.isArray(step.children)) {
                this.collectAllStepNumbers(step.children, numbers);
            }
        }

        return numbers;
    }

    /**
     * Convert linked test case steps
     */
    convertLinkedSteps(step) {
        const linkTo = step.link_to;
        const linkStepNumber = step.link_step || step.link_step_number;
        
        if (!linkTo) {
            console.log(`[WARN] Step ${step.number} has type "link" but no "link_to" specified`);
            return [];
        }

        // Find the referenced test case
        const testCase = this.testCases.get(linkTo);
        
        if (!testCase) {
            console.log(`[ERROR] Test case "${linkTo}" not found in source Apidog file`);
            console.log(`[INFO] Available test cases: ${Array.from(this.testCases.keys()).join(', ')}`);
            return [];
        }

        // If link_step_number is specified, copy only that specific step
        if (linkStepNumber !== undefined && linkStepNumber !== null) {
            // Recursively find the step with the specified number (including nested children)
            const linkedStep = this.findStepByNumber(testCase.steps, linkStepNumber);
            
            if (!linkedStep) {
                // Collect all available step numbers (including nested) for better error message
                const allStepNumbers = this.collectAllStepNumbers(testCase.steps);
                const uniqueNumbers = [...new Set(allStepNumbers)].sort((a, b) => a - b);
                console.log(`[ERROR] Step ${linkStepNumber} not found in test case "${linkTo}"`);
                console.log(`[INFO] Available step numbers (including nested): ${uniqueNumbers.join(', ')}`);
                return [];
            }

            // Create a deep copy of the specific step
            const copiedStep = JSON.parse(JSON.stringify(linkedStep));
            // Update the step number to match the current step's number
            copiedStep.number = step.number || copiedStep.number;

            // Apply overrides from the link step if the copied step is an HTTP step
            if (copiedStep.type === 'http' && copiedStep.httpApiCase && step.query_params_override && Array.isArray(step.query_params_override)) {
                for (const override of step.query_params_override) {
                    const paramName = override.name;
                    const paramValue = override.value;

                    if (paramValue === null || paramValue === undefined) {
                        const idx = copiedStep.httpApiCase.parameters.query.findIndex(p => p.name === paramName);
                        if (idx !== -1) {
                            copiedStep.httpApiCase.parameters.query.splice(idx, 1);
                            console.log(`[INFO] Removed query parameter "${paramName}" from linked step (value was null)`);
                        }
                        continue;
                    }

                    const existingParam = copiedStep.httpApiCase.parameters.query.find(p => p.name === paramName);
                    if (existingParam) {
                        existingParam.value = paramValue;
                        existingParam.enable = true;
                    } else {
                        copiedStep.httpApiCase.parameters.query.push({
                            id: `custom_${this.generateId()}`,
                            name: paramName,
                            required: false,
                            enable: true,
                            value: paramValue,
                            type: "string",
                            description: ""
                        });
                    }
                }
            }
            // Apply overrides for customHttp linked steps
            if (copiedStep.type === 'customHttp' && copiedStep.customHttpRequest && step.query_params_override && Array.isArray(step.query_params_override)) {
                // Ensure parameters object exists
                if (!copiedStep.customHttpRequest.parameters) {
                    copiedStep.customHttpRequest.parameters = { query: [], header: [], cookie: [], path: [] };
                }
                if (!Array.isArray(copiedStep.customHttpRequest.parameters.query)) {
                    copiedStep.customHttpRequest.parameters.query = [];
                }
                for (const override of step.query_params_override) {
                    const paramName = override.name;
                    const paramValue = override.value;

                    if (paramValue === null || paramValue === undefined) {
                        const idx = copiedStep.customHttpRequest.parameters.query.findIndex(p => p.name === paramName);
                        if (idx !== -1) {
                            copiedStep.customHttpRequest.parameters.query.splice(idx, 1);
                            console.log(`[INFO] Removed query parameter "${paramName}" from linked customHttp step (value was null)`);
                        }
                        continue;
                    }

                    const existingParam = copiedStep.customHttpRequest.parameters.query.find(p => p.name === paramName);
                    if (existingParam) {
                        existingParam.value = paramValue;
                        existingParam.enable = true;
                        // Ensure sampleValue mirrors value for Apidog editor display
                        existingParam.sampleValue = paramValue;
                    } else {
                        copiedStep.customHttpRequest.parameters.query.push({
                            name: paramName,
                            value: paramValue,
                            sampleValue: paramValue,
                            enable: true
                        });
                    }
                }
                // Ensure all query params have sampleValue synced with value
                copiedStep.customHttpRequest.parameters.query.forEach(p => {
                    if (p && Object.prototype.hasOwnProperty.call(p, 'value')) {
                        p.sampleValue = p.value;
                    }
                });
            }
            
            console.log(`[INFO] Copying step ${linkStepNumber} from test case "${linkTo}" as step ${copiedStep.number}`);
            
            return [copiedStep];
        }

        // Default behavior: copy all steps from the linked test case
        console.log(`[INFO] Copying ${testCase.steps.length} steps from test case "${linkTo}"`);

        // Deep clone all steps from the linked test case
        const copiedSteps = [];
        for (const linkedStep of testCase.steps) {
            // Create a deep copy of the step
            const copiedStep = JSON.parse(JSON.stringify(linkedStep));
            copiedSteps.push(copiedStep);
        }

        return copiedSteps;
    }

    /**
     * Create basic HTTP step when API definition not found
     */
    createBasicHttpStep(step, parentModuleId) {
        const stepNumber = step.number || 1;
        const stepName = step.name || `Step ${stepNumber}`;
        const method = step.method || 'get';
        const path = step.path || '/';
        
        const requestBody = step.request_body_override || {
            type: 'none',
            data: ''
        };

        // Check if response validation is disabled
        const disableResponseValidation = step.disable_response_validation !== undefined 
            ? step.disable_response_validation 
            : (step.response_validation === false);
        
        // Set responseId to 0 if validation is disabled, otherwise generate one
        const responseId = disableResponseValidation ? 0 : this.generateId();

        const httpApiCase = {
            id: this.generateId(),
            name: stepName,
            method: method.toLowerCase(),
            path: path,
            auth: {},
            type: "http",
            options: {},
            parameters: {
                query: [],
                header: [],
                cookie: [],
                path: []
            },
            responseId: responseId,
            requestBody: {
                parameters: [],
                type: requestBody.type || 'none',
                data: requestBody.data ? requestBody.data.trim() : '',
                generateMode: "normal"
            },
            preProcessors: this.convertPreProcessors(step.pre_processors || step.preProcessors || []),
            postProcessors: this.mergePostProcessors(step.assertions || [], step.post_processors || step.postProcessors || []),
            advancedSettings: {
                disabledSystemHeaders: {},
                isDefaultUrlEncoding: 1
            },
            commonParameters: {
                query: [],
                body: [],
                header: [],
                cookie: []
            },
            inheritPreProcessors: {},
            inheritPostProcessors: {},
            inheritPreProcessorsSnapshot: [],
            inheritPostProcessorsSnapshot: [],
            moduleId: parentModuleId
        };

        // Override request body data if provided
        if (step.request_body_override && step.request_body_override.data) {
            httpApiCase.requestBody.data = step.request_body_override.data.trim();
            httpApiCase.requestBody.type = step.request_body_override.type || 'application/json';
        }

        // Override form data (multipart/form-data) if provided
        if (step.request_form_data_override && Array.isArray(step.request_form_data_override)) {
            httpApiCase.requestBody.type = 'multipart/form-data';
            
            // Build parameters array for form data
            const formDataParameters = [];
            for (const formField of step.request_form_data_override) {
                const fieldName = formField.name;
                const fieldType = formField.type || 'string';
                const fieldValue = formField.value || '';
                const fieldEnable = formField.enable !== undefined ? formField.enable : true;
                
                // Find existing parameter by name
                const existingParam = httpApiCase.requestBody.parameters.find(
                    p => p.name === fieldName
                );
                
                if (existingParam) {
                    // Update existing parameter
                    existingParam.value = fieldValue;
                    existingParam.enable = fieldEnable;
                    existingParam.type = fieldType;
                } else {
                    // Add new parameter
                    const newParam = {
                        id: `custom_${this.generateId()}`,
                        name: fieldName,
                        required: false,
                        enable: fieldEnable,
                        value: fieldValue,
                        type: fieldType,
                        description: formField.description || ''
                    };
                    
                    // Add schema field to match API definition structure
                    if (fieldType === 'file') {
                        newParam.schema = {
                            type: 'string',
                            format: 'binary',
                            description: formField.description || ''
                        };
                    } else {
                        newParam.schema = {
                            type: 'string',
                            description: formField.description || ''
                        };
                    }
                    
                    formDataParameters.push(newParam);
                }
            }
            
            // Add new parameters if any
            if (formDataParameters.length > 0) {
                httpApiCase.requestBody.parameters.push(...formDataParameters);
            }
            
            // Ensure generateMode is set
            httpApiCase.requestBody.generateMode = "normal";
        }

        // Override query parameters if provided
        if (step.query_params_override && Array.isArray(step.query_params_override)) {
            for (const override of step.query_params_override) {
                const paramName = override.name;
                const paramValue = override.value;
                
                if (paramValue === null || paramValue === undefined) {
                    const existingParamIndex = httpApiCase.parameters.query.findIndex(p => p.name === paramName);
                    if (existingParamIndex !== -1) {
                        httpApiCase.parameters.query.splice(existingParamIndex, 1);
                        console.log(`[INFO] Removed query parameter "${paramName}" (value was null)`);
                    }
                    continue;
                }
                
                const existingParam = httpApiCase.parameters.query.find(p => p.name === paramName);
                
                if (existingParam) {
                    existingParam.value = paramValue;
                    existingParam.enable = true;
                } else {
                    httpApiCase.parameters.query.push({
                        id: `custom_${this.generateId()}`,
                        name: paramName,
                        required: false,
                        enable: true,
                        value: paramValue,
                        type: "string",
                        description: ""
                    });
                }
            }
        }

        // Override path parameters if provided
        if (step.path_params_override && Array.isArray(step.path_params_override)) {
            for (const override of step.path_params_override) {
                const paramName = override.name;
                const paramValue = override.value;
                
                if (paramValue === null || paramValue === undefined) {
                    const existingParamIndex = httpApiCase.parameters.path.findIndex(p => p.name === paramName);
                    if (existingParamIndex !== -1) {
                        httpApiCase.parameters.path.splice(existingParamIndex, 1);
                        console.log(`[INFO] Removed path parameter "${paramName}" (value was null)`);
                    }
                    continue;
                }
                
                const existingParam = httpApiCase.parameters.path.find(p => p.name === paramName);
                
                if (existingParam) {
                    existingParam.value = paramValue;
                    existingParam.enable = true;
                } else {
                    httpApiCase.parameters.path.push({
                        id: `custom_${this.generateId()}`,
                        name: paramName,
                        required: false,
                        enable: true,
                        value: paramValue,
                        type: "string",
                        description: ""
                    });
                }
            }
        }

        // Override cookie parameters if provided
        if (step.cookie_params_override && Array.isArray(step.cookie_params_override)) {
            for (const override of step.cookie_params_override) {
                const paramName = override.name;
                const paramValue = override.value;
                
                if (paramValue === null || paramValue === undefined) {
                    const existingParamIndex = httpApiCase.parameters.cookie.findIndex(p => p.name === paramName);
                    if (existingParamIndex !== -1) {
                        httpApiCase.parameters.cookie.splice(existingParamIndex, 1);
                        console.log(`[INFO] Removed cookie parameter "${paramName}" (value was null)`);
                    }
                    continue;
                }
                
                const existingParam = httpApiCase.parameters.cookie.find(p => p.name === paramName);
                
                if (existingParam) {
                    existingParam.value = paramValue;
                    existingParam.enable = true;
                } else {
                    httpApiCase.parameters.cookie.push({
                        id: `custom_${this.generateId()}`,
                        name: paramName,
                        required: false,
                        enable: true,
                        value: paramValue,
                        type: "string",
                        description: "",
                        isDelete: false
                    });
                }
            }
        }

        // Override header parameters if provided
        if (step.header_params_override && Array.isArray(step.header_params_override)) {
            for (const override of step.header_params_override) {
                const paramName = override.name;
                const paramValue = override.value;
                
                // Skip null or undefined values - remove them from header params
                if (paramValue === null || paramValue === undefined) {
                    // Find and remove existing parameter if it exists (case-insensitive match)
                    const existingParamIndex = httpApiCase.parameters.header.findIndex(
                        p => p.name && p.name.toLowerCase() === paramName.toLowerCase()
                    );
                    if (existingParamIndex !== -1) {
                        httpApiCase.parameters.header.splice(existingParamIndex, 1);
                        console.log(`[INFO] Removed header parameter "${paramName}" (value was null)`);
                    }
                    continue;
                }
                
                // Find existing parameter by name (case-insensitive match)
                const existingParam = httpApiCase.parameters.header.find(
                    p => p.name && p.name.toLowerCase() === paramName.toLowerCase()
                );
                
                if (existingParam) {
                    // Update existing parameter value
                    existingParam.value = paramValue;
                    existingParam.enable = true;
                } else {
                    // Add new parameter if not found
                    httpApiCase.parameters.header.push({
                        id: `custom_${this.generateId()}`,
                        name: paramName,
                        required: false,
                        enable: true,
                        value: paramValue,
                        type: "string",
                        description: ""
                    });
                }
            }
        }

        // Handle user agent (step-level)
        const userAgent = step.user_agent;
        if (userAgent) {
            // Find existing User-Agent header
            const existingUserAgentHeader = httpApiCase.parameters.header.find(
                h => h.name && h.name.toLowerCase() === 'user-agent'
            );
            
            if (existingUserAgentHeader) {
                // Update existing User-Agent header
                existingUserAgentHeader.value = userAgent;
                existingUserAgentHeader.enable = true;
            } else {
                // Add new User-Agent header
                httpApiCase.parameters.header.push({
                    id: `custom_${this.generateId()}`,
                    name: 'User-Agent',
                    required: false,
                    enable: true,
                    value: userAgent,
                    type: 'string',
                    description: ''
                });
            }
        }

        return {
            name: stepName,
            number: stepNumber,
            type: "http",
            bind: false,
            disable: false,
            bindType: "API",
            bindId: 0,
            syncMode: "MANUAL",
            httpApiCase
        };
    }

    /**
     * Convert assertions to postProcessors (Apidog format)
     */
    convertAssertions(assertions) {
        if (!assertions || assertions.length === 0) {
            return [];
        }

        const postProcessors = [];
        
        for (const assertion of assertions) {
            const processor = {
                type: "assertion",
                data: {
                    name: assertion.name || "",
                    subject: assertion.subject || "responseJson",
                    comparison: assertion.comparison || assertion.operator || "equal",
                    value: assertion.value || "",
                    path: assertion.path || "",
                    multipleValue: [],
                    extractSettings: {
                        expression: assertion.path || "",
                        continueExtractorSettings: {
                            isContinueExtractValue: false,
                            JsonArrayValueIndexValue: ""
                        }
                    }
                },
                defaultEnable: false,
                enable: true
            };
            
            postProcessors.push(processor);
        }
        
        return postProcessors;
    }

    /**
     * Convert custom preProcessors to Apidog format
     */
    convertPreProcessors(preProcessors) {
        if (!preProcessors || preProcessors.length === 0) {
            // Return default placeholder processor if none specified
            return [
                {
                    type: "placeholder",
                    renderType: "dynamicValueDivider",
                    defaultEnable: false,
                    enable: false
                }
            ];
        }

        const convertedProcessors = [];
        
        for (const processor of preProcessors) {
            const processorType = processor.type;
            
            // Support both camelCase and snake_case for defaultEnable
            const defaultEnable = processor.default_enable !== undefined 
                ? processor.default_enable 
                : (processor.defaultEnable !== undefined ? processor.defaultEnable : false);
            const enable = processor.enable !== undefined ? processor.enable : true;
            
            if (processorType === "customScript") {
                // Handle customScript type preProcessor
                let scriptData = '';
                if (typeof processor.data === 'string') {
                    scriptData = processor.data;
                } else if (processor.data !== null && processor.data !== undefined) {
                    // Convert to string if not already
                    scriptData = String(processor.data);
                }
                
                // Normalize line endings to \r\n (Apidog format)
                scriptData = scriptData.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
                
                const converted = {
                    type: "customScript",
                    data: scriptData,
                    defaultEnable: defaultEnable,
                    enable: enable
                };
                convertedProcessors.push(converted);
            } else {
                // Handle other preProcessor types (pass through as-is with defaults)
                const converted = {
                    type: processorType || "unknown",
                    data: processor.data || {},
                    defaultEnable: defaultEnable,
                    enable: enable
                };
                
                // Copy any additional properties
                for (const key in processor) {
                    if (!['type', 'data', 'defaultEnable', 'default_enable', 'enable'].includes(key)) {
                        converted[key] = processor[key];
                    }
                }
                
                convertedProcessors.push(converted);
                console.log(`[INFO] Added custom preProcessor type: ${processorType}`);
            }
        }
        
        return convertedProcessors;
    }

    /**
     * Convert custom postProcessors to Apidog format
     */
    convertPostProcessors(postProcessors) {
        if (!postProcessors || postProcessors.length === 0) {
            return [];
        }

        const convertedProcessors = [];
        
        for (const processor of postProcessors) {
            const processorType = processor.type;
            
            // Support both camelCase and snake_case for defaultEnable
            const defaultEnable = processor.default_enable !== undefined 
                ? processor.default_enable 
                : (processor.defaultEnable !== undefined ? processor.defaultEnable : false);
            const enable = processor.enable !== undefined ? processor.enable : true;
            
            if (processorType === "assertion") {
                // Handle assertion type postProcessor
                const assertionData = processor.data || {};
                const converted = {
                    type: "assertion",
                    data: {
                        name: assertionData.name || "",
                        subject: assertionData.subject || "responseJson",
                        comparison: assertionData.comparison || assertionData.operator || "equal",
                        value: assertionData.value || "",
                        path: assertionData.path || "",
                        multipleValue: assertionData.multipleValue || [],
                        extractSettings: assertionData.extractSettings || {
                            expression: assertionData.path || "",
                            continueExtractorSettings: {
                                isContinueExtractValue: false,
                                JsonArrayValueIndexValue: ""
                            }
                        }
                    },
                    defaultEnable: defaultEnable,
                    enable: enable
                };
                convertedProcessors.push(converted);
            } else if (processorType === "customScript") {
                // Handle customScript type postProcessor
                let scriptData = '';
                if (typeof processor.data === 'string') {
                    scriptData = processor.data;
                } else if (processor.data !== null && processor.data !== undefined) {
                    // Convert to string if not already
                    scriptData = String(processor.data);
                }
                
                // Normalize line endings to \r\n (Apidog format)
                scriptData = scriptData.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
                
                const converted = {
                    type: "customScript",
                    data: scriptData,
                    defaultEnable: defaultEnable,
                    enable: enable
                };
                convertedProcessors.push(converted);
            } else {
                // Handle other postProcessor types (pass through as-is with defaults)
                const converted = {
                    type: processorType || "unknown",
                    data: processor.data || {},
                    defaultEnable: defaultEnable,
                    enable: enable
                };
                
                // Copy any additional properties
                for (const key in processor) {
                    if (!['type', 'data', 'defaultEnable', 'default_enable', 'enable'].includes(key)) {
                        converted[key] = processor[key];
                    }
                }
                
                convertedProcessors.push(converted);
                console.log(`[INFO] Added custom postProcessor type: ${processorType}`);
            }
        }
        
        return convertedProcessors;
    }

    /**
     * Merge assertions and custom postProcessors
     */
    mergePostProcessors(assertions, customPostProcessors) {
        const allProcessors = [];
        
        // First add assertions
        if (assertions && assertions.length > 0) {
            allProcessors.push(...this.convertAssertions(assertions));
        }
        
        // Then add custom postProcessors
        // Support both postProcessors (camelCase) and post_processors (snake_case)
        const postProcessorsToConvert = customPostProcessors || [];
        if (postProcessorsToConvert.length > 0) {
            allProcessors.push(...this.convertPostProcessors(postProcessorsToConvert));
        }
        
        return allProcessors;
    }

    /**
     * Convert testCaseRef step
     */
    convertTestCaseRefStep(step) {
        const stepNumber = step.number || 1;
        const stepName = step.name || `Step ${stepNumber}`;
        const refName = step.ref_name || step.refName || step.name;
        const refId = step.ref_id || step.refId;

        // Find the referenced test case
        let relatedId = null;
        let testCaseName = stepName;

        if (refId) {
            // Look up by ID if provided
            const testCase = this.testCasesById.get(refId);
            if (testCase) {
                relatedId = parseInt(testCase.id);
                testCaseName = testCase.name || stepName;
            } else {
                console.warn(`[WARNING] Test case with ID "${refId}" not found`);
            }
        } else if (refName) {
            // Look up by name if provided
            const testCase = this.testCases.get(refName);
            if (testCase) {
                relatedId = parseInt(testCase.id);
                testCaseName = testCase.name || refName;
            } else {
                console.warn(`[WARNING] Test case "${refName}" not found`);
                console.log(`[INFO] Available test cases: ${Array.from(this.testCases.keys()).join(', ')}`);
            }
        } else {
            console.warn(`[WARNING] testCaseRef step ${stepNumber} missing both "ref_name" and "ref_id"`);
        }

        if (!relatedId) {
            // Generate a placeholder ID if test case not found
            relatedId = this.generateId();
            console.warn(`[WARNING] Using generated ID ${relatedId} for testCaseRef step ${stepNumber}`);
        }

        return {            
            id: crypto.randomUUID(),
            type: "testCaseRef",
            disable: step.disable !== undefined ? step.disable : false,
            parameters: step.parameters || {},
            relatedId: relatedId,
            name: testCaseName,
            number: stepNumber
        };
    }

    /**
     * Convert delay/wait step
     */
    convertDelayStep(step) {
        const stepNumber = step.number || 1;
        const timeout = step.timeout || step.duration || 1000; // milliseconds

        return {
            id: String(this.generateId()),
            type: "delay",
            disable: false,
            parameters: {
                timeout: timeout
            },
            number: stepNumber
        };
    }

    /**
     * Convert IF condition step
     */
    convertIfStep(step) {
        const stepNumber = step.number || 1;
        
        // Support both new format (parameters) and old format (condition) for backward compatibility
        let parameters;
        if (step.parameters) {
            // New format: use parameters directly
            parameters = {
                keyVariable: step.parameters.keyVariable || '',
                operator: step.parameters.operator || 'equal',
                valueVariable: String(step.parameters.valueVariable || '')
            };
        } else {
            // Old format: convert condition to parameters
            const condition = step.condition || {};
            parameters = {
                keyVariable: condition.variable || '',
                operator: condition.operator || 'equal',
                valueVariable: String(condition.value || '')
            };
        }

        // helper to invert operators for else branch
        const invertOperator = (op) => {
            const map = {
                equal: 'notEqual',
                not_equal: 'equal',
                notEqual: 'equal',
                greater: 'lessOrEqual',
                less: 'greaterOrEqual',
                greaterOrEqual: 'less',
                lessOrEqual: 'greater',
                contains: 'notContains',
                notContains: 'contains',
                exists: 'notExists',
                notExists: 'exists'
            };
            return map[op] || 'notEqual';
        };

        // Convert children steps
        const children = [];
        if (step.children) {
            for (const child of step.children) {
                const childType = child.type || 'http';
                if (childType === 'http') {
                    children.push(this.convertHttpStep(child));
                } else if (childType === 'if') {
                    children.push(this.convertIfStep(child));
                } else if (childType === 'testCaseRef' || childType === 'test_case_ref') {
                    children.push(this.convertTestCaseRefStep(child));
                } else if (childType === 'delay' || childType === 'wait') {
                    children.push(this.convertDelayStep(child));
                } else if (childType === 'link') {
                    // Handle linked test case - copy all steps from referenced test case
                    const linkedSteps = this.convertLinkedSteps(child);
                    if (linkedSteps && linkedSteps.length > 0) {
                        children.push(...linkedSteps);
                    } else {
                        console.log(`[WARN] Linked test case "${child.link_to}" not found, skipping step ${child.number}`);
                    }
                } else if (childType === 'script') {
                    children.push(this.convertScriptStep(child));
                } else if (childType === 'else') {
                    // Build ELSE as an IF node with inverted parent condition
                    const elseChildren = [];
                    if (child.children) {
                        for (const elseChild of child.children) {
                            const elseChildType = elseChild.type || 'http';
                            if (elseChildType === 'http') {
                                elseChildren.push(this.convertHttpStep(elseChild));
                            } else if (elseChildType === 'if') {
                                elseChildren.push(this.convertIfStep(elseChild));
                            } else if (elseChildType === 'testCaseRef' || elseChildType === 'test_case_ref') {
                                elseChildren.push(this.convertTestCaseRefStep(elseChild));
                            } else if (elseChildType === 'delay' || elseChildType === 'wait') {
                                elseChildren.push(this.convertDelayStep(elseChild));
                            } else if (elseChildType === 'link') {
                                // Handle linked test case in else branch
                                const linkedSteps = this.convertLinkedSteps(elseChild);
                                if (linkedSteps && linkedSteps.length > 0) {
                                    elseChildren.push(...linkedSteps);
                                } else {
                                    console.log(`[WARN] Linked test case "${elseChild.link_to}" not found, skipping step ${elseChild.number}`);
                                }
                            } else if (elseChildType === 'script') {
                                elseChildren.push(this.convertScriptStep(elseChild));
                            }
                        }
                    }
                    children.push({
                        id: String(this.generateId()),
                        type: 'if',
                        disable: false,
                        parameters: {
                            keyVariable: parameters.keyVariable,
                            operator: invertOperator(parameters.operator),
                            valueVariable: parameters.valueVariable
                        },
                        children: elseChildren,
                        isOpen: true,
                        number: child.number || (stepNumber + 1)
                    });
                }
            }
        }

        return {
            id: String(this.generateId()),
            type: "if",
            disable: false,
            parameters,
            children,
            isOpen: true,
            number: stepNumber
        };
    }

    /**
     * Convert script step to Apidog format
     */
    convertScriptStep(step) {
        const stepNumber = step.number || 1;
        const stepName = step.name || '';
        const scriptData = step.data || '';
        
        // Normalize line endings to \r\n (Apidog format)
        let normalizedScript = scriptData.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
        
        // Support both enable and defaultEnable
        const enable = step.enable !== undefined ? step.enable : true;
        const defaultEnable = step.default_enable !== undefined 
            ? step.default_enable 
            : (step.defaultEnable !== undefined ? step.defaultEnable : true);

        return {
            id: String(this.generateId()),
            type: 'script',
            disable: step.disable !== undefined ? step.disable : false,
            parameters: {
                data: normalizedScript,
                type: 'customScript',
                defaultEnable: defaultEnable,
                enable: enable
            },
            name: stepName,
            number: stepNumber
        };
    }

    /**
     * Convert ELSE block to Apidog format (top-level or within flows)
     */
    convertElseStep(step) {
        const stepNumber = step.number || 1;
        const children = [];
        if (Array.isArray(step.children)) {
            for (const child of step.children) {
                const childType = child.type || 'http';
                if (childType === 'http') {
                    children.push(this.convertHttpStep(child));
                } else if (childType === 'if') {
                    children.push(this.convertIfStep(child));
                } else if (childType === 'testCaseRef' || childType === 'test_case_ref') {
                    children.push(this.convertTestCaseRefStep(child));
                } else if (childType === 'delay' || childType === 'wait') {
                    children.push(this.convertDelayStep(child));
                } else if (childType === 'link') {
                    const linked = this.convertLinkedSteps(child);
                    if (linked && linked.length > 0) children.push(...linked);
                } else if (childType === 'script') {
                    children.push(this.convertScriptStep(child));
                }
            }
        }

        return {
            id: String(this.generateId()),
            type: 'else',
            disable: false,
            parameters: {},
            isOpen: true,
            children,
            number: stepNumber
        };
    }

    /**
     * Convert dataset
     */
    convertDataset(dataset, testCaseId, datasetIndex) {
        // Use provided ID if available, otherwise generate new one
        const datasetId = dataset.id || this.generateId();
        
        // Use provided data_list_id if available, otherwise generate new one
        const dataListId = dataset.data_list_id || this.generateId();

        return {
            id: datasetId,
            name: dataset.name || `Data ${datasetIndex + 1}`,
            relatedId: testCaseId,
            apiTestDataList: [
                {
                    id: dataListId,
                    data: (dataset.data || '').trim() + '\n',
                    dataSetId: datasetId,
                    relatedId: testCaseId,
                    relatedType: 0,
                    environmentId: 0
                }
            ]
        };
    }

    /**
     * Convert YAML scenario to Apidog JSON format
     */
    convert(yamlData) {
        // Load source Apidog file if specified
        if (yamlData.source_apidog) {
            this.loadSourceApidog(yamlData.source_apidog);
        }

        const testCaseId = this.generateId();

        // Convert options
        const optionsYaml = yamlData.options || {};
        const options = {
            environmentId: optionsYaml.environment_id || 0,
            useDataSetId: 0,
            iterationCount: optionsYaml.iteration_count || 1,
            threadCount: optionsYaml.thread_count || 1,
            runnerId: 0,
            onError: optionsYaml.on_error || 'ignore',
            delayItem: optionsYaml.delay_item || 0,
            saveReportDetail: optionsYaml.save_report_detail || 'all',
            saveVariables: true,
            readGlobalCookie: false,
            saveGlobalCookie: false
        };

        // Convert steps
        const steps = [];
        if (yamlData.steps) {
            for (const step of yamlData.steps) {
                const stepType = step.type || 'http';
                if (stepType === 'link') {
                    // Handle linked test case - copy all steps from referenced test case
                    const linkedSteps = this.convertLinkedSteps(step);
                    if (linkedSteps && linkedSteps.length > 0) {
                        steps.push(...linkedSteps);
                    } else {
                        console.log(`[WARN] Linked test case "${step.link_to}" not found, skipping step ${step.number}`);
                    }
                } else if (stepType === 'testCaseRef' || stepType === 'test_case_ref') {
                    // Handle testCaseRef - reference to another test case
                    steps.push(this.convertTestCaseRefStep(step));
                } else if (stepType === 'http') {
                    steps.push(this.convertHttpStep(step));
                } else if (stepType === 'if') {
                    steps.push(this.convertIfStep(step));
                } else if (stepType === 'else') {
                    steps.push(this.convertElseStep(step));
                } else if (stepType === 'script') {
                    steps.push(this.convertScriptStep(step));
                } else if (stepType === 'delay' || stepType === 'wait') {
                    steps.push(this.convertDelayStep(step));
                }
            }
        }

        // Convert datasets
        const datasets = [];
        const datasetsYaml = yamlData.datasets || [];
        for (let idx = 0; idx < datasetsYaml.length; idx++) {
            const dataset = this.convertDataset(datasetsYaml[idx], testCaseId, idx);
            datasets.push(dataset);
        }

        // Update useDataSetId if datasets exist
        if (datasets.length > 0) {
            options.useDataSetId = datasets[0].id;
        }

        // Build the complete test case
        const testCase = {
            steps,
            id: testCaseId,
            name: yamlData.name || 'Test Scenario',
            tags: yamlData.tags || [],
            options,
            priority: yamlData.priority || 2,
            ordering: 10,
            description: yamlData.description || '',
            preProcessors: [],
            postProcessors: [],  // Test case level postProcessors (empty)
            children: [],
            performanceTestOptions: {},
            apiTestDataSets: datasets
        };

        // Add folder information if specified (for merge script)
        if (yamlData.folder) {
            testCase._folder = yamlData.folder;
        }

        return testCase;
    }
}

/**
 * Main entry point
 */
function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log('Usage: node .apidog/scripts/convert_scenario.js <input.yaml> [output.json]');
        console.log('\nExample:');
        console.log('  node .apidog/scripts/convert_scenario.js .apidog/test-cases/front-login/login_scenario.yaml');
        console.log('  node convert_scenario.js input.yaml custom-output.json');
        console.log('\nDefault output: .apidog/temp/ folder (preserves folder structure)');
        process.exit(1);
    }

    const inputFile = args[0];
    let outputFile;

    if (args.length >= 2) {
        outputFile = args[1];
    } else {
        // Default: Output to .apidog/temp/ folder, preserving structure
        const baseName = path.basename(inputFile, path.extname(inputFile));
        
        // Extract relative path from .apidog/test-cases/
        let relativePath = inputFile;
        if (inputFile.startsWith('.apidog/test-cases/') || inputFile.startsWith('.apidog\\test-cases\\')) {
            relativePath = inputFile.substring('.apidog/test-cases/'.length);
        } else if (inputFile.startsWith('test-cases/') || inputFile.startsWith('test-cases\\')) {
            relativePath = inputFile.substring('test-cases/'.length);
        }
        
        const subDir = path.dirname(relativePath);
        const outputDir = path.join('.apidog', 'temp', subDir);
        
        // Create output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        outputFile = path.join(outputDir, `${baseName}.json`);
    }

    // Check if input file exists
    if (!fs.existsSync(inputFile)) {
        console.error(`[ERROR] Input file not found: ${inputFile}`);
        process.exit(1);
    }

    try {
        // Load YAML
        console.log(`[INFO] Loading YAML file: ${inputFile}`);
        const yamlContent = fs.readFileSync(inputFile, 'utf-8');
        const yamlData = yaml.load(yamlContent);

        // Convert to Apidog format
        console.log('[INFO] Converting to Apidog format...');
        const converter = new ApidogConverter();
        const apidogJson = converter.convert(yamlData);

        // Ensure output directory exists (for custom paths)
        const outputDir = path.dirname(outputFile);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Save JSON
        console.log(`[INFO] Saving JSON file: ${outputFile}`);
        fs.writeFileSync(outputFile, JSON.stringify(apidogJson, null, 2), 'utf-8');

        console.log('\n[SUCCESS] ✅ Conversion completed!');
        console.log(`   Input:  ${inputFile}`);
        console.log(`   Output: ${outputFile}`);
        console.log(`\n📥 Import '${outputFile}' into Apidog to run the test scenario`);

    } catch (error) {
        if (error.name === 'YAMLException') {
            console.error(`[ERROR] YAML parsing error: ${error.message}`);
        } else {
            console.error(`[ERROR] ${error.message}`);
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { ApidogConverter };



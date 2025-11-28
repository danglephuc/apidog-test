#!/usr/bin/env node

/**
 * 📦 Apidog Test Case Merger
 * 
 * Merges all output JSON test cases from a specific folder into the final Apidog JSON file.
 * Updates the apiTestCaseCollection with all test cases.
 */

const fs = require('fs');
const path = require('path');

class TestCaseMerger {
    constructor() {
        this.testCases = [];
        this.usedIds = new Set();
        this.nextId = 10000000;
    }

    /**
     * Get next available unique ID
     */
    getNextId() {
        while (this.usedIds.has(this.nextId)) {
            this.nextId++;
        }
        this.usedIds.add(this.nextId);
        return this.nextId++;
    }

    /**
     * Recursively collect all used IDs from an object
     */
    collectUsedIds(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            obj.forEach(item => this.collectUsedIds(item));
        } else {
            if (obj.id && typeof obj.id === 'number') {
                this.usedIds.add(obj.id);
            }
            Object.values(obj).forEach(value => this.collectUsedIds(value));
        }
    }

    /**
     * Reassign IDs to avoid conflicts
     */
    reassignIds(testCase) {
        const idMap = new Map();
        
        const reassignRecursive = (obj) => {
            if (!obj || typeof obj !== 'object') return obj;

            if (Array.isArray(obj)) {
                return obj.map(item => reassignRecursive(item));
            }

            const newObj = {};
            for (const [key, value] of Object.entries(obj)) {
                if (key === 'id' && typeof value === 'number') {
                    // Check if this ID is already used
                    if (this.usedIds.has(value)) {
                        // Reassign a new ID
                        if (!idMap.has(value)) {
                            idMap.set(value, this.getNextId());
                        }
                        newObj[key] = idMap.get(value);
                    } else {
                        this.usedIds.add(value);
                        newObj[key] = value;
                    }
                } else {
                    newObj[key] = reassignRecursive(value);
                }
            }
            return newObj;
        };

        return reassignRecursive(testCase);
    }

    /**
     * Load all JSON files from a folder
     */
    loadTestCasesFromFolder(folderPath) {
        console.log(`[INFO] Loading JSON files from: ${folderPath}`);
        
        if (!fs.existsSync(folderPath)) {
            throw new Error(`Folder not found: ${folderPath}`);
        }

        const files = fs.readdirSync(folderPath);
        const jsonFiles = files.filter(file => file.endsWith('.json'));

        console.log(`[INFO] Found ${jsonFiles.length} JSON files`);

        for (const file of jsonFiles) {
            const filePath = path.join(folderPath, file);
            console.log(`[INFO] Loading: ${file}`);
            
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const testCase = JSON.parse(content);
                
                // Validate test case structure
                if (!testCase.steps || !testCase.name) {
                    console.warn(`[WARN] Invalid test case structure in: ${file}`);
                    continue;
                }

                this.testCases.push({
                    file: file,
                    data: testCase
                });
                
                console.log(`[INFO] ✓ Loaded: ${testCase.name}`);
            } catch (error) {
                console.error(`[ERROR] Failed to load ${file}: ${error.message}`);
            }
        }

        console.log(`[INFO] Successfully loaded ${this.testCases.length} test cases`);
    }

    /**
     * Merge test cases into the Apidog JSON file
     */
    mergeIntoApidog(apidogPath, outputPath) {
        console.log(`[INFO] Loading base Apidog file: ${apidogPath}`);
        
        if (!fs.existsSync(apidogPath)) {
            throw new Error(`Apidog file not found: ${apidogPath}`);
        }

        const content = fs.readFileSync(apidogPath, 'utf-8');
        const apidogData = JSON.parse(content);

        // Collect all existing IDs from the Apidog file
        console.log(`[INFO] Collecting existing IDs from Apidog file...`);
        this.collectUsedIds(apidogData);
        console.log(`[INFO] Found ${this.usedIds.size} existing IDs`);

        // Ensure apiTestCaseCollection exists
        if (!apidogData.apiTestCaseCollection) {
            apidogData.apiTestCaseCollection = [];
        }

        // Ensure Root collection exists
        if (apidogData.apiTestCaseCollection.length === 0) {
            apidogData.apiTestCaseCollection.push({
                name: 'Root',
                children: [],
                items: []
            });
        }

        const rootCollection = apidogData.apiTestCaseCollection[0];
        if (!rootCollection.items) {
            rootCollection.items = [];
        }
        if (!rootCollection.children) {
            rootCollection.children = [];
        }

        /**
         * Find or create a folder in the children array
         */
        const findOrCreateFolder = (folderName) => {
            // Find existing folder
            let folder = rootCollection.children.find(child => child.name === folderName);
            
            if (!folder) {
                // Create new folder
                folder = {
                    name: folderName,
                    description: "",
                    children: [],
                    items: []
                };
                rootCollection.children.push(folder);
                console.log(`[INFO] Created folder: ${folderName}`);
            }
            
            if (!folder.items) {
                folder.items = [];
            }
            
            return folder;
        };

        // Create maps of existing test cases by name for deduplication
        // Map structure: folderName -> Map(testCaseName -> index)
        const existingTestCasesByFolder = new Map();
        
        // Index root level test cases
        const rootTestCases = new Map();
        rootCollection.items.forEach((item, index) => {
            rootTestCases.set(item.name, index);
        });
        existingTestCasesByFolder.set(null, rootTestCases); // null = root level
        
        // Index folder level test cases
        rootCollection.children.forEach(folder => {
            if (folder.items && Array.isArray(folder.items)) {
                const folderTestCases = new Map();
                folder.items.forEach((item, index) => {
                    folderTestCases.set(item.name, index);
                });
                existingTestCasesByFolder.set(folder.name, folderTestCases);
            }
        });
        
        const totalExisting = Array.from(existingTestCasesByFolder.values())
            .reduce((sum, map) => sum + map.size, 0);
        console.log(`[INFO] Existing test cases: ${totalExisting} (across all folders)`);

        // Merge test cases
        console.log(`[INFO] Merging test cases...`);
        let addedCount = 0;
        let updatedCount = 0;

        for (const { file, data } of this.testCases) {
            // Reassign IDs to avoid conflicts
            const processedTestCase = this.reassignIds(data);
            
            // Extract folder information (remove _folder from final output)
            const folderName = processedTestCase._folder || null;
            delete processedTestCase._folder; // Remove metadata field from output

            // Determine target collection (folder or root)
            let targetCollection;
            let testCasesMap;
            
            if (folderName) {
                const folder = findOrCreateFolder(folderName);
                targetCollection = folder;
                
                // Get or create map for this folder
                if (!existingTestCasesByFolder.has(folderName)) {
                    existingTestCasesByFolder.set(folderName, new Map());
                }
                testCasesMap = existingTestCasesByFolder.get(folderName);
            } else {
                targetCollection = rootCollection;
                testCasesMap = existingTestCasesByFolder.get(null);
            }

            // Check if test case already exists in target collection
            if (testCasesMap.has(processedTestCase.name)) {
                // Update existing test case
                const index = testCasesMap.get(processedTestCase.name);
                targetCollection.items[index] = processedTestCase;
                updatedCount++;
                const location = folderName ? `folder "${folderName}"` : 'root';
                console.log(`[INFO] ↻ Updated: ${processedTestCase.name} (in ${location})`);
            } else {
                // Add new test case
                targetCollection.items.push(processedTestCase);
                testCasesMap.set(processedTestCase.name, targetCollection.items.length - 1);
                addedCount++;
                const location = folderName ? `folder "${folderName}"` : 'root';
                console.log(`[INFO] + Added: ${processedTestCase.name} (in ${location})`);
            }
        }

        // Sort test cases by ordering field in root
        rootCollection.items.sort((a, b) => {
            const orderA = a.ordering || 0;
            const orderB = b.ordering || 0;
            return orderA - orderB;
        });

        // Sort test cases by ordering field in each folder
        rootCollection.children.forEach(folder => {
            if (folder.items && Array.isArray(folder.items)) {
                folder.items.sort((a, b) => {
                    const orderA = a.ordering || 0;
                    const orderB = b.ordering || 0;
                    return orderA - orderB;
                });
            }
        });

        const totalTestCases = rootCollection.items.length + 
            rootCollection.children.reduce((sum, folder) => sum + (folder.items?.length || 0), 0);
        
        console.log(`[INFO] Merge complete: ${addedCount} added, ${updatedCount} updated`);
        console.log(`[INFO] Total test cases in collection: ${totalTestCases} (${rootCollection.items.length} in root, ${rootCollection.children.reduce((sum, f) => sum + (f.items?.length || 0), 0)} in folders)`);

        // Write output file
        console.log(`[INFO] Writing output to: ${outputPath}`);
        const outputContent = JSON.stringify(apidogData, null, 2);
        fs.writeFileSync(outputPath, outputContent, 'utf-8');
        
        console.log(`[SUCCESS] ✓ Test cases merged successfully!`);
        console.log(`[SUCCESS] Output: ${outputPath}`);
    }
}

/**
 * Clear temp folder after successful merge
 */
function clearTempFolder(tempFolderPath) {
    try {
        if (fs.existsSync(tempFolderPath)) {
            const files = fs.readdirSync(tempFolderPath);
            for (const file of files) {
                const filePath = path.join(tempFolderPath, file);
                const stat = fs.statSync(filePath);
                if (stat.isFile() && file.endsWith('.json')) {
                    fs.unlinkSync(filePath);
                    console.log(`[INFO] Deleted: ${file}`);
                }
            }
            console.log(`[INFO] ✓ Temp folder cleared: ${tempFolderPath}`);
        }
    } catch (error) {
        console.warn(`[WARN] Failed to clear temp folder: ${error.message}`);
    }
}

/**
 * Auto-detect source Apidog file based on project name
 */
function findSourceApidogFile(projectName) {
    const collectionsInputPath = path.join('.apidog', 'collections', 'input');
    
    if (!fs.existsSync(collectionsInputPath)) {
        throw new Error(`Collections input folder not found: ${collectionsInputPath}`);
    }

    // Try to find matching Apidog file
    const files = fs.readdirSync(collectionsInputPath);
    const projectNameLower = projectName.toLowerCase().replace(/-/g, ' ');
    
    // Try exact match first (e.g., "Front Admin API.apidog.json" for "front-admin")
    const exactMatch = files.find(file => {
        const fileName = file.toLowerCase().replace(/\.apidog\.json$/, '');
        return fileName.includes(projectNameLower) || 
               projectNameLower.includes(fileName.replace(/\s+/g, ' '));
    });

    if (exactMatch) {
        return path.join(collectionsInputPath, exactMatch);
    }

    // Try partial match
    const partialMatch = files.find(file => {
        const fileName = file.toLowerCase();
        const projectParts = projectNameLower.split(/[-_]/);
        return projectParts.some(part => fileName.includes(part));
    });

    if (partialMatch) {
        return path.join(collectionsInputPath, partialMatch);
    }

    throw new Error(`Could not find source Apidog file for project: ${projectName}. Available files: ${files.join(', ')}`);
}

/**
 * Generate output filename based on project name
 */
function generateOutputFilename(projectName) {
    // Convert "front-admin" to "Front Admin"
    const formattedName = projectName
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    
    return `Merged ${formattedName} API.apidog.json`;
}

/**
 * Main execution
 */
function main() {
    const args = process.argv.slice(2);

    // Short form: merge <project-name>
    if (args.length === 1) {
        const projectName = args[0];
        
        console.log(`\n📦 Apidog Test Case Merger (Short Form)`);
        console.log(`[INFO] Project: ${projectName}\n`);

        try {
            // Auto-construct paths
            const tempFolder = path.join('.apidog', 'temp', projectName);
            const sourceApidogFile = findSourceApidogFile(projectName);
            const outputFilename = generateOutputFilename(projectName);
            const outputApidogFile = path.join('.apidog', 'collections', 'output', outputFilename);

            console.log(`[INFO] Temp folder: ${tempFolder}`);
            console.log(`[INFO] Source file: ${sourceApidogFile}`);
            console.log(`[INFO] Output file: ${outputApidogFile}\n`);

            const merger = new TestCaseMerger();
            
            // Load all JSON files from temp folder
            merger.loadTestCasesFromFolder(tempFolder);
            
            if (merger.testCases.length === 0) {
                console.warn(`[WARN] No JSON test cases found in: ${tempFolder}`);
                console.warn(`[WARN] Make sure you've converted your YAML files first.`);
                process.exit(1);
            }

            // Ensure output directory exists
            const outputDir = path.dirname(outputApidogFile);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Merge into Apidog file
            merger.mergeIntoApidog(sourceApidogFile, outputApidogFile);
            
            // Clear temp folder after successful merge
            console.log(`\n[INFO] Clearing temp folder...`);
            clearTempFolder(tempFolder);
            
            console.log(`\n[SUCCESS] ✓ All done!`);
            process.exit(0);
        } catch (error) {
            console.error(`[ERROR] ${error.message}`);
            console.error(error.stack);
            process.exit(1);
        }
    }

    // Long form: merge <output-folder> <source-apidog-json> <output-apidog-json>
    if (args.length < 3) {
        console.log(`
📦 Apidog Test Case Merger

Usage (Short Form):
  node .apidog/scripts/merge_test_cases.js <project-name>

  Example:
    node .apidog/scripts/merge_test_cases.js front-admin
    npm run merge front-admin

  This will:
    1. Merge all JSON files from .apidog/temp/<project-name>/
    2. Use .apidog/collections/input/<Project> API.apidog.json as source
    3. Output to .apidog/collections/output/Merged <Project> API.apidog.json
    4. Clear the temp folder after successful merge

Usage (Long Form):
  node .apidog/scripts/merge_test_cases.js <output-folder> <source-apidog-json> <output-apidog-json>

Arguments:
  output-folder         Path to folder containing JSON test case files
  source-apidog-json    Path to the source Apidog JSON file (base template)
  output-apidog-json    Path to save the merged Apidog JSON file

Example (Long Form):
  node .apidog/scripts/merge_test_cases.js \\
    .apidog/temp/front-login \\
    .apidog/collections/input/Local\\ Front\\ Login\\ API.apidog.json \\
    .apidog/collections/output/Merged\\ Front\\ Login\\ API.apidog.json

Description:
  This script merges all JSON files from the output folder into the final
  Apidog JSON file at apiTestCaseCollection[0].items. It handles ID conflicts
  automatically and sorts test cases by their ordering field.
        `);
        process.exit(1);
    }

    const [outputFolder, sourceApidogFile, outputApidogFile] = args;

    try {
        const merger = new TestCaseMerger();
        
        // Load all JSON files from output folder
        merger.loadTestCasesFromFolder(outputFolder);
        
        if (merger.testCases.length === 0) {
            console.warn(`[WARN] No JSON test cases found in: ${outputFolder}`);
            process.exit(1);
        }

        // Ensure output directory exists
        const outputDir = path.dirname(outputApidogFile);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Merge into Apidog file
        merger.mergeIntoApidog(sourceApidogFile, outputApidogFile);
        
        process.exit(0);
    } catch (error) {
        console.error(`[ERROR] ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = { TestCaseMerger };


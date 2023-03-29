/**
 * core required Modules
 */
const helper = require('@jeli/cli/lib/utils');
const { escogen, generateAstSource } = require('./ast.generator');
const path = require('path');
const annotationParser = require('./annotation');
const { resolveMetaData, getMetaData } = require('./compilerobject');
const loader = require('./loader');
const { getIndex } = require('./output-mapper');
const inProgress = [];

const addExt = filePath => {
    const ext = path.extname(filePath);
    if (!ext || !helper.is(ext, '.js')) {
        filePath += '.js';
    }
    return filePath;
}

/**
 * 
 * @param {*} currentInstance 
 * @param {*} filePath 
 * @param {*} parentPath 
 * @param {*} lazyLoadModulePath 
 * @param {*} isExternalModule 
 * @param {*} importedItem 
 * @param {*} isEntry 
 * @returns 
 */
async function processFile(currentInstance, filePath, parentPath, lazyLoadModulePath, isExternalModule, importedItem, isEntry) {
    const fileDefinition = currentInstance.getFile(filePath);
    if (fileDefinition) {
        // check if module was lazyloaded and registered as requiredModule
        if (currentInstance.isLazyLoadedModule(filePath) && !fileDefinition.lazyLoadModulePath) {
            loader.spinner.fail('');
            const annot = currentInstance.getOutputModule(filePath);
            helper.abort(`\n Error compiling lazyloaded module exported in ${helper.colors.yellow(filePath)}, reasons due to importation of (${helper.colors.yellow(annot.annotations[0].fn)}) in other modules.`);
        }

        return await validateImports(importedItem, fileDefinition.exports, filePath, parentPath);
    }

    /**
     * prevent re-compiling file thats in progress
     * this can occur with below dependency
     * A -> B -> C -> A
     *           
     */
    if (inProgress.includes(filePath)) {
        return;
    }

    inProgress.push(filePath);
    helper.writeline(filePath);
    /**
     * add the resolved filePath to currentInstance for reference
     */
    const fileImpExt = currentInstance.createFileEntry(filePath, isEntry ? parentPath : null, lazyLoadModulePath, isExternalModule);
    const output = {
        type: 'source',
        source: [],
        annotations: [],
        isLazyLoaded: !!lazyLoadModulePath
    };

    let source;

    // Read file source.
    try {
        source = loader.readFile(filePath, false, false, currentInstance.compilerObject.buildOptions.replace);
        source = generateAstSource(extractRequired(currentInstance, source, filePath), fileImpExt);
        if (!isExternalModule) {
            currentInstance.pushToExports(fileImpExt.exports);
        }

        await validateImports(importedItem, fileImpExt.exports, filePath, parentPath);

        /**
         * process importedFiles
         */
        for (const impItem of fileImpExt.imports) {
            await importFile(currentInstance, impItem, filePath, isExternalModule, lazyLoadModulePath);
        }

        const otherScripts = escogen(source.scripts);
        if (!isEntry)
            output.source.push(otherScripts);
        else
            currentInstance.pushGlobalOutPut(otherScripts);
        /**
         * process all file annotations
         */
        await annotationParser(source.annotations, filePath, output, currentInstance);
        inProgress.splice(inProgress.indexOf(filePath), 1);
        if (!isEntry) {
            currentInstance.addOutPutEntry(filePath, output);
        }
    } catch (err) {
        loader.spinner.fail('');
        helper.console.error(`\nError while compiling ${helper.colors.yellow(filePath)} ${parentPath ? ' imported in ' + helper.colors.yellow(parentPath) : ''}`);
        helper.console.warn(`\nReasons: ${err.message || err}`);
        helper.console.write('\nFix errors and try again.\n');
    }
}

/**
 * 
 * @param {*} currentInstance 
 */
async function processLazyLoads(currentInstance) {
    // trigger lazyloaded module
    for (const modulePath of currentInstance.compilerObject.output.lazyLoads) {
        await processFile(currentInstance, modulePath, null, modulePath);
    }
}

/**
 * 
 * @param {*} currentInstance 
 * @param {*} importItem 
 * @param {*} parentPath 
 * @param {*} isExternalModule 
 * @param {*} lazyLoadModulePath 
 */
async function importFile(currentInstance, importItem, parentPath, isExternalModule, lazyLoadModulePath) {
    /**
     * resolve the dependency
     */
    const options = currentInstance.compilerObject.options;
    const resolvedDep = loader.resolveDependency(importItem.source, options.resolve);
    const isLib = helper.is('library', options.type);
    if (!resolvedDep) {
        let importFilePath = addExt(importItem.source);
        /**
         * check for glob import
         */
        if (helper.isContain('*', importFilePath)) {
            return loader.spinner.warn(helper.colors.yellow(`glob patterns not allowed in statement: ${parentPath} -> ${importFilePath}`));
        }
        importFilePath = path.join(parentPath, '..', importFilePath);
        await processFile(currentInstance, importFilePath, parentPath, lazyLoadModulePath, isExternalModule, importItem);
        addAbsolutePath(importItem, importFilePath, isLib);
    } else {
        if (resolvedDep) await resolveMetaData(resolvedDep, importItem);
        else {
            loader.spinner.fail(`unable to resolve dependency ${importItem.source} -> ${parentPath}`);
            helper.console.error('compilation stopped');
        }

        currentInstance.pushGlobalImports(importItem, helper.trimPackageName(importItem.source), resolvedDep);
        
        if (!isLib) {
            await processFile(currentInstance, resolvedDep.source, parentPath, lazyLoadModulePath, true, importItem);
        } else {
            const depMetaData = getMetaData(importItem.source);
            await validateImports(importItem, (depMetaData || {}).exports, importItem.source, parentPath);
        }

        addAbsolutePath(importItem, resolvedDep.source, isLib);
    }
}

function addAbsolutePath(importItem, absolutePath, isLib) {
    if (!isLib) {
        importItem.absolutePath = absolutePath;
    }
}

/**
 * 
 * @param {*} source 
 * @param {*} filePath 
 */
function extractRequired(currentInstance, source, filePath) {
    return source.replace(/(require|lazyload)\((.*?)\)/g, (_, key, value) => {
        value = path.join(filePath, '..', helper.removeSingleQuote(value));
        if (key === 'require') {
            currentInstance.addOutPutEntry(value, {
                type: key,
                path: value,
                source: [loader.readFile(value)]
            });
            return `__required(${getIndex(value)}, 'exports')`;
        } else {
            value = addExt(value);
            currentInstance.pushToLazyLoads(value)
            return `__required.l(${getIndex(value)})`;
        }
    });
}



/**
 * 
 * @param {*} importedItem 
 * @param {*} exported 
 */
async function validateImports(importedItem, exported = [], filePath, parentPath) {
    exported = exported.map(item => item.exported);
    const invalidImport = hasInvalidImport(importedItem, exported);
    if (invalidImport && invalidImport.length) {
        loader.spinner.fail('');
        helper.console.error(`\n no exported name(s) ${helper.colors.yellow(invalidImport.map(item => item.imported).join(' , '))} in ${helper.colors.yellow(filePath)} imported in ${helper.colors.yellow(parentPath)}\n`);
    }
}


/**
 * 
 * @param {*} importItem 
 * @param {*} exportedItem 
 */
function hasInvalidImport(importItem, exportedItem) {
    if (!importItem || importItem.default || importItem.nameSpace || !importItem.specifiers.length) return false;
    return importItem.specifiers.filter(item => !exportedItem.includes(item.imported));
}



exports.compiler = async function (componentsResolver) {
    const filePath = path.join(componentsResolver.compilerObject.options.sourceRoot, componentsResolver.compilerObject.entryFile);
    await processFile(componentsResolver, filePath, null, null, false, null, true);
    await processLazyLoads(componentsResolver);
    loader.spinner.stop(); 
};
/**
 * 
 * @param {*} compilerObject 
 * @param {*} changes 
 */
exports.singleCompiler = async (componentsResolver, changes) => {
    // check if file was previouslyy compiled 
    const components = ['Directive', 'Element', 'Pipe', 'jModule'];
    const {moduleName, lazyLoadModulePath} = componentsResolver.cleanFileEntry(changes.filePath, components)
    await processFile(componentsResolver, changes.filePath, null, lazyLoadModulePath);
    componentsResolver.updateAnnotation(changes.filePath, moduleName, components);
}
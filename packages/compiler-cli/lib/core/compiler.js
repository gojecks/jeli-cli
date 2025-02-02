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
const CompilationException = require('../Exceptions/compilation');
const inProgress = [];

const addExt = filePath => {
    const ext = path.extname(filePath);
    if (!ext || !helper.is(ext, '.js')) {
        filePath += '.js';
    }
    return filePath;
};

const getFilePath = (filePath, fileName) => path.join(filePath, '..', helper.removeSingleQuote(fileName));

/**
 * 
 * @param {*} componentsResolver 
 * @param {*} filePath 
 * @param {*} parentPath 
 * @param {*} lazyLoadModulePath 
 * @param {*} isExternalModule 
 * @param {*} importedItem 
 * @param {*} isEntry 
 * @returns 
 */
async function processFile(componentsResolver, filePath, parentPath, lazyLoadModulePath, isExternalModule, importedItem, isEntry) {
    const fileDefinition = componentsResolver.getFile(filePath);
    if (fileDefinition) {
        // check if module was lazyloaded and registered as requiredModule
        if (componentsResolver.isLazyLoadedModule(filePath) && !fileDefinition.lazyLoadModulePath) {
            loader.spinner.fail('');
            const annot = componentsResolver.getOutputModule(filePath);
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
     * add the resolved filePath to componentsResolver for reference
     */
    const fileAst = componentsResolver.createFileEntry(filePath, isEntry ? parentPath : null, lazyLoadModulePath, isExternalModule);
    const outputAst = {
        type: 'source',
        source: [],
        annotations: [],
        isLazyLoaded: !!lazyLoadModulePath
    };

    let source;
    // Read file source.
    try {
        source = exports.loadSource(filePath, componentsResolver,fileAst, isEntry);
        if (!isExternalModule) {
            componentsResolver.pushToExports(fileAst.exports);
        }

        await validateImports(importedItem, fileAst.exports, filePath, parentPath);
        // process importedFiles
        for (const impItem of fileAst.imports) {
            await importFile(componentsResolver, impItem, filePath, isExternalModule, lazyLoadModulePath);
        }

        const otherScripts = source.raw || escogen(source.scripts);
        if (!isEntry)
            outputAst.source.push(otherScripts);
        else
            componentsResolver.pushGlobalOutPut(otherScripts);
        /**
         * process all file annotations
         */
        await annotationParser(source.annotations, filePath, outputAst, componentsResolver);
        inProgress.splice(inProgress.indexOf(filePath), 1);
        if (!isEntry)
            componentsResolver.addOutPutEntry(filePath, outputAst);
    } catch (err) {
        loader.spinner.fail('');
        helper.console.error(`\nError while compiling ${helper.colors.yellow(filePath)} ${parentPath ? ' imported in ' + helper.colors.yellow(parentPath) : ''}`);
        throw err;
    }
}

/**
 * 
 * @param {*} componentsResolver 
 */
async function processLazyLoads(componentsResolver) {
    // trigger lazyloaded module
    var lazyloadModules = componentsResolver.getLazyLoadedModules();
    for (const modulePath of lazyloadModules) {
        await processFile(componentsResolver, modulePath, null, modulePath);
    }
}

/**
 * 
 * @param {*} componentsResolver 
 * @param {*} importItem 
 * @param {*} parentPath 
 * @param {*} isExternalModule 
 * @param {*} lazyLoadModulePath 
 */
async function importFile(componentsResolver, importItem, parentPath, isExternalModule, lazyLoadModulePath) {
    /**
     * resolve the dependency
     */
    try {
        const options = componentsResolver.compilerObject.options;
        const resolvedDep = loader.resolveDependency(importItem.source, options.resolve);
        const isLib = componentsResolver.compilerObject.isLib;
        if (!resolvedDep) {
            let importFilePath = addExt(importItem.source);
            /**
             * check for glob import
             */
            if (helper.isContain('*', importFilePath))
                return loader.spinner.warn(helper.colors.yellow(`glob patterns not allowed in statement: ${parentPath} -> ${importFilePath}`));

            importFilePath = path.join(parentPath, '..', importFilePath);
            await processFile(componentsResolver, importFilePath, parentPath, lazyLoadModulePath, isExternalModule, importItem);
            addAbsolutePath(importItem, importFilePath, isLib);
        } else {
            await resolveMetaData(resolvedDep, importItem);
            componentsResolver.pushGlobalImports(importItem, helper.trimPackageName(importItem.source), resolvedDep);

            if (!isLib) {
                await processFile(componentsResolver, resolvedDep.source, parentPath, lazyLoadModulePath, true, importItem);
            } else {
                const depMetaData = getMetaData(importItem.source);
                await validateImports(importItem, (depMetaData || {}).exports, importItem.source, parentPath);
            }

            addAbsolutePath(importItem, resolvedDep.source, isLib);
        }
    } catch (exception) {
        helper.console.error('compilation stopped');
        helper.abort(`unable to resolve dependency ${importItem.source} -> ${parentPath}\n Reasons: ${exception.message || exception}`);

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
function extractRequired(componentsResolver, source, filePath) {
    return source.replace(/(require|lazyload)\((.*?)\)/g, (_, key, value) => {
        if (key === 'require') {
            const ext = path.extname(value);
            if (ext) {
                value = getFilePath(filePath, value);
                componentsResolver.addOutPutEntry(value, {
                    type: key,
                    path: value,
                    source: [loader.readFile(value)]
                });
                return `__required(${getIndex(value)}, 'exports')`;
            }
            // return value for a normal injector
            return `__required(${value})`;
        } else {
            value = addExt(getFilePath(filePath, value));
            componentsResolver.pushToLazyLoads(value)
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


exports.loadSource = (filePath, componentsResolver, fileAst, isEntry) => {
    const source = loader.readFile(filePath, false, false, componentsResolver.compilerObject.buildOptions.replace);
    // check for already compiled script
    if (['define.amd'].some(a => helper.isContain(a, source))) {
        return {
            raw: source,
            annotations: [],
            sourceType: 'script'
        }; 
    }

    return generateAstSource(extractRequired(componentsResolver, source, filePath), fileAst, isEntry);
};

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
    const { moduleName, lazyLoadModulePath } = componentsResolver.cleanFileEntry(changes.filePath, components)
    await processFile(componentsResolver, changes.filePath, null, lazyLoadModulePath);
    componentsResolver.updateAnnotation(changes.filePath, moduleName, components);
}
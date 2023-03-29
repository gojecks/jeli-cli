const path = require('path');
const helper = require('@jeli/cli/lib/utils');
const fs = require('fs-extra');
const lodashTemplate = require('lodash.template');
const uglify = require('uglify-js');
const { getIndex } = require('./output-mapper');
const symbol = "ϕ";
const PATTERN = {
    MODULE: 'MODULE',
    UMD: 'UMD',
    DEFAULT: 'DEFAULT'
};
const cssFileHolder = new Map();
let nodeSass = null;

/**
 * handle node sass error
 */
try {
    nodeSass = require('node-sass');
} catch (e) {
    helper.abort(`\n${e.message}`);
}

exports.PATTERN = PATTERN;
/**
 * 
 * @param {*} fileName 
 * @param {*} options 
 */
exports.writeFile = async function (filePath, data) {
    try {
        const dirName = path.dirname(filePath);
        // check if folder already exist
        // else create one
        if (!fs.existsSync(dirName)) {
            fs.mkdirpSync(dirName);
        }

        fs.writeFileSync(filePath, data);
        // Print a success message.
        helper.console.success(`generated file "${path.basename(filePath)}" size: (${helper.colors.yellow((data.length / 1024).toFixed(2) + 'kb')}) `);
    } catch (e) {
        helper.console.error(`unable to save file, please try again`);
        helper.abort(e);
    }
}


/**
 * 
 * @param {*} filePath 
 * @param {*} compilerObject 
 */
exports.generateBundleData = async function (compilerObject, fileNames) {
    /**
     * existing and new packageJSON path
     */
    const existingPackageJSON = path.join(compilerObject.options.sourceRoot, compilerObject.entryFile, '..', './package.json');
    const outputPackageJSON = path.join(compilerObject.options.output.folder, compilerObject.entryFile, '..', './package.json');
    /**
     * write the bundle path to packageJson object
     */
    let packageJSON = Object.keys(fileNames).reduce((accum, type) => {
        accum[type === 'UMD' ? 'main' : type.toLowerCase()] = `${getRelativePath(fileNames[type], path.dirname(outputPackageJSON))}`;
        return accum;
    }, {});

    /**
     * check for existing packageJSON data
     * then extend the existing data
     * 
     */
    if (fs.existsSync(existingPackageJSON)) {
        packageJSON = Object.assign(JSON.parse(fs.readFileSync(existingPackageJSON)), packageJSON);
    }

    if (compilerObject.buildOptions.version) {
        packageJSON.version = compilerObject.buildOptions.version;
    }

    if (compilerObject.buildOptions.hasStyles) {
        packageJSON.stylesPath = 'bundles/styles.css';
    }

    packageJSON.peerDependencies = packageJSON.peerDependencies || {};
    for (const prop in compilerObject.globalImports) {
        const globImp = compilerObject.globalImports[prop];
        if (globImp.name)
            packageJSON.peerDependencies[globImp.name] = verifyVersion(globImp.version);
    }

    packageJSON.metaDataPath = 'metadata.json';
    exports.writeFile(outputPackageJSON, JSON.stringify(packageJSON, null, 2));
    saveCompilerData(compilerObject);
}

/**
 * 
 * @param {*} compilerObject 
 * @param {*} moduleName 
 */
exports.outputLibraryFiles = async function (compilerObject, moduleName) {
    const files = {};
    const scriptBody = extractSourceCode(compilerObject, true);
    for (const type of compilerObject.options.output.patterns) {
        files[type] = await buildByType(type, scriptBody, moduleName, compilerObject);
    }

    await exports.copyFiles(compilerObject);
    compilerObject.buildOptions.hasStyles = await writeCss(compilerObject.options, true);
    await exports.generateBundleData(compilerObject, files);
};

/**
 * 
 * @param {*} filesToCopy 
 */
exports.copyFiles = async compilerObject => {
    if (compilerObject.options.output.copy) {
        for (const file of compilerObject.options.output.copy) {
            try {
                const dest = `${compilerObject.options.output.folder}${file.dest || (path.basename(file.src) + '/')}`;
                fs.copySync(file.src, dest, {
                    recursive: true,
                    overwrite: true
                });
            } catch (exception) { }
        }
    }
}

exports.copyAndUpdateAssetsFile = async (filePath, compilerObject, item) => {
    if (!fs.existsSync(filePath)) return;
    const basename  = path.basename(item.src);
    const dest = `${compilerObject.options.output.folder}${basename}${filePath.split(basename)[1]}`;
    try {
        fs.copySync(filePath, dest, {
            recursive: true,
            overwrite: true
        });
    } catch (e) { }
}

/**
 * 
 * @param {*} compilerObject 
 * @param {*} changes 
 */
exports.outputApplicationFiles = async function (compilerObject, changes) {
    const getBootStrapModule = filePath => {
        for(const imp of compilerObject.files[filePath].imports) {
            const fn = imp.specifiers[0].local;
            if (compilerObject.jModule[fn]){
                return imp.absolutePath;
            }
        }
    };

    /**
     * generate the script file with below conditions
     * changes to .html .js .json
     */
    if (!changes || !changes.isStyles) {
        const changesFilePath = changes ? changes.filePath : null;
        const isLazyLoaded = changesFilePath && compilerObject.output.modules[changesFilePath].isLazyLoaded;
        const isProdBuild = (compilerObject.buildOptions && compilerObject.buildOptions.prod);
        if (!isLazyLoaded) {
            const bootStrapFilePath = path.join(compilerObject.options.sourceRoot, compilerObject.entryFile);
            const bootStrapModule = getBootStrapModule(bootStrapFilePath);
            const main = await resolveModules(compilerObject, changesFilePath, bootStrapModule);
            const fileName = `${compilerObject.options.output.folder}${compilerObject.entryFile}`;
            const deps = [compilerObject.output.global];
            const bstDeps = extendImportExport(bootStrapFilePath, compilerObject, deps);
            const entry = writeGlobalImports(deps.join(''), bstDeps.$, false);
            const buildArgs = JSON.stringify(compilerObject.buildOptions);
            let script = loadTemplate('default', { entry, main, buildArgs });
            await outputJSFiles(fileName, script, isProdBuild);
        } else {
            const lazyLoadModulePath = compilerObject.files[changesFilePath].lazyLoadModulePath;
            if(changesFilePath && !compilerObject.output.lazyLoads.includes(lazyLoadModulePath)) {
                compilerObject.output.lazyLoads.push(lazyLoadModulePath);
            }
        }

        await writeLazyLoadModules(compilerObject, isProdBuild);
    }

    if (!changes) {
        await exports.copyFiles(compilerObject);
        await writeCss(compilerObject.options);
        if (compilerObject.options.output.view) {
            exports.saveApplicationView(compilerObject);
        }
        // saveCompilerData(compilerObject);
    }
}

exports.saveApplicationView = async function (compilerObject) {
    const viewFilePath = path.join(compilerObject.options.sourceRoot, compilerObject.options.output.view);
    if (fs.existsSync(viewFilePath)) {
        const files = ['styles.js', compilerObject.entryFile];
        const html = fs.readFileSync(viewFilePath, 'utf8').replace(/<\/body>/, _ => {
            return files.map(file => `<script src="./${file}" type="text/javascript"></script>`).join('\n') + '\n' + _;
        });

        fs.writeFileSync(`${compilerObject.options.output.folder}${compilerObject.options.output.view}`, html);
    }
};

/**
 * 
 * @param {*} config 
 * @param {*} folder 
 */
exports.pushStyle = (config, append) => {
    let result = parseStyle(config);
    if (!result || !(result.substring(1, result.length - 2))) return;
    result = helper.stringifyContent(result);

    if (append) {
        append.push(result);
    } else {
        cssFileHolder.set(config.elementFilePath, { result, config });
    }
}

/**
 * 
 * @param {*} compilerObject 
 * @param {*} changes 
 */
exports.styleChanges = async (compilerObject, changes) => {
    const elementFilePath = compilerObject.output.styles[changes.filePath];
    const existingContent = cssFileHolder.get(elementFilePath);
    this.pushStyle(existingContent ? existingContent.config : {
        styleUrl: changes.filePath,
        elementFilePath
    });

    await writeCss(compilerObject.options);
};

/**
 * 
 * @param {*} script 
 * @param {*} sourceMap 
 */
function obfuscate(script, sourceMap) {
    return uglify.minify(script, {
        nameCache: null, // or specify a name cache object
        toplevel: false,
        ie8: false,
        warnings: false,
        sourceMap,
        compress: {
            sequences: true,
            dead_code: true,
            conditionals: true,
            booleans: true,
            unused: true,
            if_return: true,
            join_vars: true,
            drop_console: false,
            properties: false
        },
        output: {
            preserve_line: false,
            beautify: false,
            max_line_len: 400
        }
    });
}

/**
 * 
 * @param {*} annotations 
 */
function isModule(annotations) {
    return annotations && (annotations.find(annot => annot.isModule) || {}).fn;
}

/**
 * 
 * @param {*} template 
 * @returns 
 */
function getTemplate(template) {
    template = fs.readFileSync(path.resolve(__filename, `../../utils/templates/${template}.jeli`), { encoding: 'utf8' });
    return lodashTemplate(template);
}

/**
 * 
 * @param {*} template 
 * @param {*} data 
 */
function loadTemplate(template, data) {
    var templateParser = getTemplate(template);
    return templateParser(data);
}

/**
 * 
 * @param {*} needle 
 * @param {*} against 
 */
function getRelativePath(needle, against) {
    needle = needle.split('/');
    against = against.split('/');

    for (var i = 0; i < (against.length - needle.length); i++) {
        needle.unshift('..');
    }

    return needle.join('/');
}

function verifyVersion(version) {
    if (version && !version.toLowerCase().includes('placeholder')) {
        return version;
    }

    return 'latest';
}

/**
 * 
 * @param {*} compilerObject 
 */
function saveCompilerData(compilerObject) {
    /**
     * remove unwanted data from compilerObject
     * before saving it
     */
    delete compilerObject.options;
    delete compilerObject.output;
    delete compilerObject.buildOptions;
    delete compilerObject.globalImports;
    const metaDataFilePath = path.join(compilerObject.options.output.folder, compilerObject.entryFile, '..', './metadata.json');
    exports.writeFile(metaDataFilePath, JSON.stringify(compilerObject, null, 2).replace(/[']/g, ''));
}

function extractSourceCode(compilerObject, isLib) {
    const sourceCode = [];
    if (isLib) {
        Object.keys(compilerObject.output.modules).forEach(filePath => {
            sourceCode.push(compilerObject.output.modules[filePath].source.join(''));
        });
    }

    sourceCode.concat(compilerObject.output.global);
    return sourceCode.join('\n');
}

/**
 * 
 * @param {*} fileName 
 * @param {*} script 
 * @param {*} isProd 
 */
async function outputJSFiles(fileName, script, isProd) {
    /**
     * obfuscate code if prod flag is sent
     */
    if (isProd) {
        helper.console.write('obfuscating code...');
        const uglifiedScript = obfuscate(script);
        if (!uglifiedScript.error) {
            script = uglifiedScript.code;
        } else {
            helper.console.error(`obfuscation failed for this file -> ${fileName}`);
        }
    }

    await exports.writeFile(fileName, script);
}

/**
 * 
 * @param {*} type 
 */
async function buildByType(type, scriptBody, moduleName, compilerObject) {
    const trimmedName = helper.trimPackageName(moduleName);
    const isModule = (type === PATTERN.MODULE);
    const scriptDefinition = {
        scriptBody,
        header: '',
        footer: createModuleExportation(compilerObject.exports, isModule),
        moduleName: `'${moduleName}'`,
        importsAMD: '',
        importsCJS: '',
        globalArgs: '',
        args: '',
        buildOptions: JSON.stringify(compilerObject.buildOptions)
    };

    const imports = createModuleImportation(compilerObject.globalImports, isModule);
    if (!isModule) {
        const globalName = `global.${trimmedName.first}`;
        scriptDefinition.globalName = globalName;
        scriptDefinition.globalNameSpace = `${trimmedName.nameSpace ? ', ' + globalName + '["' + trimmedName.nameSpace + '"] = ' + globalName + '["' + trimmedName.nameSpace + '"] || {}' : ''}`;
        scriptDefinition.importsAMD = imports.amd.join(', ');
        scriptDefinition.importsCJS = imports.cjs.join('');
        scriptDefinition.globalArgs = imports.global.join(', ');
        scriptDefinition.args = imports.args.join(', ');
    } else {
        scriptDefinition.header = imports;
    }

    const fileName = `${trimmedName.name}-${type.toLowerCase()}`;
    const filePath = `bundles/${fileName}.js`;
    const script = loadTemplate(type.toLowerCase(), scriptDefinition);
    const outputFolder = compilerObject.options.output.folder;
    // overwrite template
    await exports.writeFile(`${outputFolder}/${filePath}`, script);
    /**
     * uglify script if required
     */
    if (!isModule) {
        const uglifyFilename = `${fileName}.min.js`;
        const uglifiedScript = obfuscate(script, {
            url: `${uglifyFilename}.map`
        });

        if (!uglifiedScript.error) {
            const minFilePath = `${outputFolder}/${path.join(filePath, `../${uglifyFilename}`)}`;
            await exports.writeFile(minFilePath, uglifiedScript.code);
            await exports.writeFile(`${minFilePath}.map`, uglifiedScript.map);
        } else {
            helper.console.error(`obfuscation failed for this file -> ${fileName}`);
        }
    }
    return filePath;
}

/**
 * 
 * @param {*} imports 
 * @param {*} isModule 
 * @returns 
 */
function createModuleImportation(imports, isModule) {
    const keys = Object.keys(imports);
    if (isModule) {
        return keys.map(key => {
            const specifiers = imports[key].specifiers;
            return `import ${specifiers.length ? ('{ ' + specifiers.join(', ') + '} from ') : ''}'${key}';\n`;
        }).join('');
    } else {
        return keys.reduce((accum, key) => {
            const specifier = imports[key];
            accum.amd.push(`'${key}'`);
            accum.cjs.push(`, require('${key}')`);
            accum.global.push(`global.${specifier.output.first}${specifier.output.nameSpace ? "['" + specifier.output.nameSpace + "']" : ''}`);
            accum.args.push(`${specifier.output.arg}`);
            return accum;
        }, {
            amd: [],
            cjs: [''],
            global: [''],
            args: ['']
        })
    }
}

/**
 * 
 * @param {*} specifiers 
 * @param {*} isModule 
 */
function createModuleExportation(specifiers, isModule) {
    if (isModule) {
        return `export { ${specifiers.map(exp => `${exp.exported}${exp.exported != exp.local ? ' as ' + exp.local : ''}`).join(' , ')} }`;
    } else {
        return specifiers.map(exp => `exports.${exp.exported} = ${exp.local};`).join('\n')
    }
}

/**
 * 
 * @param {*} compilerObject 
 * @param {*} importItems 
 * @param {*} output 
 * @param {*} isExternalModule 
 * @returns 
 */
function _writeImport(compilerObject, importItems, output, isExternalModule = true) {
    const defaultModuleImports = { $: {} };
    const importedCache = {};
    const isImported = (i, n) => {
        if (importedCache[i]) {
            if (importedCache[i].includes(n)) {
                return true;
            }
            importedCache[i].push(n);
        } else {
            importedCache[i] = [n];
        }

        return false;
    };

    for (const importItem of importItems) {
        let index = getIndex(importItem.absolutePath);
        if (importItem.default) {
            const imported = importItem.specifiers[0].imported;
            if (compilerObject.output.modules.hasOwnProperty(importItem.absolutePath) && !isImported(index, imported)) {
                /**
                 * empty module file
                 * files that imports and exports only
                 */
                if (!output.join('')) {
                    defaultModuleImports[imported] = `__required(${index}, 'default')`;
                } else {
                    output.unshift(`var ${imported} = __required(${index}, 'default');\n`);
                }

            }
        } else if (importItem.nameSpace) {
            if (!isImported(index, importItem.specifiers[0].local))
                output.unshift(`var ${importItem.specifiers[0].local} = __required(${index}${importItem.noExports ? '' : ",'exports'"});\n`);
        } else if (compilerObject.globalImports.hasOwnProperty(importItem.source)) {
            const globalDepMeta = compilerObject.globalImports[importItem.source];
            index = getIndex(globalDepMeta.absolutePath);
            if (globalDepMeta.default) {
                output.unshift(`var ${importItem.specifiers[0].imported} = __required(${index}, 'default');\n`);
            }else {
                if (!isExternalModule) {
                    defaultModuleImports.$[globalDepMeta.output.arg] = defaultModuleImports.$[globalDepMeta.output.arg] || [];
                    importItem.specifiers.forEach(specifier => {
                        if (!defaultModuleImports.$[globalDepMeta.output.arg].includes(specifier.imported))
                            defaultModuleImports.$[globalDepMeta.output.arg].push(specifier.imported);
                    });
                } else {
                    importItem.specifiers.forEach(specifier => {
                        if (!isImported(index, specifier.imported))
                            output.unshift(`var ${specifier.local} = ${globalDepMeta.output.arg}.${specifier.imported};\n`);
                    });
                }
                output.unshift(`var ${globalDepMeta.output.arg} = __required(${index});\n`);
            }
        } else if (compilerObject.files.hasOwnProperty(importItem.absolutePath)) {
            importItem.specifiers.forEach(specifier => {
                if (!isImported(index, specifier.imported))
                    output.unshift(`var ${specifier.local} = __required(${index}, '${specifier.imported || specifier.local}');\n`);
            });
        }
    }

    return defaultModuleImports;
}

/**
 * 
 * @param {*} exportedItems 
 * @param {*} defaultModuleImports 
 * @param {*} output 
 */
function _writeExports(exportedItems, defaultModuleImports, output) {
    // parse exports
    for (const exp of exportedItems) {
        if (helper.is(exp.exported, 'default')) {
            let value = output.pop();
            /**
             * export defaut contains an identifier
             * e.g export default IDENTIFIER;
             * append the script before the export declaration
             */
            if (exp.local !== exp.exported) {
                output.push(`exports.default = ${exp.local};\n${value}`);
            } else {
                output.push(`exports.default = ${value}`);
            }
        } else {
            if (!defaultModuleImports[exp.local]) {
                output.unshift(`__required.r(exports, '${exp.exported}', () => ${exp.local});\n`);
            } else {
                output.unshift(`\nexports.${exp.exported} = ${defaultModuleImports[exp.local]};`)
            }
        }
    }
}

/**
 * 
 * @param {*} filePath 
 * @param {*} compilerObject 
 * @param {*} output 
 * @param {*} isBootStrapModule 
 * @returns 
 */
function extendImportExport(filePath, compilerObject, output, isBootStrapModule) {
    const metaData = compilerObject.files[filePath];
    const defaultModuleImports = _writeImport(compilerObject, metaData.imports, output, true);
    _writeExports(metaData.exports, defaultModuleImports, output);
    return defaultModuleImports;
}

/**
 * 
 * @param {*} sourceCode 
 * @param {*} globalImports 
 * @param {*} delify 
 * @returns 
 */
function writeGlobalImports(sourceCode, globalImports, delify = true) {
    if (globalImports) {
        const delimeter = delify ? ['%', '%'] : ['', ''];
        for (const ns in globalImports) {
            globalImports[ns].forEach(dep => {
                sourceCode = sourceCode.replace(new RegExp(delimeter.join(dep), 'g'), _ => `${ns}.${dep}`)
            });
        }
    }

    return sourceCode;
}


/**
 * 
 * @param {*} compilerObject 
 * @param {*} fileChanged 
 * @param {*} bootStrapModule 
 * @returns 
 */
async function resolveModules(compilerObject, fileChanged, bootStrapModulePath) {
    const files = [];
    const filePaths = Object.keys(compilerObject.output.modules);
    let req = null;
    /**
     * 
     * @param {*} req 
     * @param {*} filePath 
     * @param {*} allowBuild 
     * @returns 
     */
    async function generateModuleDeps(filePath, allowBuild) {
        const isRequired = (req.type === 'require');
        if (allowBuild) {
            let defaultModuleImports = {};
            if (!isRequired) {
                defaultModuleImports = extendImportExport(filePath, compilerObject, req.source, (bootStrapModulePath == filePath));
            } else {
                req.source.unshift(`module.exports = `)
            }
            // rewrite source to string 
            req.source = writeGlobalImports(req.source.join(''), defaultModuleImports.$);
        }
        return `(module, exports, __required, global) => {\n"use strict";\n${req.source}\n}`;
    }


    for (const filePath of filePaths) {
        req = compilerObject.output.modules[filePath];
        if (!req.isLazyLoaded) {
            const allowBuild = (!fileChanged || (fileChanged && helper.is(fileChanged, filePath)));
            const sourceCode = await generateModuleDeps(filePath, allowBuild);
            files.push(`${getIndex(filePath)} : ${sourceCode}`);
        }
    }

    return `{${files.join(',\n')}}`;
}

/**
 * 
 * @param {*} compilerObject 
 * @param {*} modulePath 
 * @param {*} sourceDefinition 
 * @returns 
 */
function extractModuleImpExp(compilerObject, modulePath, sourceDefinition) {
    const definition = compilerObject.files[modulePath];
    // get module declarations from jModule attribute
    const declarations = compilerObject[sourceDefinition.annotations[0].type][sourceDefinition.annotations[0].fn];
    // concat the ctors for jModule
    const fnDefinitions = (declarations.services || []).concat(declarations.selectors || []);
    const cache = { imp: ["@jeli/core"], exp: [] };
    const ret = { imp: [{ source: "@jeli/core", specifiers: [] }], exp: [], replace: {}, localImp: [], ns: [] };
    const isLazyLoaded = filePath => compilerObject.files[filePath].lazyLoadModulePath;
    /**
     * 
     * @param {*} item 
     * @param {*} type 
     * @param {*} g 
     */
    const pushItem = (item, type, g) => {
        if (!cache.imp.includes(item.source)) {
            ret[type].push({ source: item.source, absolutePath: item.absolutePath, specifiers: [] });
            cache.imp.push(item.source);
        }
        // check global imports
        if (g) {
            const vi = ret[type].find(c => c.source === item.source);
            vi.specifiers.push.apply(vi.specifiers, item.specifiers);
        }
    };

    for (item of definition.imports) {
        const local = (item.specifiers.length && item.specifiers[0].local);
        const impIndex = fnDefinitions.indexOf(local);
        // !local || impIndex > -1
        if (isLazyLoaded(item.absolutePath)) {
            ret.exp.splice(impIndex, 0, item);
            cache.exp.push(item.absolutePath);
            // check what each file imports 
            const itemImps = compilerObject.files[item.absolutePath];
            itemImps.imports.forEach(cItem => {
                if (!compilerObject.globalImports.hasOwnProperty(cItem.source)) {
                    if (!isLazyLoaded(cItem.absolutePath)) {
                        ret.imp.push(cItem);
                    } else if (!cache.exp.includes(cItem.absolutePath)) {
                        if (cItem.nameSpace) {
                            ret.ns.push(cItem);
                            ret.imp.push(cItem);
                        } else {
                            ret.localImp.push(cItem);
                        }
                        cache.exp.push(cItem.absolutePath);
                    }
                } else {
                    pushItem(cItem, 'imp', true);
                }
            });
        } else {
            pushItem(item, 'imp', true);
        }
    }

    return ret
}

/**
 * 
 * @param {*} compilerObject 
 * @param {*} impExp 
 * @param {*} output 
 */
function _writeModuleStream(compilerObject, impExp, output, isNs) {
    for (const item of impExp) {
        const req = compilerObject.output.modules[item.absolutePath];
        if (isNs) {
            output.push(`${getIndex(item.absolutePath)} : module => {\n${req.source.join('')}\n}`);
        } else {
            output.push(req.source.join(''));
        }
    }
}

/**
 * 
 * @param {*} compilerObject 
 * @param {*} isProd 
 * @returns 
 */
async function writeLazyLoadModules(compilerObject, isProd) {
    var templateParser = getTemplate('lazyload');
    while (compilerObject.output.lazyLoads.length) {
        modulePath = compilerObject.output.lazyLoads.pop();
        const output = [];
        const sourceDefinition = compilerObject.output.modules[modulePath];
        try {
            const impExp = extractModuleImpExp(compilerObject, modulePath, sourceDefinition);
            const defaultModuleImports = _writeImport(compilerObject, impExp.imp, output, true);
            const moduleName = sourceDefinition.annotations[0].fn;
            _writeExports([{ local: moduleName, exported: moduleName }], defaultModuleImports, output);
            _writeModuleStream(compilerObject, impExp.localImp.concat(impExp.exp), output);
            output.push(sourceDefinition.source.join(''));
            const fileName = `${compilerObject.options.output.folder}${getIndex(modulePath)}.js`;
            const modules = [`${getIndex(modulePath)} : (module, exports, __required, global) => {\n${output.join('')}}`];
            _writeModuleStream(compilerObject, impExp.ns, modules, true);
            const sourceCode = writeGlobalImports(`{\n${modules.join(',\n')}\n}`, defaultModuleImports.$);
            await outputJSFiles(fileName, templateParser({ sourceCode }), isProd);
        } catch(e) {
            console.log(`[OutPut] Error generating chunk module ${modulePath}, please try again`);
        }
    }
}

function parseStyle(config) {
    const style = config.styleUrl ? fs.readFileSync(config.styleUrl, 'utf8') : config.style;
    if (!style) return undefined;
    try {
        return nodeSass.renderSync({
            data: attachSelector(style),
            outputStyle: 'compressed',
            outFile: config.outFile,
            sourceMap: false,
            importer: urlLoader
        }).css.toString();
    } catch (e) {
        console.log(`styling error: ${e.message || e} for ${config.styleUrl}`);
        return "";
    }


    /**
     * 
     * @param {*} url 
     * @param {*} prev 
     * @param {*} done 
     */
    function urlLoader(url, prev, done) {
        // url is the path in import as is, which LibSass encountered.
        // prev is the previously resolved path.
        // done is an optional callback, either consume it or return value synchronously.
        // this.options contains this options hash
        const filePath = path.resolve(prev, '..', path.dirname(config.styleUrl), url);
        let content = '';
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            helper.console.error(`unable to read file ${helper.colors.yellow(filePath)} imported in ${helper.colors.yellow(config.styleUrl)} `);
        }

        return ({
            contents: attachSelector(content)
        });
    }

    function attachSelector(result) {
        return (result ? (config.selector ? `${config.selector}{${result}}` : result) : undefined);
    }
}

/**
 * 
 * @param {*} options 
 */
async function writeCss(options, isLib = false) {
    let styles = [];
    if (options.output.styles) {
        for (const style of options.output.styles) {
            exports.pushStyle({
                styleUrl: style
            }, styles);
        }
    }

    cssFileHolder.forEach(css => { if (css.result) styles.push(css.result); });
    let outputFilePath = `${options.output.folder}/styles.js`;
    if (!isLib) {
        styles = loadTemplate('css', { styles });
    } else {
        outputFilePath = `${options.output.folder}/bundles/styles.css`;
        styles = styles.map(c => c.substring(1, c.length - 1)).join('');
    }

    if (styles.length) {
        await exports.writeFile(outputFilePath, styles);
        styles = '';
        return true;
    }
}
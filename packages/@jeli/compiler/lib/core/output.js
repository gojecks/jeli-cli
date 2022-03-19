const path = require('path');
const helper = require('@jeli/cli-utils');
const fs = require('fs-extra');
const lodashTemplate = require('lodash.template');
const uglify = require('uglify-js');
const nodeSass = require('node-sass');
const symbol = "ϕ";

const PATTERN = {
    MODULE: 'MODULE',
    UMD: 'UMD',
    DEFAULT: 'DEFAULT'
};
const cssFileHolder = new Map();

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
 * @param {*} template 
 * @param {*} data 
 */
function loadTemplate(template, data) {
    var templateData = fs.readFileSync(path.resolve(__filename, `../../utils/templates/${template}.jeli`), { encoding: 'utf8' });
    templateData = lodashTemplate(templateData)(data);
    return templateData;
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

exports.PATTERN = PATTERN;
/**
 * 
 * @param {*} fileName 
 * @param {*} options 
 */
exports.writeFile = async function(filePath, data) {
    try {
        const dirName = path.dirname(filePath);
        // check if folder already exist
        // else create one
        if (!fs.existsSync(dirName)) {
            fs.mkdirpSync(dirName);
        }

        fs.writeFileSync(filePath, data);

    } catch (e) {
        helper.console.error(`unable to save file, please try again`);
        helper.abort(e);
    } finally {
        // Print a success message.
        helper.console.success(`generated file "${ path.basename(filePath) }" size: (${helper.colors.yellow((data.length/1024).toFixed(2)+ 'kb')}) `);
    }
}


/**
 * 
 * @param {*} filePath 
 * @param {*} compilerObject 
 */
exports.generateBundleData = async function(compilerObject, fileNames) {
    /**
     * existing and new packageJSON path
     */
    const existingPackageJSON = path.join(compilerObject.options.sourceRoot, compilerObject.entryFile, '..', './package.json');
    const outputPackageJSON = path.join(compilerObject.options.output.folder, compilerObject.entryFile, '..', './package.json');
    /**
     * write the bundle path to packageJson object
     */
    let packageJSON = Object.keys(fileNames).reduce((accum, type) => {
        accum[type === 'UMD' ? 'main' : type.toLowerCase()] = `${getRelativePath(fileNames[type], path.dirname(outputPackageJSON)) }`;
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

    packageJSON.peerDependencies = packageJSON.peerDependencies || {};
    for (const prop in compilerObject.globalImports) {
        const globImp = compilerObject.globalImports[prop];
        if (globImp.name)
            packageJSON.peerDependencies[globImp.name] = verifyVersion(globImp.version);
    }

    exports.writeFile(outputPackageJSON, JSON.stringify(packageJSON, null, 2));
    saveCompilerData(compilerObject);
}

/**
 * 
 * @param {*} type 
 */
async function buildByType(type, scriptBody, moduleName, compilerObject) {
    const trimmedName = helper.trimPackageName(moduleName);
    const scriptDefinition = {
        scriptBody,
        header: '',
        footer: '\n/** generated exports **/\n',
        moduleName: `'${moduleName}'`,
        importsAMD: '',
        importsCJS: '',
        globalArgs: '',
        args: '',
        buildOptions: JSON.stringify(compilerObject.buildOptions)
    };
    const imports = Object.keys(compilerObject.globalImports);
    /**
     * switch between module types
     */
    switch (type) {
        case (PATTERN.MODULE):
            if (compilerObject.exports.length) {
                const _export = compilerObject.exports.map(exp => `${exp.exported}${exp.exported != exp.local ? ' as ' +  exp.local  : ''}`);
                scriptDefinition.footer = `export { ${_export.join(' , ')} }`;
            }

            if (imports.length) {
                scriptDefinition.header = imports.map(key => {
                    const specifiers = compilerObject.globalImports[key].specifiers;
                    return `import ${specifiers.length ? ('{ ' + specifiers.join(', ') + '} from ') : '' }'${key}';\n`;
                }).join('');
            }

            break;
        case (PATTERN.UMD):
            const globalName = `global.${trimmedName.first}`;
            scriptDefinition.globalName = globalName;
            scriptDefinition.globalNameSpace = `${trimmedName.nameSpace ? ', '+globalName + '["'+ trimmedName.nameSpace + '"] = '+globalName + '["'+ trimmedName.nameSpace + '"] || {}' : ''}`;

            if (compilerObject.exports.length) {
                scriptDefinition.footer = compilerObject.exports
                    .map(exp => `exports.${exp.exported} = ${exp.local};\n`)
                    .join('');
            }

            if (imports.length) {
                const args = imports.reduce((accum, key) => {
                    const config = compilerObject.globalImports[key];
                    accum.amd.push(`'${key}'`);
                    accum.cjs.push(`, require('${key}')`);
                    accum.global.push(`global.${config.output.first}${config.output.nameSpace ? "['" + config.output.nameSpace + "']" : ''}`);
                    accum.args.push(`${config.output.arg}`);
                    return accum;
                }, {
                    amd: [],
                    cjs: [''],
                    global: [''],
                    args: ['']
                });
                scriptDefinition.importsAMD = args.amd.join(', ');
                scriptDefinition.importsCJS = args.cjs.join('');
                scriptDefinition.globalArgs = args.global.join(', ');
                scriptDefinition.args = args.args.join(', ');
            }
            break;
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
    if (helper.is(PATTERN.UMD, type)) {
        const uglifyFilename = `${fileName}.min.js`;
        const uglifiedScript = obfuscate(script, {
            url: `${uglifyFilename}.map`
        });

        if (!uglifiedScript.error) {
            const minFileName = path.join(filePath, `../${uglifyFilename}`);
            await exports.writeFile(`${outputFolder}/${minFileName}`, uglifiedScript.code);
            await exports.writeFile(`${outputFolder}/${minFileName}.map`, uglifiedScript.map);
        } else {
            helper.console.error(`obfuscation failed for this file -> ${fileName}`);
        }
    }
    return filePath;
};

exports.outputLibraryFiles = async function(compilerObject, scriptBody, moduleName) {
    const files = {};
    for (const type of compilerObject.options.output.patterns) {
        files[type] = await buildByType(type, scriptBody, moduleName, compilerObject);
    }

    await exports.copyFiles(compilerObject);
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
                var dest = `${compilerObject.options.output.folder}${file.dest || (path.basename(file.src) + '/')}`;
                fs.copySync(file.src, dest, {
                    recursive: true,
                    overwrite: true
                });
            } catch (exception) {}
        }
    }
}

/**
 * 
 * @param {*} compilerObject 
 * @param {*} scriptBody 
 * @param {*} changes 
 */
exports.outputApplicationFiles = async function(compilerObject, scriptBody, changes) {
    /**
     * generate the script file with below conditions
     * changes to .html .js .json
     */
    if (!changes || !changes.isStyles) {
        const modules = await resolveModules(compilerObject, changes && changes.filePath);
        const fileName = `${compilerObject.options.output.folder}${compilerObject.entryFile}`;
        const deps = [scriptBody];
        const bootStrapFilePath = path.join(compilerObject.options.sourceRoot, compilerObject.entryFile);
        await extendImportExport(bootStrapFilePath, compilerObject, deps);
        let script = loadTemplate('default', { entry: deps.join(''), modules });
        /**
         * obfuscate code if prod flag is sent
         */
        if (compilerObject.buildOptions && compilerObject.buildOptions.prod) {
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

    if (!changes) {
        await exports.copyFiles(compilerObject);
        await writeCss(compilerObject.options, changes);
        if (compilerObject.options.output.view) {
            exports.saveApplicationView(compilerObject);
        }
    }
}

exports.saveApplicationView = async function(compilerObject) {
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
 * @param {*} filePath 
 * @param {*} compilerObject 
 * @param {*} output 
 */
async function extendImportExport(filePath, compilerObject, output, isModule) {
    const metaData = compilerObject.files[filePath];
    const defaultModuleImports = {};
    metaData.imports.forEach(importItem => {
        if (importItem.default) {
            if (compilerObject.output.modules.hasOwnProperty(importItem.absolutePath)) {
                /**
                 * empty module file
                 * files that imports and exports only
                 */
                if (!output.join('')) {
                    defaultModuleImports[importItem.specifiers[0].imported] = `__required('${importItem.absolutePath}', 'default')`;
                } else {
                    output.unshift(`var ${importItem.specifiers[0].imported} = __required('${importItem.absolutePath}', 'default');\n`);
                }
            }
        } else if (importItem.nameSpace) {
            output.unshift(`var ${importItem.specifiers[0].local} = __required('${importItem.absolutePath}'${importItem.noExports?'':",'exports'"});\n`);
        } else if (compilerObject.globalImports.hasOwnProperty(importItem.source)) {
            const globalDepMeta = compilerObject.globalImports[importItem.source];
            // const exportedValues = compilerObject.globalImports.export
            importItem.specifiers.forEach(specifier => {
                output.unshift(`var ${specifier.local} = ${globalDepMeta.output.arg}['${specifier.imported}'];\n`);
            });
            output.unshift(`var ${globalDepMeta.output.arg} = __required('${globalDepMeta.absolutePath}');\n`);
        } else if (compilerObject.files.hasOwnProperty(importItem.absolutePath)) {
            importItem.specifiers.forEach(specifier => {
                // make sure script is used before including them
                output.unshift(`var ${specifier.local} = __required('${importItem.absolutePath}', '${specifier.imported}');\n`);
            });
        }
    });

    // parse exports
    metaData.exports.forEach(exp => {
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
                output.unshift(`__required.r(exports, '${exp.exported}', function(){ return ${exp.local};});\n`);
            } else {
                output.unshift(`\nexports.${exp.exported} = ${defaultModuleImports[exp.local]};`)
            }
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
 * @param {*} compilerObject 
 * @param {*} filePath 
 * @param {*} allowBuild 
 */
async function generateModuleDeps(compilerObject, filePath, allowBuild) {
    const req = compilerObject.output.modules[filePath];
    if (allowBuild) {
        if (req.type == 'required')
            req.source.unshift(`module.exports = `);
        else
            await extendImportExport(filePath, compilerObject, req.source, isModule(req.annotations));
    }

    return `(function(module, exports, __required, global){\n"use strict";\n${req.source.join('')}\n})`
}

/**
 * 
 * @param {*} compilerObject 
 * @param {*} fileChanged 
 */
async function resolveModules(compilerObject, fileChanged) {
    const files = [];
    for (const filePath in compilerObject.output.modules) {
        const allowBuild = (!fileChanged || (fileChanged && helper.is(fileChanged, filePath)));
        files.push(`'${filePath}': ${await generateModuleDeps(compilerObject, filePath, allowBuild)}`);
    }

    return `{\n${files.join(',\n')}\n}`;
}

/**
 * 
 * @param {*} config 
 * @param {*} folder 
 */
exports.pushStyle = (config, appendFolder) => {
    const result = helper.stringifyContent(parseStyle(config));
    if (appendFolder) {
        appendFolder.push(result);
    } else {
        cssFileHolder.set(config.elementFilePath, { result, config });
    }
}

/**
 * 
 * @param {*} compilerObject 
 * @param {*} changes 
 */
exports.styleChanges = async(compilerObject, changes) => {
    const elementFilePath = compilerObject.output.styles[changes.filePath];
    const existingContent = cssFileHolder.get(elementFilePath);
    this.pushStyle(existingContent ? existingContent.config : {
        styleUrl: changes.filePath,
        elementFilePath
    });

    await writeCss(compilerObject.options);
};

function parseStyle(config) {
    const style = config.styleUrl ? fs.readFileSync(config.styleUrl, 'utf8') : config.style;
    if (!style) return "";
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
async function writeCss(options) {
    const styles = [];
    if (options.output.styles) {
        for (const style of options.output.styles) {
            exports.pushStyle({
                styleUrl: style
            }, styles);
        }
    }
    cssFileHolder.forEach(css => { if (css.result) styles.push(css.result); });
    const script = loadTemplate('css', { styles });
    styles.length = 0;
    await exports.writeFile(`${options.output.folder}/styles.js`, script);
}
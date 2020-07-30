const path = require('path');
const helper = require('@jeli/cli-utils');
const fs = require('fs-extra');
const wrappers = require('../utils/wrapper');
const lodashTemplate = require('lodash.template');
const uglify = require('uglify-js');
const nodeSass = require('node-sass');

const PATTERN = {
    MODULE: 'MODULE',
    UMD: 'UMD',
    DEFAULT: 'DEFAULT'
};
const cssFileHolder = [];

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
        helper.console.success(`generated file "${ path.basename(filePath) }" size: (${helper.colors.yellow(Math.floor(data.length/1024)+ 'kb')}) `);
    }
}

/**
 * 
 * @param {*} filePath 
 * @param {*} compilerObject 
 */
exports.saveCompilerData = async function(compilerObject, fileNames) {
    const metaDataFilePath = path.join(compilerObject.options.output.folder, compilerObject.entryFile, '..', './metadata.json');
    /**
     * existing and new packageJSON path
     */
    const existingPackageJSON = path.join(compilerObject.options.sourceRoot, compilerObject.entryFile, '..', './package.json');
    const outputPackageJSON = path.join(compilerObject.options.output.folder, compilerObject.entryFile, '..', './package.json');
    let packageJSON = Object.keys(fileNames).reduce((accum, type) => {
        accum[type === 'UMD' ? 'main' : type.toLowerCase()] = `${fileNames[type]}`;
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

    exports.writeFile(outputPackageJSON, JSON.stringify(packageJSON, null, 1));
    /**
     * remove unwanted data from compilerObject
     * before saving it
     */
    delete compilerObject.options;
    delete compilerObject.output;
    exports.writeFile(metaDataFilePath, JSON.stringify(compilerObject, null, 2).replace(/[']/g, ''));
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
        args: ''
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
    const script = lodashTemplate(wrappers[type])(scriptDefinition);
    const outputFolder = compilerObject.options.output.folder;
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

/**
 * 
 * @param {*} filePath 
 * @param {*} compilerObject 
 * @param {*} output 
 */
async function extendImportExport(filePath, compilerObject, output) {
    const metaData = compilerObject.files[filePath];
    const defaultModuleImports = {};
    metaData.imports.forEach(importItem => {
        const _filePath = `${path.join(filePath, '..', importItem.source)}.js`;
        if (importItem.default) {
            if (compilerObject.output.modules.hasOwnProperty(_filePath)) {
                /**
                 * empty module file
                 * files that imports and exports only
                 */
                if (!output.join('')) {
                    defaultModuleImports[importItem.specifiers[0].imported] = `__required('${_filePath}').default`;
                } else {
                    output.unshift(`var ${importItem.specifiers[0].imported} = __required('${_filePath}').default;\n`)
                }
            }
        } else if (compilerObject.globalImports.hasOwnProperty(importItem.source)) {
            const globalDepMeta = compilerObject.globalImports[importItem.source];
            // const exportedValues = compilerObject.globalImports.export
            importItem.specifiers.forEach(specifier => {
                output.unshift(`var ${specifier.local} = ${globalDepMeta.output.arg}['${specifier.imported}'];\n`);
            });
            output.unshift(`var ${globalDepMeta.output.arg} = __required('${globalDepMeta.fullPath}');\n`);
        } else if (compilerObject.files.hasOwnProperty(_filePath)) {
            importItem.specifiers.forEach(specifier => {
                output.unshift(`var ${specifier.local} = __required('${_filePath}')['${specifier.imported}'];\n`);
            });
        }
    });

    // parse exports
    metaData.exports.forEach(exp => {
        if (helper.is(exp.exported, 'default')) {
            output.push(`\nexports.default = ${output.pop()};`);
        } else {
            output.push(`\nexports.${exp.exported} = ${defaultModuleImports[exp.local] || exp.local};`)
        }
    });
}

exports.outputLibraryFiles = async function(compilerObject, scriptBody, moduleName) {
    const files = {};
    for (const type of compilerObject.options.output.patterns) {
        files[type] = await buildByType(type, scriptBody, moduleName, compilerObject);
    }

    await exports.saveCompilerData(compilerObject, files);
};

exports.outputApplicationFiles = async function(compilerObject, scriptBody) {
    const modules = await resolveModules(compilerObject);
    const fileName = `${compilerObject.options.output.folder}${compilerObject.entryFile}`;
    const deps = await getAppBootStrapDeps(compilerObject);
    const script = lodashTemplate(wrappers[PATTERN.DEFAULT])({ deps, scriptBody, modules });
    // const uglifiedScript = obfuscate(script);
    // if (!uglifiedScript.error) {
    //     await exports.writeFile(fileName, uglifiedScript.code);
    // } else {
    //     helper.console.error(`obfuscation failed for this file -> ${fileName}`);
    // }
    await exports.writeFile(fileName, script);
    await writeCss(compilerObject.options.output.folder);
    if (compilerObject.options.output.view) {
        saveApplicationView(compilerObject);
    }
}

async function getAppBootStrapDeps(compilerObject) {
    const output = [];
    for (const filePath in compilerObject.files) {
        if (!compilerObject.output.modules.hasOwnProperty(filePath)) {
            compilerObject.files[filePath].imports.forEach(importItem => {
                const _filePath = `${path.join(filePath, '..', importItem.source)}.js`;
                if (compilerObject.globalImports.hasOwnProperty(importItem.source)) {
                    const globalDepMeta = compilerObject.globalImports[importItem.source];
                    importItem.specifiers.forEach(specifier => {
                        output.unshift(`var ${specifier.local} = __required('${globalDepMeta.fullPath}')['${specifier.imported}'];\n`);
                    });
                } else if (compilerObject.files.hasOwnProperty(_filePath)) {
                    importItem.specifiers.forEach(specifier => {
                        output.unshift(`var ${specifier.local} = __required('${_filePath}')['${specifier.imported}'];\n`);
                    });
                }
            });
        }
    }

    return output.join('');
}

async function saveApplicationView(compilerObject) {
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
 */
async function generateModuleDeps(compilerObject, filePath) {
    const req = compilerObject.output.modules[filePath];
    const output = [];
    if (typeof req == 'string') {
        output.push(`return ${loader.readFile(req)}`);
    } else {
        output.push(req.join(''));
        await extendImportExport(filePath, compilerObject, output);
    }

    return `function(exports){\n${output.join('')}\n}`
}


async function resolveModules(compilerObject) {
    const files = [];
    for (var filePath in compilerObject.output.modules) {
        files.push(`'${filePath}': ${await generateModuleDeps(compilerObject, filePath)}`);
    }
    return `{\n${files.join(',\n')}\n}`;
}

exports.pushStyle = config => {
    const result = parseStyle(config);
    cssFileHolder.push(helper.stringifyContent(result.css.toString()));
}

function parseStyle(config) {
    return nodeSass.renderSync({
        file: config.file,
        data: config.style,
        outputStyle: 'compressed',
        outFile: config.outFile,
        sourceMap: false,
        importer: urlLoader
    });

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
        console.log(url, prev);
        // done({
        //     file: result.path,
        //     contents: result.data
        // });
    }
}

async function writeCss(folder) {
    const script = lodashTemplate(wrappers.CSS)({ cssFileHolder });
    await exports.writeFile(`${folder}/styles.js`, script);
}
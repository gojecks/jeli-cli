const path = require('path');
const helper = require('@jeli/cli-utils');
const fs = require('fs-extra');
const wrappers = require('../utils/wrapper');
const lodashTemplate = require('lodash.template');
const uglify = require('uglify-js');
const PATTERN = {
    MODULE: 'MODULE',
    UMD: 'UMD',
    DEFAULT: 'DEFAULT'
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
        helper.console.success('generated "' + path.basename(filePath) + '" ');
    }
}

/**
 * 
 * @param {*} filePath 
 * @param {*} compilerObject 
 */
exports.saveCompilerData = async function(compilerObject, fileNames) {
    const metaDataFilePath = path.join(compilerObject.options.output.folder, compilerObject.entryFile, '..', './metadata.json');
    helper.console.success('generated "' + metaDataFilePath + '"');
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
    if (fs.existsSync(existingPackageJSON))
        packageJSON = Object.assign(JSON.parse(fs.readFileSync(existingPackageJSON)), packageJSON);

    fs.writeFileSync(outputPackageJSON, JSON.stringify(packageJSON, null, 1));
    /**
     * remove unwanted data from compilerObject
     * before saving it
     */
    compilerObject.output.length = 0;
    delete compilerObject.options;
    delete compilerObject.output;
    delete compilerObject.required;
    fs.writeFileSync(metaDataFilePath, JSON.stringify(compilerObject, null, 2).replace(/[']/g, ''));
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
            scriptDefinition.globalName = `global.${trimmedName.first}`;
            scriptDefinition.globalNameSpace = `${trimmedName.nameSpace ? ', <%=globalName%>["'+ trimmedName.nameSpace + '"] = <%=globalName%>["'+ trimmedName.nameSpace + '"] || {}' : ''}`;

            if (compilerObject.exports.length) {
                scriptDefinition.footer = compilerObject.exports
                    .map(exp => `exports.${exp.exported} = ${exp.local};\n`)
                    .join('');
            }

            if (imports.length) {
                const args = imports.reduce((accum, key) => {
                    const config = compilerObject.globalImports[key];
                    accum.amd.push(`'${key}'`);
                    accum.cjs.push(`require('${key}')`);
                    accum.global.push(`global.${config.output.first}${config.output.nameSpace ? "['" + config.output.nameSpace + "']" : ''}`);
                    accum.args.push(`${config.output.arg}`);
                    return accum;
                }, {
                    amd: [],
                    cjs: [],
                    global: [''],
                    args: ['']
                });
                scriptDefinition.importsAMD = args.amd.join(', ');
                scriptDefinition.importsCJS = args.cjs.join(', ');
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
            await exports.writeFile(`${outputFolder}${minFileName}`, uglifiedScript.code);
            await exports.writeFile(`${outputFolder}${minFileName}.map`, uglifiedScript.map);
        } else {
            helper.console.error(`obfuscation failed for this file -> ${fileName}`);
        }
    }
    return filePath;
};

exports.outputLibraryFiles = async function(compilerObject, scriptBody, moduleName) {
    const files = compilerObject.options.output.patterns.reduce((accum, type) => {
        accum[type] = buildByType(type, scriptBody, moduleName, compilerObject);
        return accum;
    }, {});

    exports.saveCompilerData(compilerObject, files);
};

exports.outputApplicationFiles = async function(compilerObject, scriptBody) {
    const fileName = `${compilerObject.options.output.folder}${compilerObject.entryFile}`;
    const script = lodashTemplate(wrappers[PATTERN.DEFAULT])({ scriptBody });
    await exports.writeFile(fileName, script);
    if (compilerObject.options.output.view) {
        exports.saveApplicationView(compilerObject);
    }
}

exports.saveApplicationView = async(compilerObject) => {
    const viewFilePath = path.join(compilerObject.options.sourceRoot, compilerObject.options.output.view);
    if (fs.existsSync(viewFilePath)) {
        const html = fs.readFileSync(viewFilePath, 'utf8').replace(/<\/body>/, _ => {
            return `<script src="./${compilerObject.entryFile}" type="text/javascript"></script>\n${_}`;
        });

        fs.writeFileSync(`${compilerObject.options.output.folder}${compilerObject.options.output.view}`, html);
    }
};

exports.PATTERN = PATTERN;
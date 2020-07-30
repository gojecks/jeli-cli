const fs = require('fs-extra');
const glob = require('glob');
const { generateAstSource } = require('./ast.generator');
/**
 * cache for holding externalMetaData
 */
const _metaDataCache = {};
let __compilerInstance = null;
/**
 * 
 * @param {*} fileName 
 * @param {*} filePath 
 */
const generateOutPutFileName = (fileName, filePath, entryFile) => {
    const match = filePath.split(/\//g);
    const entryPath = entryFile.split(/\//g);
    return fileName.split(/\//g).map(key => key === '*' ? match[entryPath.indexOf(key)] : key).join('/');
};

exports.expandFilePath = (entryFile, sourceRoot) => {
    return glob.sync(entryFile, {
        cwd: sourceRoot,
        filter: 'isFile'
    });
}

/**
 * 
 * @param {*} options 
 */
async function CompilerObject(options) {
    options = Object.assign({
        sourceRoot: '',
        type: 'library',
        output: {
            separator: '\n',
            header: '',
            footer: '',
            generateMeta: false,
            patterns: ['MODULE'],
            folder: 'dist/'
        },
    }, options);

    /**
     * check resolve paths
     */
    options.resolve = options.resolve || {};
    options.resolve.paths = (options.resolve.paths || ['./node_modules']);

    /**
     * alias definition is used for resolving local dependencies
     * {
     *  "@jeli/*": "./PATH_TO_RESOLVE/"
     * }
     */
    if (options.resolve.alias) {
        Object.keys(options.resolve.alias).forEach(key => {
            /**
             * check if alias contains any wildcard
             * read the diectory path and write the folder names to the alias object
             */
            if (key.indexOf('/*') > -1) {
                fs.readdirSync(options.resolve.alias[key])
                    .forEach(name => options.resolve.alias[key.replace('*', name)] = `${options.resolve.alias[key]}${name}`);
                delete options.resolve.alias[key];
            }
        });
    }

    let outputFiles = {};

    function outPutObject(fileEntry) {
        Object.defineProperty(this, 'options', {
            get: function() {
                return options;
            }
        });

        this.files = {};
        this.globalImports = {};
        this.Directive = {};
        this.queries = {};
        this.Element = {};
        this.output = {
            modules: {},
            global: []
        };
        this.required = {};
        this.modules = {};
        this.services = {};
        this.exports = [];
        this.entryFile = fileEntry;
    }

    /**
     * generate a compilerObject for each file to be output
     */
    if (options.output.files) {
        for (var fileName in options.output.files) {
            const entryFile = options.output.files[fileName];
            if (entryFile.indexOf('*') > -1) {
                exports.expandFilePath(entryFile, options.sourceRoot)
                    .forEach(filePath => outputFiles[generateOutPutFileName(fileName, filePath, entryFile)] = new outPutObject(filePath));
            } else {
                outputFiles[fileName] = new outPutObject(entryFile);
            }
        }
    } else if (options.output.entryFile) {
        outputFiles['.'] = new outPutObject(options.output.entryFile);
    }


    // clear output
    if (fs.existsSync(options.output.folder)) {
        fs.removeSync(options.output.folder);
    }

    return outputFiles;
}

exports.CompilerObject = CompilerObject;

/**
 * 
 * @param {*} tokenName 
 * @param {*} compilerObjectExports 
 */
exports.isExportedToken = (tokenName, compilerObject) => {
    const found = compilerObject.exports.some(token => (token.exported === tokenName));
    if (!found) {
        const libExported = exports.findTokenInGlobalImports(tokenName, compilerObject, 'exports');
        return libExported && libExported.some(token => (token.exported === tokenName));
    }
    return found;
}

/**
 * 
 * @param {*} tokenName 
 * @param {*} compilerObject 
 */
exports.findTokenInGlobalImports = (tokenName, compilerObject, propName) => {
    const libExported = Object.keys(compilerObject.globalImports)
        .find(lib => compilerObject.globalImports[lib].specifiers.includes(tokenName));
    if (libExported && _metaDataCache.hasOwnProperty(libExported)) {
        return _metaDataCache[libExported][propName] || _metaDataCache[libExported];
    }
};

exports.findNotExported = (moduleName, specifiers, source) => {
    const exported = this.getMetaData(moduleName).exports.map(item => item.exported);
    return specifiers.filter(item => !exported.includes(item.imported));
}

exports.getPipeProvider = (pipeName, compilerObject) => {
    let foundPipe = find(compilerObject.services);
    /**
     * find in imported modules
     */
    if (!foundPipe) {
        for (const lib in _metaDataCache) {
            foundPipe = find(_metaDataCache[lib].services);
            if (foundPipe) {
                return {
                    fn: foundPipe,
                    module: lib
                };
            }
        }
    } else {
        return {
            fn: foundPipe,
            module: compilerObject.services[foundPipe].module
        }
    }

    return null;

    function find(services) {
        return Object.keys(services)
            .find(providerName => (services[providerName].name === pipeName))
    }
}

/**
 * 
 * @param {*} metaDataPath 
 * @param {*} moduleName 
 */
exports.resolveMetaData = (deps, importItem) => {
    if (!_metaDataCache.hasOwnProperty(importItem.source)) {
        if (deps.metadata && fs.existsSync(deps.metadata)) {
            _metaDataCache[importItem.source] = JSON.parse(fs.readFileSync(deps.metadata));
        } else if (!deps.metadata && fs.existsSync(deps.source)) {
            _metaDataCache[importItem.source] = ({
                imports: [],
                exports: []
            });
            generateAstSource(fs.readFileSync(deps.source, 'utf8'), _metaDataCache[importItem.source]);
        }
    }
};

exports.getMetaData = moduleName => _metaDataCache[moduleName];

exports.session = {
    save: compilerObject => __compilerInstance = compilerObject,
    get: () => __compilerInstance,
    clear: () => __compilerInstance = null
};
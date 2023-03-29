const fs = require('fs-extra');
const glob = require('glob');
const { generateAstSource } = require('./ast.generator');
const path = require('path');
const supportedFiles = ['.js', '.jeli'];
/**
 * cache for holding externalMetaData
 */
const _metaDataCache = {};
let __compilerInstance = null;
const removeExtPath = p => {
    const ext = path.extname(p);
    return (ext || supportedFiles.includes(ext)) ? p.substring(0, p.lastIndexOf(ext)) : p;
};

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
 * @param {*} buildOptions 
 * @param {*} resolvers 
 * @returns 
 */
async function CompilerObject(options, buildOptions, resolvers) {
    options = Object.assign({
        sourceRoot: '',
        type: 'library',
        output: {
            separator: '\n',
            header: '',
            footer: '',
            entryFile: 'main.js',
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
    if (resolvers) {
        if (resolvers.paths) {
            options.resolve.paths.push.apply(options.resolve.paths, resolvers.paths);
        }

        /**
         * extend alias
         */
        if (resolvers.alias) {
            options.resolve.alias = Object.assign(resolvers.alias, options.resolve.alias);
        }
    }


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
                try {
                    fs.readdirSync(options.resolve.alias[key])
                        .forEach(name => options.resolve.alias[removeExtPath(key.replace('*', name))] = `${options.resolve.alias[key]}${name}`);
                    delete options.resolve.alias[key];
                } catch (e) {
                    throw new Error(`Unable to resolve "${options.resolve.alias[key]}" defined in resolve.alias configuration`);
                }
            }
        });
    }

    let outputFiles = {};

    function outPutObject(fileEntry) {
        Object.defineProperties(this, {
            options: {
                get: () => options
            },
            buildOptions: {
                get: () => buildOptions || {}
            }
        });

        this.files = {};
        this.globalImports = {};
        this.Directive = {};
        this.Element = {};
        this.jModule = {};
        this.Service = {};
        this.queries = {};
        this.output = {
            modules: {},
            global: [],
            templates: {},
            styles: {},
            tokens: {},
            lazyLoads: []
        };
        this.required = {};
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
        outputFiles[options.output.entryFile] = new outPutObject(options.output.entryFile);
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
    let foundPipe = find(compilerObject.Service);
    /**
     * find in imported modules
     */
    if (!foundPipe) {
        for (const lib in _metaDataCache) {
            foundPipe = find(_metaDataCache[lib].Service);
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
            module: compilerObject.Service[foundPipe].module || 'root'
        }
    }

    return null;

    function find(services) {
        return services && Object.keys(services)
            .find(providerName => (services[providerName].name === pipeName))
    }
}

/**
 * 
 * @param {*} metaDataPath 
 * @param {*} moduleName 
 */
exports.resolveMetaData = async(deps, importItem) => {
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
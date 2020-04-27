const fs = require('fs-extra');
const glob = require('glob');
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
const generateOutPutFileName = (fileName, filePath) => {
    const match = filePath.split(/\//g);
    return fileName.split(/\//g).map((key, idx) => key === '*' ? match[idx] : key).join('/');
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
            folder: 'dist/',
            files: null
        },
        resolve: {
            alias: {},
            paths: ['./node_modules']
        }
    }, options);

    let outputFiles = {};

    function outPutObject(fileEntry) {
        this.files = {};
        this.globalImports = {};
        this.Directive = {};
        this.queries = {};
        this.Element = {};
        this.output = [];
        this.required = {};
        this.modules = {};
        this.services = {};
        this.exports = [];
        this.entryFile = fileEntry;
        this.options = options;
    }

    /**
     * generate a compilerObject for each file to be output
     */
    if (options.output.files) {
        for (var fileName in options.output.files) {
            const entryFile = options.output.files[fileName];
            if (entryFile.indexOf('*') > -1) {
                exports.expandFilePath(entryFile, options.sourceRoot)
                    .forEach(filePath => outputFiles[generateOutPutFileName(fileName, filePath)] = new outPutObject(filePath));
            } else {
                outputFiles[fileName] = new outPutObject(entryFile);
            }
        }
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
        const libExported = findTokenInGlobalImports(tokenName, compilerObject, 'exports');
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
}

/**
 * 
 * @param {*} metaDataPath 
 * @param {*} propName 
 */
exports.resolveMetaData = (metaDataPath, propName) => {
    if (!metaDataPath) return;
    if (!_metaDataCache.hasOwnProperty(propName) && fs.existsSync(metaDataPath)) {
        _metaDataCache[propName] = JSON.parse(fs.readFileSync(metaDataPath));
    }
};

exports.session = {
    save: compilerObject => __compilerInstance = compilerObject,
    get: () => __compilerInstance,
    clear: () => __compilerInstance = null
};
const path = require('path');
const helper = require('@jeli/cli-utils');
const ora = require('@jeli/cli-utils/spinner');
const fs = require('fs-extra');
const glob = require('glob');
const REQUIRED_ID = 'ϕrequired';
const supportedFiles = ['.js', '.jli'];
const _fileCache_ = new Map();

exports.spinner = ora.start('compiling...');
/**
 * 
 * @param {*} filePath 
 */
exports.templateContentLoader = (filePath) => {
    this.spinner.changeText('Found template: ' + filePath);
    return (exports.readFile(filePath) || '').replace(/\n/g, '');
};

/**
 * 
 * @param {*} tempPath 
 * @param {*} sourceRoot 
 */
exports.getFilePath = (tempPath, sourceRoot) => {
    tempPath = path.join(sourceRoot, tempPath);
    if (!fs.existsSync(tempPath)) {
        helper.console.error(`unable to find file "${tempPath}"`);
    }

    return tempPath;
}

/**
 * 
 * @param {*} pathA 
 * @param {*} pathB 
 */
exports.joinFilePath = (...args) => path.join.apply(path, args);

/**
 * 
 * @param {*} filePath 
 * @param {*} ignoreCheck
 */
exports.readFile = (filePath, ignoreCheck = false, saveToCache = false) => {
    if (!ignoreCheck && !fs.existsSync(filePath)) {
        throw new Error(`File "${helper.colors.yellow(filePath)}" does not exists`);
    }

    if (_fileCache_.has(filePath)) {
        return _fileCache_.get(filePath);
    }

    var contents = fs.readFileSync(filePath, 'utf8');
    if (saveToCache) _fileCache_.set(filePath, contents);

    return contents;
}

/**
 * 
 * @param {*} files 
 * @param {*} compilerObject 
 */
exports.getGlobFiles = async(filePath) => {
    const index = filePath.indexOf('*');
    const cwd = filePath.substring(0, index);
    const files = glob.sync(filePath);
};

/**
 * 
 * @param {*} id
 */
exports.getRequiredId = (id) => `${REQUIRED_ID}${id ? '[' + id + ']' : ''}`;


/**
 * 
 * @param {*} dep 
 * @param {*} parentPath 
 * @param {*} resolveOptions 
 */
exports.resolveDependency = (dep, parentPath, resolveOptions) => {
    /**
     * dep is a relative path
     */
    if (helper.is(dep.charAt(0), '.')) {
        return null;
    } else if (resolveOptions.alias && resolveOptions.alias.hasOwnProperty(dep)) {
        return _resolveModule(resolveOptions.alias[dep]);
    }

    for (const resolvePath of resolveOptions.paths) {
        const depPath = path.join(resolvePath, dep);
        const jsPath = `${depPath}.js`;
        if (fs.existsSync(depPath)) {
            return _resolveModule(depPath);
        } else if (fs.existsSync(jsPath)) {
            let pkgJson = {};
            if (depPath.startsWith('node_modules')) {
                const modulePath = path.join(resolvePath, dep.split('/')[0]);
                pkgJson = exports.getPackageJson(modulePath);
            }

            return {
                source: jsPath,
                name: pkgJson && pkgJson.name,
                version: pkgJson && pkgJson.version
            };
        }
    }

    function _resolveModule(depPath) {
        const ext = path.extname(depPath);
        if (ext && supportedFiles.includes(ext)) return { source: depPath };

        const pkgJson = exports.getPackageJson(depPath);
        if (pkgJson) {
            /**
             * check for ES5 module 
             * also understood by jeli
             */
            return {
                source: path.join(depPath, pkgJson.module || pkgJson.main),
                metadata: path.join(depPath, pkgJson.metadata || 'metadata.json'),
                isModule: !!pkgJson.module,
                version: pkgJson.version,
                name: pkgJson.name
            };
        }

        const indexPath = path.join(depPath, './index.js');
        if (fs.existsSync(indexPath)) return { source: indexPath };
    }

    return null;
}

/**
 * 
 * @param {*} entry 
 * @param {*} silent 
 */
exports.getPackageJson = (entry, silent) => {
    const packagePath = path.join(entry, 'package.json');
    if (!fs.existsSync(packagePath) && !silent) {
        helper.console.error(`Cannot find package.json file: ${packagePath}`);
        return null;
    }

    return JSON.parse(exports.readFile(packagePath, true, true));
}

exports.getExt = file => path.extname(file);
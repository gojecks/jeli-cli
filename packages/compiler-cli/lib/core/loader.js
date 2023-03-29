const path = require('path');
const helper = require('@jeli/cli/lib/utils');
const spinner = require('@jeli/cli/lib/utils/spinner');
const fs = require('fs-extra');
const glob = require('glob');
const REQUIRED_ID = 'ϕrequired';
const supportedFiles = ['.js', '.jli'];
const _fileCache_ = new Map();
exports.spinner = spinner.start('compiling...');

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
 * @param {*} saveToCache 
 * @param {*} buildOptionReplace 
 * @returns 
 */
exports.readFile = (filePath, ignoreCheck = false, saveToCache = false, buildOptionReplacer) => {
    if (!ignoreCheck && !fs.existsSync(filePath)) {
        throw new Error(`File "${helper.colors.yellow(filePath)}" does not exists`);
    }

    /**
     * check if filePath is part of cache
     * then return cache
     */
    if (_fileCache_.has(filePath)) {
        return _fileCache_.get(filePath);
    }

    const rFilePath = ((buildOptionReplacer && buildOptionReplacer[filePath]) ? buildOptionReplacer[filePath] : filePath);
    const contents = fs.readFileSync(rFilePath, 'utf8');
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
 * @param {*} resolveOptions 
 */
exports.resolveDependency = (dep, resolveOptions) => {
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
                const spltDep = dep.split('/')
                const modulePath = path.join(resolvePath, spltDep.slice(0, dep.includes('@')? 2 : 2).join('/'));
                pkgJson = exports.getPackageJson(modulePath, true);
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
                stylesPath: pkgJson.stylesPath ? path.join(depPath, pkgJson.stylesPath) : null,
                metadata: pkgJson.metaDataPath ? path.join(depPath, pkgJson.metaDataPath) : null,
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
        helper.console.error(`\nCannot find package.json file: ${packagePath}`);
        return null;
    }

    return JSON.parse(exports.readFile(packagePath, true, true));
}

exports.getExt = file => path.extname(file);
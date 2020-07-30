const path = require('path');
const helper = require('@jeli/cli-utils');
const ora = require('@jeli/cli-utils/spinner');
const fs = require('fs-extra');
const glob = require('glob');

module.exports = function() {
    const spinner = ora.start('compiling...');
    const REQUIRED_ID = 'ϕrequired';
    /**
     * 
     * @param {*} filePath 
     * @param {*} parentPath 
     * @param {*} stringify 
     */
    function templateContentLoader(filePath, parentPath, stringify = true) {
        spinner.changeText('Found template: ' + filePath);
        return (readFile(path.join(parentPath, '..', filePath)) || '').replace(/\n/g, '');
    }

    /**
     * 
     * @param {*} tempPath 
     * @param {*} sourceRoot 
     */
    function getFilePath(tempPath, sourceRoot) {
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
    function joinFilePath() {
        return path.join.apply(path, arguments);
    }

    /**
     * 
     * @param {*} filePath 
     * @param {*} parentPath 
     */
    function readFile(filePath, parentPath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File "${helper.colors.yellow(filePath)}" does not exists`);
        }

        return fs.readFileSync(filePath, 'utf8');
    }

    /**
     * 
     * @param {*} files 
     * @param {*} compilerObject 
     */
    async function getGlobFiles(filePath) {
        const index = filePath.indexOf('*');
        const cwd = filePath.substring(0, index);
        const files = glob.sync(filePath);
    }

    /**
     * 
     * @param {*} id
     */
    function getRequiredId(id) {
        return `${REQUIRED_ID}${id ? '[' + id + ']' : ''}`;
    }


    /**
     * 
     * @param {*} dep 
     * @param {*} parentPath 
     * @param {*} resolveOptions 
     */
    function resolveDependency(dep, parentPath, resolveOptions) {
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
            if (fs.existsSync(depPath)) {
                return _resolveModule(depPath);
            } else if (fs.existsSync(`${depPath}.js`)) return { source: `${depPath}.js` };
        }

        function _resolveModule(depPath) {
            const pkgJson = getPackageJson(depPath);
            if (pkgJson) {
                /**
                 * check for ES5 module 
                 * also understood by jeli
                 */
                return {
                    source: path.join(depPath, pkgJson.module || pkgJson.main),
                    metadata: path.join(depPath, pkgJson.metadata || 'metadata.json'),
                    isModule: !!pkgJson.module
                };
            }

            const indexPath = path.join(depPath, './index.js');
            if (fs.existsSync(indexPath)) return { source: indexPath }
        }

        return null;
    }

    /**
     * 
     * @param {*} entry 
     * @param {*} silent 
     */
    function getPackageJson(entry, silent) {
        const packagePath = path.join(entry, 'package.json');
        if (!fs.existsSync(packagePath) && !silent) {
            helper.console.error(`Cannot find package.json file: ${packagePath}`);
            return null;
        }

        return JSON.parse(readFile(packagePath));
    }

    return {
        getGlobFiles,
        templateContentLoader,
        getFilePath,
        readFile,
        joinFilePath,
        getRequiredId,
        resolveDependency,
        spinner
    };
}();
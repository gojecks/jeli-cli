const path = require('path');
const helper = require('@jeli/cli-utils');
const ora = require('@jeli/cli-utils/spinner');
const fs = require('fs-extra');
const glob = require('glob');

module.exports = function() {
    const spinner = ora.start('compiling...');
    const REQUIRED_ID = 'ϕrequired';
    const nodeModulesPath = './node_modules';
    /**
     * 
     * @param {*} filePath 
     * @param {*} parentPath 
     */
    function templateContentLoader(filePath, parentPath) {
        spinner.changeText('Found template: ' + filePath);
        const content = readFile(path.join(parentPath, '..', filePath));
        return helper.stringifyContent(content.replace(/\n/g, ''));
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

    function readFile(filePath) {
        if (!fs.existsSync(filePath)) {
            helper.console.error(`File ${filePath} does not exists.`);
            helper.abort();
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
     * Check if the request file is a module and needs to be imported or skip import for later
     * @param {*} source 
     */
    function isGlobalImport(source) {
        if (source.charAt(0) !== '.') {
            return true;
        }
        /**
         * check if its directory
         */
        return (fs.existsSync(path.join(nodeModulesPath, source)) && fs.existsSync(path.join(nodeModulesPath, source, './package.json')));
    }

    /**
     * 
     * @param {*} module 
     */
    function resolveDependency(dep) {
        const depPath = path.resolve(nodeModulesPath, dep);
        if (fs.existsSync(depPath)) {
            const pkgJson = getPackageJson(depPath);
            if (pkgJson) {
                /**
                 * check for ES5 module 
                 * also understood by jeli
                 */
                return {
                    source: path.join(nodeModulesPath, dep, pkgJson.module || pkgJson.main),
                    metadata: path.join(nodeModulesPath, dep, pkgJson.metadata || 'metadata.json'),
                    isModule: !!pkgJson.module
                };
            }
            const indexPath = path.join(nodeModulesPath, dep, './index.js');
            if (fs.existsSync(indexPath)) return { source: indexPath }
        } else if (fs.existsSync(`${depPath}.js`)) return { source: `${path.join(nodeModulesPath, dep)}.js` };

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
        isGlobalImport,
        resolveDependency,
        spinner
    };
}();
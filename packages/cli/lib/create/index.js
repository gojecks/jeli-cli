const path = require('path');
const validateProjectName = require('validate-npm-package-name');
const jeliUtils = require('../utils/index');
const { projectPrompt } = require('./prompt');
const { getPackageManagerList, install} = require('../utils/packageManager');
const { isJeliProject, getJeliJson, gitInit, removeDir } = require('./utils');
const GeneratorInstance = require('../generator/instance');

const projectNameValidation = name => {
    const validatorResult = validateProjectName(name);
    if (!validatorResult.validForNewPackages) {
        jeliUtils.console.error(`Invalid project name: "${name}"`);
        validatorResult.errors && validatorResult.errors.forEach(err => jeliUtils.console.error(jeliUtils.colors.red.dim(`Error: ${err}`)));
        validatorResult.warnings && validatorResult.warnings.forEach(warn => jeliUtils.console.error(jeliUtils.colors.red.dim(`Warning: ${warn}`)));
        jeliUtils.abort('');
    }
}

async function create(projectName, options) {
    const cwd = process.cwd();
    const inCurrent = projectName === '.';
    const name = inCurrent ? path.relative('../', cwd) : projectName;
    const targetDir = path.resolve(cwd, projectName || '.');
    let isProjectExists = false;
    let json = null;
    const getJeliSchema = filePath => {
        json = getJeliJson(filePath);
        isProjectExists = json && json.projects.hasOwnProperty(name);
        return json;
    };

    if (options.proxy) {
        process.env.HTTP_PROXY = options.proxy
    }

    projectNameValidation(name);
    /**
     * command called within a jeli project
     */
    let blankWorkSpace = false;
    let isJeliProjectWorkSpace = true;
    if (isJeliProject(path.resolve(cwd))) {
        getJeliSchema(cwd);
        if (json && isProjectExists) {
            if (!options.force) {
                jeliUtils.console.warn(`\nCurrent working directory is a jeli workspace`);
                jeliUtils.abort(`fatal: project "${jeliUtils.colors.cyan(name.toUpperCase())}" already exists.`);
            } else {
                removeDir(path.join(cwd, json.projects[name].sourceRoot));
            }
        }
    } else {
        /**
         * command called outside jeliProject
         */
        isJeliProjectWorkSpace = !!isJeliProject(targetDir);
        blankWorkSpace = true;
        if (isJeliProjectWorkSpace) {
            getJeliSchema(targetDir);
        }
    }

    await jeliUtils.console.clear();
    const availablePkgMgr = await getPackageManagerList();
    const projectData = await projectPrompt(isJeliProjectWorkSpace, name, targetDir, isProjectExists, availablePkgMgr.Binaries);
    if ((!isJeliProjectWorkSpace || (isJeliProjectWorkSpace && projectData.dirOption == 2) && blankWorkSpace)) {
        projectData.cliversion = require('../../package.json').version;
        await GeneratorInstance.createProject(projectData);
        await install(projectData.packagemanager, projectData.targetDir);
        await gitInit(projectData);
    } else {
        projectData.packagemanager = json.cli.packageManager;
        await GeneratorInstance.addProject(projectData);
    }

    jeliUtils.console.success(`✔ ${projectData.variant} created successfully!!`);
}

module.exports = (...args) => {
    return create(...args).catch(err => {
        jeliUtils.console.error(err);
        jeliUtils.abort('Failed to complete project creation, please see logs.');
    })
};
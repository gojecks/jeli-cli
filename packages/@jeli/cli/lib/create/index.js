const fs = require('fs-extra');
const path = require('path');
const validateProjectName = require('validate-npm-package-name');
const jeliUtils = require('@jeli/cli-utils');
const { projectPrompt } = require('./prompt');
const { getPackageManagerList, install } = require('../utils/packageManager');
const { isJeliProject, getJeliJson } = require('./utils');
const GeneratorInstance = require('../generator/instance');

const projectNameValidation = name => {
    const validatorResult = validateProjectName(name);
    if (!validatorResult.validForNewPackages) {
        jeliUtils.console.error(`Invalid project name: "${name}"`);
        validatorResult.errors && validatorResult.errors.forEach(err => jeliUtils.console.error(jeliUtils.colors.red.dim(`Error: ${err}`)));
        validatorResult.warnings && validatorResult.warnings.forEach(warn => jeliUtils.console.error(jeliUtils.colors.red.dim(`Warning: ${warn}`)));
        jeliUtils.abort('');
    }
};

/**
 * 
 * @param {*} jeliWorkSpace 
 * @param {*} inCurrent 
 * @param {*} name 
 * @param {*} targetDir 
 * @param {*} projecttExists 
 */
const coreCreate = async(jeliWorkSpace, inCurrent, name, targetDir, projectExists) => {
    await jeliUtils.console.clear();
    const availablePkgMgr = await getPackageManagerList();
    const projectData = await projectPrompt(jeliWorkSpace, name, targetDir, projectExists, availablePkgMgr.Binaries);
    if ((!jeliWorkSpace || (jeliWorkSpace && projectData.dirOption == 2) && inCurrent)) {
        await GeneratorInstance.createProject(projectData);
        await install(projectData.packagemanager, targetDir);
    } else {
        await GeneratorInstance.addProject(projectData);
    }

    jeliUtils.console.success(`✔ ${projectData.variant} created successfully!!`);
}

async function create(projectName, options) {
    const cwd = process.cwd();
    const inCurrent = projectName === '.';
    const name = inCurrent ? path.relative('../', cwd) : projectName;
    const targetDir = path.resolve(cwd, projectName || '.');

    if (options.proxy) {
        process.env.HTTP_PROXY = options.proxy
    }

    projectNameValidation(name);
    /**
     * command called within a jeli project
     */
    let isProjectExists = false;
    let inWorkSpace = false;
    let isJeliProjectWorkSpace = true;
    if (isJeliProject(path.resolve(cwd))) {
        const json = getJeliJson(cwd);
        isProjectExists = json.projects.hasOwnProperty(name);
        if (json && isProjectExists) {
            if (!options.force) {
                jeliUtils.console.warn(`\nCurrent working directory is a jeli workspace`);
                jeliUtils.abort(`fatal: project "${jeliUtils.colors.cyan(name)}" already exists.`);
            } else {
                fs.removeSync(path.join(cwd, json.projects[name].sourceRoot));
            }
        }
    } else {
        /**
         * command called outside jeliProject
         */
        isJeliProjectWorkSpace = isJeliProject(targetDir);
        inWorkSpace = true;
        if (isJeliProject) {
            const json = getJeliJson(targetDir);
            isProjectExists = json && json.projects.hasOwnProperty(name);
        }
    }

    await coreCreate(isJeliProjectWorkSpace, inWorkSpace, name, targetDir, isProjectExists);
}

module.exports = (...args) => {
    return create(...args).catch(err => {
        jeliUtils.console.error(err);
        jeliUtils.abort('Failed to complete project creation, please see logs.');
    })
};
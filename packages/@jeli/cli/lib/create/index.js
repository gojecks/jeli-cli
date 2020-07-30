const fs = require('fs-extra');
const path = require('path');
const validateProjectName = require('validate-npm-package-name');
const jeliUtils = require('@jeli/cli-utils');
const { projectPrompt } = require('./prompt');
const { getPackageManagerList, install } = require('../utils/packageManager');
const { createProject, isJeliProject, addProject, getJeliJson } = require('./utils');

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
 * @param {*} inCurrent
 * @param {*} name 
 * @param {*} targetDir 
 */
const coreCreate = async(projectExists, inCurrent, name, targetDir) => {
    await jeliUtils.console.clear();
    const availablePkgMgr = await getPackageManagerList();
    const projectData = await projectPrompt(projectExists, name, targetDir, availablePkgMgr.Binaries);
    if ((!projectExists || (projectExists && projectData.dirOption == 2) && inCurrent)) {
        await createProject(projectData);
        await install(projectData.packagemanager, targetDir);
    } else {
        await addProject(projectData);
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
    if (isJeliProject(path.resolve(cwd))) {
        const json = getJeliJson(cwd);
        if (json && json.projects.hasOwnProperty(name)) {
            if (!options.force) {
                jeliUtils.console.warn(`\nCurrent working directory is a jeli workspace`);
                jeliUtils.abort(`fatal: project "${jeliUtils.colors.cyan(name)}" already exists.`);
            } else {
                fs.removeSync(path.join(cwd, json.projects[name].sourceRoot));
            }
        }

        await coreCreate(true, false, name, targetDir);
    } else {
        /**
         * command called outside jeliProject
         */
        await coreCreate(isJeliProject(targetDir), true, name, targetDir);
    }
}

module.exports = (...args) => {
    return create(...args).catch(err => {
        jeliUtils.abort('Failed to complete project creation, please see logs.');
    })
};
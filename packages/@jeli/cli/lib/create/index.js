const fs = require('fs-extra');
const path = require('path');
const validateProjectName = require('validate-npm-package-name');
const jeliUtils = require('@jeli/cli-utils');
const { confirmDirectoryOption, projectPrompt, prompStatic } = require('./prompt');
const { getPackageManagerList, install } = require('../utils/packageManager');

async function create(projectName, options) {
    const cwd = options.folder || process.cwd();
    const inCurrent = projectName === '.';
    const name = inCurrent ? path.relative('../', cwd) : projectName;
    const targetDir = path.resolve(cwd, projectName || '.');
    const validatorResult = validateProjectName(name);

    if (options.proxy) {
        process.env.HTTP_PROXY = options.proxy
    }

    if (!validatorResult.validForNewPackages) {
        jeliUtils.console.error(`Invalid project name: "${name}"`);
        validatorResult.errors && validatorResult.errors.forEach(err => jeliUtils.console.error(jeliUtils.colors.red.dim(`Error: ${err}`)));
        validatorResult.warnings && validatorResult.warnings.forEach(warn => jeliUtils.console.error(jeliUtils.colors.red.dim(`Warning: ${warn}`)));
        jeliUtils.abort('');
    }

    if (fs.existsSync(targetDir) && !options.merge) {
        if (options.force) {
            await fs.remove(targetDir);
        } else {
            await jeliUtils.console.clear();
            if (inCurrent) {
                const { ok } = await prompStatic('overrideDirectory');
                if (!ok) {
                    return;
                }
            } else {
                const { action } = await confirmDirectoryOption(jeliUtils.colors.cyan(targetDir));
                /**
                 * override option
                 */
                if (action == 2) {
                    jeliUtils.console.write(`\nRemoving ${jeliUtils.colors.cyan(targetDir)}...`)
                    await fs.remove(targetDir);
                }
                /**
                 * cancel option
                 */
                else if (!action) {
                    return false;
                }
            }
        }
    }

    const { createProject } = require('./utils');
    const availablePkgMgr = await getPackageManagerList();
    const projectData = await projectPrompt(name, targetDir, availablePkgMgr.Binaries);
    await createProject(projectData);
    await install(projectData.packagemanager, projectData.targetDir);
    jeliUtils.console.success(`✔ ${projectData.variant} created successfully!!`);
}

module.exports = (...args) => {
    return create(...args).catch(err => {
        jeliUtils.abort('unable to complete project creation, please refer to logs.');
    })
}
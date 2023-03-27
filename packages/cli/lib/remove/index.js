const jeliUtils = require('../utils');
const { getJeliJson, getJeliSchemaFilePath, validateProjectAndWorkSpace } = require('../create/utils');

module.exports = async(projectName, options) => {
    const cwd = process.cwd();
    const jeliJson = getJeliJson(cwd);

    validateProjectAndWorkSpace(jeliJson, projectName);
    const fs = require('fs-extra');
    const path = require('path');
    try {
        fs.removeSync(path.resolve(cwd, jeliJson.projects[projectName].sourceRoot));
        // remove the project configuration
        delete jeliJson.projects[projectName];
        // save the update json
        fs.writeFileSync(getJeliSchemaFilePath(cwd), JSON.stringify(jeliJson, null, 2));
    } catch (err) {
        jeliUtils.abort(`error while removing project ${jeliUtils.colors.cyan(projectName)}`);
    } finally {
        jeliUtils.console.success(`project ${jeliUtils.colors.cyan(projectName)} removed!`)
    }
}
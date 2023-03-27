const path = require('path');
const jeliUtils = require('../utils');
const { getJeliJson, validateProjectAndWorkSpace } = require('../create/utils');
const GeneratorInstance = require('./instance');
const supportedTypes = { e: "element", s: "service", d: "directive", m: "module", p: "pipe", r: "router", c: "combination" };

const parsePathName = pathName => {
    const spltPathName = jeliUtils.splitAndTrim(jeliUtils.is(pathName.charAt(0), '/') ? pathName.substring(1) : pathName, '/');
    spltPathName[spltPathName.length - 1] = jeliUtils.kebabCase(spltPathName[spltPathName.length - 1]);
    return spltPathName.join('/');
};

async function ComponentGenerator(componentType, pathName, options) {
    const cwd = process.cwd();
    if (!supportedTypes.hasOwnProperty(componentType) && !Object.values(supportedTypes).includes(componentType)) {
        throwErrorForInvalidComponentTypes(componentType);
    }

    let type = componentType.charAt(0);
    if (type === 'c') {
        if (!options.components) {
            jeliUtils.console.error(`Type ${jeliUtils.colors.yellow(componentType)} requires list of components to be generated.\n`)
            jeliUtils.abort('');
        } else if (options.components.split('').some(ctype => !supportedTypes.hasOwnProperty(ctype))) {
            throwErrorForInvalidComponentTypes(options.components);
        }

        type = options.components;
    }

    const jeliJson = getJeliJson(cwd);
    validateProjectAndWorkSpace(jeliJson, options.project || jeliJson && jeliJson.default);

    if (Object.keys(jeliJson.projects).length > 1 && !options.project) {
        jeliUtils.console.warn(`no project was defined, using default project ${jeliUtils.colors.cyan(jeliJson.default)}`)
    }

    if (!path.basename(pathName) || /[!@#$%^&*(),.?":{}|<>_/]/.test(path.basename(pathName))) {
        jeliUtils.console.warn(`Invalid name: ${path.basename(pathName)}. special characters are not allowed only.`);
        jeliUtils.console.warn(`e.g: hero-page`)
        jeliUtils.abort("");
    }

    const projectConfig = jeliJson.projects[options.project || jeliJson.default];
    const devFolder = projectConfig.prefix || '.';
    const targetDir = path.resolve(cwd, projectConfig.sourceRoot, devFolder, parsePathName(pathName));
    /**
     * initializer
     */
    try {
        const schema = type.split('').sort((a) => {
            if (a == 'm') {
                return 0
            }
            return -1;
        }).map(ctype => ({type: supportedTypes[ctype]}));
        await GeneratorInstance.addComponents(schema, targetDir, projectConfig);
    } catch (e) {
        throw e;
    }
}

const throwErrorForInvalidComponentTypes = componentType => {
    jeliUtils.console.error(`unsupported componentType "${jeliUtils.colors.yellow(componentType)}"\n`)
    jeliUtils.console.header(`Supported types:`)
    jeliUtils.console.warn(`${Object.values(supportedTypes).join(' | ')}`)
    jeliUtils.console.warn(`${Object.keys(supportedTypes).join(' | ')}`)
    jeliUtils.abort("")
}

module.exports = async(...args) => {
    ComponentGenerator(...args).catch(err => {
        jeliUtils.console.error(`Error while running task.\n${err.message}`);
    });
}
const path = require('path');
const jeliUtils = require('@jeli/cli-utils');
const { getJeliJson, validateProjectAndWorkSpace, getTemplatePath, updateContent } = require('../create/utils');

const parsePathName = pathName => {
    const spltPathName = jeliUtils.splitAndTrim(jeliUtils.is(pathName.charAt(0), '/') ? pathName.substring(1) : pathName, '/');
    spltPathName[spltPathName.length - 1] = jeliUtils.kebabCase(spltPathName[spltPathName.length - 1]);
    return spltPathName.join('/');
}

async function ComponentGenerator(componentType, pathName, options) {
    const cwd = process.cwd();
    const supportedTypes = { e: "element", s: "service", d: "directive", m: "module", p: "pipe" };
    if (!supportedTypes.hasOwnProperty(componentType) && !Object.values(supportedTypes).includes(componentType)) {
        jeliUtils.console.error(`unsupported componentType "${jeliUtils.colors.yellow(componentType)}"\n`)
        jeliUtils.console.header(`Supported types:`)
        jeliUtils.console.warn(`${Object.values(supportedTypes).join(' | ')}`)
        jeliUtils.console.warn(`${Object.keys(supportedTypes).join(' | ')}`)
        jeliUtils.abort("")
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
    const targetDir = path.resolve(cwd, projectConfig.sourceRoot, jeliUtils.is(projectConfig.type, 'application') ? 'app' : '.', parsePathName(pathName));
    const fs = require('fs-extra');
    const name = path.basename(targetDir);
    const type = supportedTypes[componentType.charAt(0)];
    const replacerData = {
        name: jeliUtils.pascalCase(name),
        filename: `${name}.${type}`
    };
    const templatePath = getTemplatePath(`generators/${type}.gs`);
    const output = ['.js'];
    /**
     * initializer
     */
    const generators = ({
        element: () => {
            fs.ensureDirSync(targetDir);
            replacerData.styling = projectConfig.styling;
            replacerData.selector = `${projectConfig.prefix}-${name}`;
            const dirPath = `${targetDir}/${replacerData.filename}`;
            updateContent(templatePath, replacerData, `${dirPath}.js`);
            fs.writeFileSync(`${dirPath}.html`, `<p> ${replacerData.selector} works!</p>`);
            fs.writeFileSync(`${dirPath}.${replacerData.styling}`, '');
            output.push.apply(output, ['.html', `.${replacerData.styling}`]);
        },
        directive: () => {
            fs.ensureDirSync(targetDir);
            replacerData.selector = jeliUtils.camelCase(name);
            updateContent(templatePath, replacerData, `${targetDir}/${replacerData.filename}.js`);
        },
        service: () => {
            fs.ensureDirSync(path.dirname(targetDir));
            updateContent(templatePath, replacerData, `${targetDir}.${type}.js`);
        },
        module: () => {
            fs.ensureDirSync(targetDir);
            updateContent(templatePath, replacerData, `${targetDir}/${replacerData.filename}.js`);
        }
    });

    try {
        generators[type]();
        jeliUtils.console.success(output.map(ext => `created ${replacerData.filename}${ext}`).join('\n'))
    } catch (e) {
        throw e;
    }
}

module.exports = async(...args) => {
    ComponentGenerator(...args).catch(err => {
        jeliUtils.console.error('Error while running task.');
    });
}
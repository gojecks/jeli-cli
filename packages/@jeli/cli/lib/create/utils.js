const fs = require('fs-extra');
const path = require('path');
const jeliUtils = require('@jeli/cli-utils');
const shell = require('shelljs');
const execa = require('execa');

const getTemplatePath = name => path.resolve(__dirname, '../../templates', name || '');
const getJeliSchemaFilePath = targetDir => path.join(targetDir, 'jeli.json');
const getJeliJson = targetDir => {
    const filePath = getJeliSchemaFilePath(targetDir);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    return null;
};

const updateJeliSchema = async(projectData, dir) => {
    const json = getJeliJson(dir);
    if (json) {
        /**
         * default config
         */
        if (!json.projects.hasOwnProperty(projectData.name)) {
            json.projects[projectData.name] = {
                sourceRoot: projectData.sourceroot,
                prefix: projectData.prefix,
                output: {}
            };
        }
        /**
         * set the variant here should incase project name already exists and variant was changed
         */
        json.projects[projectData.name].type = projectData.variant;

        if (jeliUtils.is('application', projectData.variant)) {
            json.projects[projectData.name].styling = projectData.style;
            json.projects[projectData.name].output = {
                folder: "dist/",
                view: "index.html",
                entryFile: "main.js"
            }
        } else {
            json.projects[projectData.name].output = {
                generateMeta: true,
                patterns: ["UMD", "MODULE"],
                folder: "dist/",
                files: {}
            };

            json.projects[projectData.name].output.files[projectData.name] = "index.js";
        }

        if (projectData.doc) {
            json.projects[projectData.name].output.doc = {
                source: projectData.sourceroot,
                destination: "./docs",
                plugins: [{
                    name: "esdoc-standard-plugin"
                }]
            };
        }
        // save the update json
        fs.writeFileSync(getJeliSchemaFilePath(dir), JSON.stringify(json, null, 3));
    }
};

const updatePackageJSON = async(projectData) => {
    const filePath = path.join(projectData.targetDir, 'package.json');
    const json = JSON.parse(fs.readFileSync(filePath), 'utf8');
    json.devDependencies["node-sass"] = "^4.9.0";
    if (projectData.doc) {
        json.devDependencies["esdoc"] = "^1.1.0";
        json.devDependencies["esdoc-standard-plugin"] = "^1.0.0";
    }

    if (projectData.router) {
        json.dependencies["@jeli/router"] = "^0.0.1";
    }

    json.name = projectData.name;
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2));
};

/**
 * 
 * @param {*} name 
 * @param {*} targetDir 
 * @param {*} variant 
 */
const copyTemplate = async(name, targetDir, variant) => {
    const dir = path.join(targetDir, name);
    if (!fs.existsSync(dir)) {
        jeliUtils.console.write(`creating folder : ${path.relative(targetDir, dir) || path.basename(targetDir)}`);
        fs.mkdirSync(dir);
    }

    jeliUtils.console.write(`copying ${variant} templates`);
    const templatePath = getTemplatePath(variant);
    if (fs.existsSync(templatePath)) {
        shell.cp('-R', `${templatePath}/*`, dir);
        /**
         * shell doesn't copy .fileName files
         * we have to copy the .fileNames manually
         */
        if (jeliUtils.is(variant, 'default')) {
            ['.esdoc.json', '.eslintrc.json', '.gitignore'].forEach(fileName => {
                jeliUtils.console.write(`creating ${fileName}`);
                shell.cp(`${templatePath}/${fileName}`, dir);
            });
        }
    }
};

const replaceVariablesInTemplate = async projectData => {
    // Replace variable values in all files
    shell.ls('-Rl', projectData.targetDir).forEach(file => {
        if (file.isFile()) {
            updateContent(path.join(projectData.targetDir, file.name), projectData);

        }
    });
};

const updateContent = (filePath, options, outputFilePath) => {
    // Replace '[VARIABLE]` with the corresponding variable value from the prompt
    const content = fs.readFileSync(filePath, 'utf8').replace(/\[(.*)\]/g, (_, key) => {
        return options.hasOwnProperty(key.toLowerCase()) ? options[key.toLowerCase()] : _;
    });

    fs.writeFileSync(outputFilePath || filePath, content);
};

const removeFiles = async projectData => {
    // Remove MIT License file if another is specified
    if (projectData.license && !jeliUtils.is(projectData.license, 'MIT')) {
        jeliUtils.console.write(`removing default LICENSE file`);
        shell.rm(`${projectData.targetDir}/LICENSE`);
    }

    // Remove router file
    if (!projectData.router && jeliUtils.is(projectData.variant, 'application')) {
        jeliUtils.console.write(`removing router configuration`);
        shell.rm(`${projectData.targetDir}/${projectData.sourceroot}/app/app.router.js`);
    }

    if (projectData.style) {
        shell.rm(`${projectData.targetDir}/${projectData.sourceroot}/app/app.element.${projectData.style == 'css' ? 'scss':'css'}`);
    }
};

const gitInit = async projectData => {
    if (!projectData.initGit) return;
    await run('git', ['init'], projectData.targetDir);
    await run('git', ['add', '-A'], projectData.targetDir);

    try {
        await run('git', ['commit', '-m', 'initial commit'], projectData.targetDir);
    } catch (err) {
        jeliUtils.console.warn(`Failed to run git commit, you will need to perform initial commit.\n`)
    }
};

const run = async(cmd, args, cwd) => {
    return execa(cmd, args, { cwd })
};

exports.addProject = async projectData => {
    try {
        let folderName = projectData.sourceroot;
        if (!projectData.dirExist) {
            projectData.sourceroot = projectData.name;
            /**
             * create the application in the targetDir
             */
            folderName = '';
        }
        await copyTemplate(folderName, projectData.targetDir, projectData.variant);
        await updateJeliSchema(projectData, path.resolve(projectData.targetDir, '..'));
        await replaceVariablesInTemplate(projectData);
    } catch (e) {
        jeliUtils.console.error(`unable to add ${jeliUtils.colors.cyan(projectData.variant)} project.`);
    }
}


/**
 * check if targetDir is a jeli project
 */
exports.isJeliProject = targetDir => fs.existsSync(targetDir) && fs.existsSync(getJeliSchemaFilePath(targetDir));

exports.createProject = async projectData => {
    try {
        jeliUtils.console.write(`✨Creating project in ${jeliUtils.colors.yellow(projectData.targetDir)}.`);
        await copyTemplate('', projectData.targetDir, 'default');
        await copyTemplate(projectData.sourceroot, projectData.targetDir, projectData.variant);
        await removeFiles(projectData);
        await replaceVariablesInTemplate(projectData);
        await updateJeliSchema(projectData, projectData.targetDir);
        await updatePackageJSON(projectData);
        await gitInit(projectData)
    } catch (e) {
        console.log(e)
        jeliUtils.console.error(`unable to generate ${jeliUtils.colors.cyan(projectData.variant)}`);
        throw false;
    }
};

exports.validateProjectAndWorkSpace = (jeliJson, projectName) => {
    if (!jeliJson) {
        jeliUtils.abort(`\nUnable to determine schema for this project, are you sure this is a jeli workspace?\n run "${jeliUtils.colors.yellow('jeli create PROJECT_NAME')}" to create a new project.`);
    } else if (!jeliJson.projects.hasOwnProperty(projectName)) {
        jeliUtils.abort(`project ${jeliUtils.colors.cyan(projectName)} does not exists in this workspace.`);
    }
}


exports.getJeliJson = getJeliJson;
exports.getJeliSchemaFilePath = getJeliSchemaFilePath;
exports.getTemplatePath = getTemplatePath;
exports.updateContent = updateContent;
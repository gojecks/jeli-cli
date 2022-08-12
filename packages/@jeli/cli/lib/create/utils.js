const fs = require('fs-extra');
const path = require('path');
const jeliUtils = require('@jeli/cli-utils');
const shell = require('shelljs');
const execa = require('execa');

exports.getTemplatePath = name => path.resolve(__dirname, '../../templates', name || '');
exports.getJeliSchemaFilePath = targetDir => path.join(targetDir, 'jeli.json');
exports.getJeliJson = targetDir => {
    const filePath = this.getJeliSchemaFilePath(targetDir);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    return null;
};

exports.updateJeliSchema = async(projectData, dir) => {
    const json = this.getJeliJson(dir);
    if (json) {
        /**
         * default config
         */
        if (!json.projects.hasOwnProperty(projectData.name)) {
            json.projects[projectData.name] = {
                sourceRoot: projectData.sourceroot,
                prefix: projectData.prefix,
                output: {},
                resolve: {}
            };
        }
        /**
         * set the variant here should incase project name already exists and variant was changed
         */
        json.projects[projectData.name].type = projectData.variant;
        if (jeliUtils.is('application', projectData.variant)) {
            json.projects[projectData.name].styling = projectData.style;
            let replace = {};
            replace[`${projectData.sourceroot}/environments/env.js`] = `${projectData.sourceroot}/environments/env.prod.js`;
            json.projects[projectData.name].configurations = {
                production: {
                    buildOptions: {
                        replace
                    }
                },
                serve: {
                    serverOptions: {
                        port: 4110
                    }
                }
            };
            json.projects[projectData.name].output = {
                folder: "dist/",
                view: "index.html",
                styles: [`${projectData.sourceroot}/styles.scss`],
                entryFile: "main.js",
                copy: [{
                    src: `${projectData.sourceroot}/assets/`,
                    dest: "dist/assets/"
                }]
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
        fs.writeFileSync(this.getJeliSchemaFilePath(dir), JSON.stringify(json, null, 3));
    }
};

exports.updatePackageJSON = async(projectData) => {
    const filePath = path.join(projectData.targetDir, 'package.json');
    const json = JSON.parse(fs.readFileSync(filePath), 'utf8');
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

exports.getDir = async(...args) => {
    let targetDir = "";
    args.forEach(projectRoot => {
        targetDir = path.join(targetDir, projectRoot);
        if (!fs.existsSync(targetDir)) {
            jeliUtils.console.write(`creating folder : ${projectRoot}`);
            fs.mkdirSync(targetDir);
        }
    });

    return targetDir;
}

/**
 * 
 * @param {*} name 
 * @param {*} targetDir 
 * @param {*} variants
 */
exports.copyTemplate = async(name, targetDir, variants) => {
    const dir = await this.getDir(targetDir, name);
    variants.forEach(variant => {
        jeliUtils.console.write(`copying ${variant} templates`);
        const templatePath = this.getTemplatePath(variant);
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
    });
};

exports.replaceVariablesInTemplate = async projectData => {
    // Replace variable values in all files
    shell.ls('-Rl', projectData.targetDir).forEach(file => {
        if (file.isFile()) {
            this.updateContent(path.join(projectData.targetDir, file.name), projectData);
        }
    });
};

exports.templateParser = (content, options) => {
    return content.replace(/\[(.*?)\]/g, (_, key) => {
        return options.hasOwnProperty(key.toLowerCase()) ? options[key.toLowerCase()] : _;
    });
}

exports.updateContent = (filePath, options, outputFilePath) => {
    // Replace '[VARIABLE]` with the corresponding variable value from the prompt
    const content = this.templateParser(fs.readFileSync(filePath, 'utf8'), options);
    fs.writeFileSync(outputFilePath || filePath, content);
};


exports.gitInit = async projectData => {
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


/**
 * check if targetDir is a jeli project
 */
exports.isJeliProject = targetDir => fs.existsSync(targetDir) && fs.existsSync(this.getJeliSchemaFilePath(targetDir));

exports.validateProjectAndWorkSpace = (jeliJson, projectName) => {
    if (!jeliJson) {
        jeliUtils.abort(`\nUnable to determine schema for this project, are you sure this is a jeli workspace?\n run "${jeliUtils.colors.yellow('jeli create PROJECT_NAME')}" to create a new project.`);
    } else if (!jeliJson.projects.hasOwnProperty(projectName)) {
        jeliUtils.abort(`project ${jeliUtils.colors.cyan(projectName)} does not exists in this workspace.`);
    }
}
const fs = require('fs-extra');
const path = require('path');
const jeliUtils = require('@jeli/cli-utils');
const shell = require('shelljs');

const getTemplatePath = name => path.resolve(__dirname, 'templates', name || '');
const getJeliSchemaFilePath = targetDir => path.join(targetDir, 'jeli.json');
const getJeliJson = targetDir => {
    const filePath = getJeliSchemaFilePath(targetDir);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    return null;
};

const updateJeliSchema = async(projectData) => {
    const json = getJeliJson(projectData.targetDir);
    if (json) {
        if (jeliUtils.is('application', projectData.variant)) {
            json.projects[projectData.name].output = {
                folder: "dist/",
                view: "index.html",
                entryFile: "main.js",
                styling: projectData.style
            }
        } else {
            json.projects[projectData.name].output = {
                generateMeta: true,
                patterns: ["UMD", "MODULE"],
                folder: "dist/",
                files: {}
            };

            json.projects[projectData.name].output.files[projectData.name] = "index.js";
            if (projectData.doc) {
                json.projects[projectData.name].output.doc = {
                    source: projectData.sourceroot,
                    destination: "./docs",
                    plugins: [{
                        name: "esdoc-standard-plugin"
                    }]
                }
            }
        }

        json.docgen = projectData.doc;
        // save the update json
        fs.writeFileSync(getJeliSchemaFilePath(projectData.targetDir), JSON.stringify(json, null, 3));
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
    fs.writeFileSync(filePath, JSON.stringify(json, null, 3));
};

const copyTemplate = async(name, projectData, variant) => {
    const dir = path.join(projectData.targetDir, name);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
    const templatePath = getTemplatePath(variant);
    if (fs.existsSync(templatePath)) {
        shell.cp('-R', `${templatePath}/*`, dir);
    }
};

const replaceVariablesInTemplate = async projectData => {
    // Remove MIT License file if another is specified
    if (!jeliUtils.is(projectData.license, 'MIT')) {
        shell.rm(`${projectData.targetDir}/${projectData.sourceroot}/app/app.router.js`);
    }

    // Remove router file
    if (!projectData.router) {
        shell.rm(`${projectData.targetDir}/LICENSE`);
    }

    // Replace variable values in all files
    shell.ls('-Rl', projectData.targetDir).forEach(file => {
        if (file.isFile()) {
            const fullFilePath = path.join(projectData.targetDir, file.name);
            // Replace '[VARIABLE]` with the corresponding variable value from the prompt
            let content = fs.readFileSync(fullFilePath, 'utf8').replace(/\[(.*)\]/g, (_, key) => {
                return projectData.hasOwnProperty(key.toLowerCase()) ? projectData[key.toLowerCase()] : _;
            });

            fs.writeFileSync(fullFilePath, content);
        }
    });
}

/**
 * validate if project already exists
 * with same variant
 * @param {*} projectData 
 */
const projectExists = projectData => {
    if (fs.existsSync(projectData.targetDir)) {
        const json = getJeliJson(projectData.targetDir);
        if (json && json.projects.hasOwnProperty(projectData.name)) {
            if (jeliUtils.is(json.projects[projectData.name].type, projectData.variant)) {
                jeliUtils.console.error(`project ${jeliUtils.colors.cyan(projectData.name)} already exists.`);
                jeliUtils.console.write(`to create a new ${jeliUtils.colors.cyan(projectData.variant)} run "${jeliUtils.colors.cyan('jeli new '+ projectData.name)}"`);
                jeliUtils.abort("");
            } else {
                return true;
            }
        }
    }

    return false;
};

const addProject = async projectData => {

}


exports.createProject = async(projectData) => {
    jeliUtils.console.write('creating project...');
    try {
        projectData.sourceroot = (jeliUtils.is(projectData.variant, 'application') ? 'src' : 'library');
        await copyTemplate('', projectData, 'default');
        await copyTemplate(projectData.sourceroot, projectData, projectData.variant);
        await replaceVariablesInTemplate(projectData);
        await updateJeliSchema(projectData);
        await updatePackageJSON(projectData);
    } catch (e) {
        console.log(e);
        jeliUtils.console.error(`unable to generate project reason: project "${jeliUtils.colors.cyan(projectData.variant)}" not found`);
        throw false;
    }
};
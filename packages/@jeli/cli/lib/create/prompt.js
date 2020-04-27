const inquirer = require('inquirer');
const fs = require('fs-extra');
const path = require('path');
const promptJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'prompt.json')));



/**
 * Project prompt method
 */
exports.projectPrompt = async(name, targetDir, availablePkgMgr) => {
    const projectData = await this.promptStatic('projectType');
    if (projectData.variant === 'application') {
        promptJson.main.push.apply(promptJson.main, promptJson.application);
    }
    const mainData = await this.promptStatic('main');
    promptJson.packageManager[0].choices = Object.keys(availablePkgMgr);
    const packageManager = await this.promptStatic('packageManager');
    Object.assign(projectData, mainData, packageManager);
    projectData.year = new Date().getFullYear();
    projectData.name = name;
    projectData.targetDir = targetDir;
    projectData.selector = `${projectData.prefix}-${projectData.name}`;

    return projectData;
}


exports.confirmDirectoryOption = async directory => {
    return await inquirer.prompt([{
        name: 'action',
        type: 'list',
        message: `Directory ${directory} already exists. Pick an action:`,
        choices: [
            { name: 'Overwrite', value: 2 },
            { name: 'Merge', value: 1 },
            { name: 'Cancel', value: 0 }
        ]
    }])
};

exports.promptStatic = async promptId => {
    return await inquirer.prompt(promptJson[promptId]);
}

exports.prompt = async questions => {
    return await inquirer.prompt(questions);
}
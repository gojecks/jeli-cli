const inquirer = require('inquirer');
const fs = require('fs-extra');
const path = require('path');
const promptJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'prompt.json')));
const jeliUtils = require('@jeli/cli-utils');


const isValid = (condition, state) => {
    return condition.some(quest => {
        const keys = Object.keys(quest);
        return keys.filter(key => {
            return jeliUtils.is(state[key], quest[key])
        }).length == keys.length;
    });
}

const validateFolder = async(answer, targetDir) => {
    /**
     * override option
     */
    if (answer.dirOption == 2) {
        jeliUtils.console.write(`\nRemoving ${jeliUtils.colors.cyan(targetDir)}...`)
        await fs.remove(targetDir);
    }
    /**
     * cancel option
     */
    else if (answer.dirOption == 0) {
        jeliUtils.abort('Please select a different folder');
    }
}

exports.answers = async(questions, projectData) => {
    for (const question of questions) {
        if (!question.cond || isValid(question.cond, projectData)) {
            const answer = await this.promptStatic(question.promptId, question.extend);
            if (question.validate) {
                await question.validate(answer);
            }

            Object.assign(projectData, answer);
        }
    }

    return projectData;
}

/**
 * Project prompt method
 */
exports.projectPrompt = async(jeliWorkSpace, name, targetDir, projectExists, availablePkgMgr) => {
    const dirExist = fs.existsSync(targetDir);
    const projectData = await this.answers([{
            promptId: "directoryExist",
            cond: [{
                dirExist: true
            }],
            validate: answer => validateFolder(answer, targetDir)
        },
        {
            promptId: 'projectType'
        },
        {
            promptId: 'main',
            cond: [{
                jeliWorkSpace: false
            }, {
                dirOption: 2,
                projectExists: true
            }]
        },
        {
            promptId: "sourceRoot",
            cond: [{
                jeliWorkSpace: false
            }, {
                dirOption: 2,
                projectExists: true
            }],
            extend: [{
                default: name + '-src'
            }]
        },
        {
            cond: [{
                variant: "application"
            }],
            promptId: "application"
        },
        {
            promptId: "prefix"
        },
        {
            cond: [{
                jeliWorkSpace: false
            }, {
                dirOption: 2,
                projectExists: true
            }],
            promptId: 'packageManager',
            extend: [{
                choices: Object.keys(availablePkgMgr)
            }]
        }
    ], { dirExist, projectExists, jeliWorkSpace });

    projectData.year = new Date().getFullYear();
    projectData.name = name;
    projectData.targetDir = targetDir;
    projectData.selector = `${projectData.prefix}-${projectData.name}`;
    projectData.jeliviewentry = `<${projectData.name}></${projectData.name}>`;
    projectData.sourceroot = projectData.sourceroot || name;

    return projectData;
}

exports.promptStatic = async(promptId, add) => {
    if (add) {
        add.forEach((content, idx) => Object.assign(promptJson[promptId][idx], content));
    }
    return await inquirer.prompt(promptJson[promptId]);
}

exports.prompt = async questions => {
    return await inquirer.prompt(questions);
}
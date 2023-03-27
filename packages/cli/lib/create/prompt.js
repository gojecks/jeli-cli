const inquirerAsync = import('inquirer');
const jeliUtils = require('../utils');
const { getSchema, runConditions, removeDir, isDirExists } = require('./utils');

const promptJson = getSchema('questionnaire-master.json');
const promptHelpers = {
    keys: function(key, replacerData) {
        return Object.keys(replacerData[key] || {});
    },
    concat: function(value, replacer) {
        return (value || '').replace(/\{\{(.*)\}\}/g, (_, k) => (replacer[k] || ''))
    }
};

const getDynamicValue = (content, replacerData) => {
    if (content.fn && promptHelpers.hasOwnProperty(content.fn)) {
        return promptHelpers[content.fn](content.args, replacerData);
    }
}

const validators = {
    validateFolder: async(answer, targetDir) => {
        /**
         * override option
         */
        if (answer.dirOption == 2) {
            jeliUtils.console.write(`\nRemoving ${jeliUtils.colors.cyan(targetDir)}...`)
            removeDir(targetDir);
        }
        /**
         * cancel option
         */
        else if (answer.dirOption == 0) {
            jeliUtils.abort('Please select a different folder');
        }
    }
};



exports.answers = async(questions, projectData) => {
    for (const question of questions) {
        if (runConditions(question.cond, projectData)) {
            const answer = await this.promptStatic(question, projectData);
            if (question.validate && validators.hasOwnProperty(question.validate.fn)) {
                var args = question.validate.args.map(key => {
                    // symbol for answers
                    if (key == '$') {
                        return answer
                    } else {
                        return projectData[key] || null;
                    }
                });
                await validators[question.validate.fn].apply(null, args);
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
    const dirExist = isDirExists(targetDir);
    const projectJsonPrompt = getSchema('create-new.json');
    const projectData = await this.answers(projectJsonPrompt, { name, targetDir, availablePkgMgr, dirExist, projectExists, jeliWorkSpace });
    projectData.year = new Date().getFullYear();
    projectData.selector = `${projectData.prefix}-${projectData.name}`;
    projectData.jeliviewentry = `<${projectData.name}></${projectData.name}>`;
    projectData.sourceroot = projectData.sourceroot || name;
    projectData.version = projectData.version || '1.0.0';

    return projectData;
}

exports.promptStatic = async(questionMapper, replacerData = {}) => {
    var questions = promptJson[questionMapper.promptId] || questionMapper.questions;
    if (!questions) return null;
    if (questionMapper.extend) {
        questionMapper.extend.forEach((content, idx) => {
            questions[idx][content.props] = getDynamicValue(content, replacerData);
        });
    }

    return await this.prompt(questions);
}

exports.prompt = async questions => {
    const inquirer = await inquirerAsync;
    return await inquirer.default.prompt(questions);
}
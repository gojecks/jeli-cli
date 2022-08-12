const inquirer = require('inquirer');
const fs = require('fs-extra');
const path = require('path');
const jeliUtils = require('@jeli/cli-utils');
const getPromptSchema = filePath => JSON.parse(fs.readFileSync(path.join(__dirname, filePath), 'utf8'));
const promptJson = getPromptSchema('../../schemas/questionnaire-master.json');
const promptHelpers = {
    keys: function(key, replacerData) {
        return Object.keys(replacerData[key] || {});
    },
    concat: function(value, replacer) {
        return value.reduce(function(accum, key) {
            if (replacer.hasOwnProperty(key)) {
                accum += replacer[key];
            } else {
                accum += key;
            }
            return accum;
        }, '')
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
            await fs.remove(targetDir);
        }
        /**
         * cancel option
         */
        else if (answer.dirOption == 0) {
            jeliUtils.abort('Please select a different folder');
        }
    }
};

const isValid = (condition, state) => {
    return condition.some(quest => {
        const keys = Object.keys(quest);
        return keys.filter(key => {
            return jeliUtils.is(state[key], quest[key])
        }).length == keys.length;
    });
}

exports.answers = async(questions, projectData) => {
    for (const question of questions) {
        if (!question.cond || isValid(question.cond, projectData)) {
            const answer = await this.promptStatic(question);
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
    const dirExist = fs.existsSync(targetDir);
    const projectJsonPrompt = getPromptSchema('../../schemas/create-new.json');
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

    return await inquirer.prompt(questions);
}

exports.prompt = async questions => {
    return await inquirer.prompt(questions);
}
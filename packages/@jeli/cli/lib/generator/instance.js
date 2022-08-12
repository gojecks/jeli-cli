const fs = require('fs-extra');
const path = require('path');
const jeliUtils = require('@jeli/cli-utils');
const {
    getTemplatePath,
    copyTemplate,
    updateJeliSchema,
    replaceVariablesInTemplate,
    updatePackageJSON,
    gitInit,
    getDir,
    updateContent,
    templateParser
} = require('../create/utils');

class GeneratorInstance {
    constructor(type, options) {
        this.options = options;
        this.name = path.basename(options.targetDir);
        this.fnName = jeliUtils.pascalCase(options.name || this.name);
        this.dir = path.dirname(options.targetDir);
        this.output = ['.js'];
        this.setTemplatePath(type);
        this.moduleParams = {
            imports: [],
            selectors: [''],
            rootElement: '',
            modules: [],
            services: []
        };
    }

    setTemplatePath(type) {
        this.templatePath = getTemplatePath(`generators/${type}.gs`);
        this.type = type;
    }

    setReplacerContent(...args) {
        this.replacerData = Object.assign({
            name: this.fnName,
            filename: `${this.name}.${this.type}`,
            type: this.type
        }, ...args);
    }

    throwErrorIfExists() {
        if (fs.existsSync(`${this.options.targetDir}/${this.name}.${this.type}.js`)) {
            throw Error(`${this.name} already exisits.`);
        }
    }

    async element(additionalConfig = {}) {
        fs.ensureDirSync(this.options.targetDir);
        this.setReplacerContent({
            styling: this.options.projectConfig.styling || 'scss',
            selector: `${this.options.projectConfig.prefix}-${this.name}`,
            viewContent: `<p> ${this.options.projectConfig.prefix}-${this.name} works!</p>`,
            scriptcontent: ''
        }, additionalConfig);
        const dirPath = `${this.options.targetDir}/${this.replacerData.filename}`;
        updateContent(this.templatePath, this.replacerData, `${dirPath}.js`);
        fs.writeFileSync(`${dirPath}.html`, this.replacerData.viewContent);
        fs.writeFileSync(`${dirPath}.${this.replacerData.styling}`, '');
        this.output = ['.js', '.html', `.${this.replacerData.styling}`];
        this.addModuleParams('Element', 'element');
    }

    async directive() {
        fs.ensureDirSync(this.dir);
        this.setReplacerContent({
            selector: `${jeliUtils.camelCase(this.name)}`
        });
        updateContent(this.templatePath, this.replacerData, `${this.dir}/${this.replacerData.filename}.js`);
        this.output = ['.js'];
        this.addModuleParams('Directive', 'directive');
    }

    async service() {
        fs.ensureDirSync(this.dir);
        this.setReplacerContent();
        updateContent(this.templatePath, this.replacerData, `${this.dir}/${this.replacerData.filename}.js`);
        this.addModuleParams('Service', 'service');
        this.output = ['.js'];
    }

    async pipe() {
        return this.service();
    }

    async module(config = {}) {
        fs.ensureDirSync(this.options.targetDir);
        if (this.moduleParams.selectors.length) {
            this.moduleParams.selectors.unshift(`,\n\tselectors: [`);
            this.moduleParams.selectors.push('\n\t]');
        }

        this.setReplacerContent({
            imports: this.moduleParams.imports.join('\n'),
            selectors: this.moduleParams.selectors.join(''),
            modules: this.moduleParams.modules.join(',\n'),
            rootelement: this.moduleParams.rootElement,
            services: this.moduleParams.services.join('\n')
        }, config);
        updateContent(this.templatePath, this.replacerData, `${this.options.targetDir}/${this.replacerData.filename}.js`);
        this.output = ['.js'];
    }

    async router() {
        fs.ensureDirSync(this.options.targetDir);
        this.setReplacerContent();
        updateContent(this.templatePath, this.replacerData, `${this.options.targetDir}/${this.replacerData.filename}.js`);
        this.addModuleParams('RouterModule', 'router');
        this.output = ['.js'];
    }

    async main() {
        this.setReplacerContent();
        updateContent(this.templatePath, this.replacerData, `${this.options.projectConfig.targetDir}/main.js`);
    }

    addModuleParams(name, fileName) {
        this.moduleParams.imports.push(`import {${this.fnName}${name}} from './${this.name}.${fileName}.js';`);
        switch (fileName) {
            case ('router'):
                this.moduleParams.modules.push(`${this.fnName}${name}`);
                break;
            case ('directive'):
            case ('element'):
                this.moduleParams.selectors.push(`\n\t\t${this.fnName}${name},`);
                break;
        }
    }

    /**
     * 
     * @param {*} components 
     * @param {*} targetDir 
     * @param {*} projectConfig 
     */
    static addComponents = async(components, targetDir, projectConfig) => {
        const generators = new GeneratorInstance(null, {
            targetDir,
            projectConfig
        });

        components.forEach(ctype => {
            jeliUtils.console.write(`creating ${ctype} ...`);
            generators.setTemplatePath(ctype);
            generators.throwErrorIfExists();
            generators[ctype]();
            jeliUtils.console.success(generators.output.map(ext => `created ${generators.replacerData.filename}${ext}`).join('\n'))
        });
    }

    static addProject = async projectData => {
        try {
            if (!projectData.dirExist) {
                projectData.sourceroot = projectData.name;
            }

            const targetDir = await getDir(projectData.targetDir, projectData.prefix);
            await copyTemplate('', projectData.targetDir, [projectData.variant]);

            /**
             * only generate components if project variant is applicationn
             */
            if (!jeliUtils.is(projectData.variant, 'library')) {
                const generators = new GeneratorInstance('element', {
                    projectConfig: projectData,
                    targetDir,
                    name: projectData.name
                });
                // generate base Element
                await generators.element({
                    scriptcontent: `this.appName = '${projectData.name}';`,
                    selector: projectData.name,
                    styling: projectData.style || 'scss',
                    viewContent: '<h1>Welcome ${appName},</h1>\n<h2>Application works!!</h2>'
                });

                if (projectData.router) {
                    generators.setTemplatePath('router');
                    await generators.router();
                }

                generators.setTemplatePath('module');
                generators.module({
                    rootelement: `,\n\trootElement: ${generators.fnName}Element`
                });
                /**
                 * create the entry files
                 */
                generators.setTemplatePath('main');
                await generators.main();
            }

            await updateJeliSchema(projectData, path.resolve(projectData.targetDir, '..'));
            await replaceVariablesInTemplate(projectData);
        } catch (e) {
            jeliUtils.console.error(e);
            jeliUtils.console.error(`unable to add ${jeliUtils.colors.cyan(projectData.variant)} project.`);
        }
    }

    static createProject = async projectData => {
        try {
            jeliUtils.console.write(`✨Creating project in ${jeliUtils.colors.yellow(projectData.targetDir)}.`);
            const targetDir = await getDir(projectData.targetDir, projectData.sourceroot);
            await copyTemplate('', projectData.targetDir, ['default']);
            await copyTemplate('', targetDir, [projectData.variant]);
            await updateJeliSchema(projectData, projectData.targetDir);
            await updatePackageJSON(projectData);
            await replaceVariablesInTemplate(projectData);
            await gitInit(projectData);
        } catch (e) {
            jeliUtils.console.error(e);
            jeliUtils.console.error(`unable to generate ${jeliUtils.colors.cyan(projectData.variant)}`);
        }
    };
}

module.exports = GeneratorInstance;
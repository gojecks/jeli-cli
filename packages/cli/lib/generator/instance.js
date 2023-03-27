const fs = require('fs-extra');
const path = require('path');
const jeliUtils = require('../utils/index');
const {
    getTemplatePath,
    copyTemplate,
    updateJeliSchema,
    replaceVariablesInTemplate,
    updatePackageJSON,
    getDir,
    updateContent,
    getSchema,
    runConditions
} = require('../create/utils');

class GeneratorInstance {
    constructor(type, options) {
        this.options = options;
        this.name = path.basename(options.targetDir);
        this.fnName = options.name || jeliUtils.pascalCase(this.name);
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
            type: this.type,
            prefix: this.options.projectConfig.prefix
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
        updateContent(this.templatePath, this.replacerData, path.resolve(this.options.targetDir, '../main.js'));
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
    static addComponents = async (components, targetDir, projectConfig) => {
        if (!components) throw new Error(`Invalid generator schema, please try again`);
        const generators = new GeneratorInstance(null, {
            targetDir,
            projectConfig,
            name: projectConfig.fnname
        });

        components.forEach(config => {
            if (runConditions(config.condition, projectConfig)) {
                generators.setTemplatePath(config.type);
                generators.throwErrorIfExists();
                generators[config.type](config.values);
                jeliUtils.console.success(generators.output.map(ext => `created ${generators.replacerData.filename}${ext}`).join('\n'))
            }
        });
    }

    static addProject = async (projectData, fromMain) => {
        try {
            if (!projectData.dirExist && !fromMain) {
                projectData.sourceroot = projectData.name;
            }
            const sourcePath = (projectData.sourcePath || projectData.targetDir);
            const targetDir = await getDir(sourcePath, projectData.prefix);
            await copyTemplate('', sourcePath, [projectData.variant]);
            // copy misc files for nested projects
            if (!fromMain) {
                await copyTemplate('', sourcePath, ['misc']);
            }

            /**
             * only generate components if project variant is applicationn
             */
            if (!jeliUtils.is(projectData.variant, 'library')) {
                const name = fromMain ? projectData.name : null;
                if (fromMain) projectData.fnname = jeliUtils.pascalCase(name);
                const applicationSchema = getSchema('application.json', projectData);
                GeneratorInstance.addComponents(applicationSchema, targetDir, projectData);
            }

            await updateJeliSchema(projectData, path.resolve(projectData.targetDir, !fromMain ? '..': ''));
            await replaceVariablesInTemplate(projectData);
        } catch (e) {
            jeliUtils.console.error(e);
            jeliUtils.console.error(`unable to add ${jeliUtils.colors.cyan(projectData.variant)} project.`);
        }
    }

    static createProject = async projectData => {
        try {
            jeliUtils.console.write(`✨Creating project in ${jeliUtils.colors.yellow(projectData.targetDir)}`);
            projectData.sourcePath = await getDir(projectData.targetDir, projectData.sourceroot);
            await copyTemplate('', projectData.targetDir, ['default']);
            await GeneratorInstance.addProject(projectData, true);
            await updatePackageJSON(projectData);
        } catch (e) {
            jeliUtils.console.error(e);
            jeliUtils.console.error(`unable to generate ${jeliUtils.colors.cyan(projectData.variant)}`);
        }
    };
}

module.exports = GeneratorInstance;
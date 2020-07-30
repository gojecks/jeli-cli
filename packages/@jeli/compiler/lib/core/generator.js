const helper = require('@jeli/cli-utils');
const htmlParser = require('./html_parser');
const { CoreQuerySelector } = require('./query_selector');
const { outputApplicationFiles, outputLibraryFiles, pushStyle } = require('./output');
const { findTokenInGlobalImports, isExportedToken, getPipeProvider } = require('./compilerobject');
const { attachViewSelectorProviders } = require('./view.provier');
const annotationProps = ['name', 'selector', 'exportAs', 'module'];

/**
 * 
 * @param {*} compilerObject 
 * @param {*} loader 
 * @param {*} entry 
 */
async function CoreGenerator(compilerObject, loader, entry) {
    let scriptBody = '';
    /**
     * 
     * @param {*} definition 
     */
    function compile(definition) {
        switch (definition.type.toLowerCase()) {
            case ('service'):
            case ('provider'):
            case ('pipe'):
                _resolveDependecies(compilerObject.services[definition.fn], definition.fn, definition.filePath);
                definition.annotations.push(`${definition.fn}.annotations = ${writeAnnot(compilerObject.services[definition.fn], annotationProps)};`);
                quoteFix(annotationProps, compilerObject.services[definition.fn]);
                if (compilerObject.services[definition.fn].static) {
                    definition.annotations.push(`${definition.fn}.annotations.instance = ${definition.fn};`);
                }
                break;
            case ('directive'):
            case ('element'):
                const obj = compilerObject[definition.type][definition.fn];
                if (!obj.module) {
                    helper.abort(`${helper.colors.yellow(definition.fn)} is not registered to any Module`);
                }
                const template = obj.template;
                const style = obj.style;
                delete obj.template;
                delete obj.style;
                _resolveDependecies(obj, definition.fn, definition.filePath);
                definition.annotations.push(`${definition.fn}.annotations = ${writeAnnot(obj, annotationProps)};`);
                quoteFix(annotationProps, obj);
                if (helper.is(definition.type, 'Element')) {
                    if (template) {
                        const parsedHtml = htmlParser(template, obj, compilerResolver, definition.fn);
                        if (parsedHtml.errorLogs.length) {
                            helper.console.header(`TemplateCompilerError -> Element<${definition.fn}> : ${definition.filePath}`);
                            parsedHtml.errorLogs.forEach(helper.console.error);
                            helper.abort();
                        }
                        definition.annotations.push(`${definition.fn}.view = /** jeli template **/ new ViewParser(${attachViewProviders(definition.filePath, parsedHtml)}, ${JSON.stringify(parsedHtml.templatesMapHolder)}) /** template loader **/;`);
                    }

                    // style parser
                    if (style) {
                        pushStyle({
                            name: definition.fn,
                            style
                        });
                        // definition.annotations.push(`${definition.fn}.style = ${helper.stringifyContent(style)};`);
                    }
                }
                break;
            case ('jmodule'):
                /**
                 * compile @config and @initializers
                 */
                definition.annotations.push(`${definition.fn}.annotations = ${writeAnnot(compilerObject.modules[definition.fn])};`);
                break;
        }

        return generateScript(definition);
    }

    /**
     * 
     * @param {*} annot 
     */
    function writeAnnot(annot, props) {
        if (props) {
            quoteFix(props, annot, true);
        }
        return JSON.stringify(annot, null, 4).replace(/["]/g, '');
    }

    /**
     * This function set or remove singleQuote from property value
     * e.g ["'selector'","'exportAs'"]
     * @param {*} props 
     * @param {*} annot 
     */
    function quoteFix(props, annot, addQuote) {
        props.forEach(prop => {
            if (annot.hasOwnProperty(prop)) {
                annot[prop] = addQuote ? `'${annot[prop]}'` : helper.removeSingleQuote(annot[prop]);
            }
        });
    }

    /**
     * 
     * @param {*} processFilePath 
     * @param {*} parsedHtml 
     */
    function attachViewProviders(processFilePath, parsedHtml) {
        const imports = compilerObject.files[processFilePath].imports;
        let output = JSON.stringify(parsedHtml.parsedContent);
        attachViewSelectorProviders(parsedHtml.providers, compilerObject, imports).forEach(replaceProviders);

        function replaceProviders(providerName) {
            output = output.replace(new RegExp(`"%${providerName}%"`, 'g'), providerName);
        }

        return output;
    }

    /**
     * 
     * @param {*} obj 
     * @param {*} fn 
     * @param {*} filePath 
     */
    function _resolveDependecies(obj, fn, filePath) {
        if (obj.DI) {
            Object.keys(obj.DI).forEach(name => {
                const config = obj.DI[name];
                const service = compilerResolver.getService(name, filePath);
                if (!service && !config.optional) {
                    helper.console.error(`Unable to resolve depenedecy: ${helper.colors.yellow(name)} -> ${helper.colors.yellow(fn)} in ${helper.colors.yellow(filePath)}`);
                    helper.abort();
                }

                if (service) {
                    if (service.DI && service.DI.hasOwnProperty(fn)) {
                        helper.console.error(`Found circular dependency: ${helper.colors.yellow(fn)} -> ${helper.colors.yellow(name)} in ${helper.colors.yellow(filePath)}`);
                        helper.abort();
                    }

                    if (!service.internal) {
                        config.factory = name;
                    } else {
                        config.internal = true;
                    }
                }
            });
        }
    }

    function generateScript(definition) {
        return `/** compiled ${definition.fn} **/\nvar ${definition.fn} = function(){\n"use strict";\n\n${definition.annotations.join('\n\n')}\nreturn ${definition.fn};\n}();\n`;
    }

    /**
     * 
     * @param {*} moduleObj 
     */
    function _compileOnBootStrapFns(moduleObj) {
        if (moduleObj.initializers) {
            for (let config of moduleObj.initializers) {
                if (helper.typeOf(config, 'object')) {
                    if (config.factory && config.DI) {
                        config.DI = compilerResolver.getServices(config.DI, moduleObj, true);
                    }
                }
            }
        }


        if (moduleObj.requiredModules) {
            moduleObj.requiredModules.forEach(function(moduleName) {
                _compileOnBootStrapFns(compilerObject.modules[moduleName], state);
            });
        }
    }

    const compilerResolver = {
        getFn: directiveConfiguration => directiveConfiguration && directiveConfiguration.map(def => def.fn),
        getElement: (selector, component) => {
            return CoreQuerySelector(compilerObject, 'Element', selector, component);
        },
        getDirectives: (selector, element, component) => {
            return CoreQuerySelector(compilerObject, 'Directive', selector, component, element);
        },
        getModule: moduleName => compilerObject.modules[moduleName],
        getService: (serviceName, filePath) => {
            if (compilerObject.services.hasOwnProperty(serviceName)) {
                return compilerObject.services[serviceName];
            }

            const inGlobalImports = findTokenInGlobalImports(serviceName, compilerObject, 'services');
            if (inGlobalImports) {
                return inGlobalImports[serviceName] || {
                    internal: true
                }
            }

            return isExportedToken(serviceName, compilerObject);
        },
        getPipe: pipeName => {
            return getPipeProvider(pipeName, compilerObject)
        }
    };

    scriptBody = compilerObject.output.global.map(element => {
        if (helper.typeOf(element, 'object')) {
            const compiledModule = compile(element);
            if (compilerObject.output.modules.hasOwnProperty(element.filePath)) {
                compilerObject.output.modules[element.filePath].push(compiledModule);
                return '';
            } else {
                return compiledModule;
            }
        } else {
            return element;
        }
    }).filter(item => !!item).join('\n');
    /**
     * save files
     */
    if (helper.is('library', compilerObject.options.type)) {
        await outputLibraryFiles(compilerObject, scriptBody, entry);
    } else {
        await outputApplicationFiles(compilerObject, scriptBody);
    }
}



module.exports = async function(compilerObject, loader) {
    loader.spinner.stop();
    for (const name in compilerObject) {
        await CoreGenerator(compilerObject[name], loader, name);
    }
};
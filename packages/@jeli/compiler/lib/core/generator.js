const helper = require('@jeli/cli-utils');
const htmlParser = require('./html_parser');
const loader = require('./loader');
const { outputApplicationFiles, outputLibraryFiles, pushStyle, styleChanges } = require('./output');
const { attachViewSelectorProviders } = require('./view.provider');
const annotationProps = ['name', 'selector', 'exportAs', 'module'];

/**
 * 
 * @param {*} compilerObject 
 * @param {*} entry 
 * @param {*} fileChanged 
 */
async function CoreGenerator(compilerObject, entry, changes) {
    let scriptBody = '';
    const compilerResolver = require('./components.facade')(compilerObject);
    /**
     * 
     * @param {*} definition 
     */
    function compile(definition, filePath) {
        switch (definition.type.toLowerCase()) {
            case ('service'):
            case ('provider'):
            case ('pipe'):
                definition.annotations.push(`${definition.fn}.annotations = ${helper.objectStringToAsIs(compilerObject.Service[definition.fn], annotationProps)};`);
                helper.quoteFix(annotationProps, compilerObject.Service[definition.fn]);
                if (compilerObject.Service[definition.fn].static) {
                    definition.annotations.push(`${definition.fn}.annotations.instance = ${definition.fn};`);
                }
                break;
            case ('directive'):
            case ('element'):
                const obj = compilerObject[definition.type][definition.fn];
                if (!obj.module) {
                    helper.abort(`${helper.colors.yellow(definition.fn)} is not registered to any Module`);
                }

                let template = obj.template;
                let styleUrl = obj.styleUrl;
                const style = obj.style;
                const viewChild = obj.viewChild;
                if (obj.templateUrl) {
                    const templatePath = loader.joinFilePath(filePath, '..', obj.templateUrl);
                    template = loader.templateContentLoader(templatePath);
                    compilerObject.output.templates[templatePath] = filePath;
                }

                if (styleUrl) {
                    styleUrl = loader.joinFilePath(filePath, '..', styleUrl);
                    compilerObject.output.styles[styleUrl] = filePath;
                }




                /**
                 * remove unused ctors
                 */
                delete obj.viewChild;
                delete obj.templateUrl;
                delete obj.styleUrl;
                delete obj.template;
                delete obj.style;

                definition.annotations.push(`${definition.fn}.annotations = ${helper.objectStringToAsIs(obj, annotationProps)};`);
                helper.quoteFix(annotationProps, obj);
                if (helper.is(definition.type, 'Element')) {
                    if (template) {
                        const parsedHtml = htmlParser(template, viewChild, obj.selector, compilerResolver, definition.fn);
                        if (parsedHtml.errorLogs.length) {
                            helper.console.header(`TemplateCompilerError -> Element<${definition.fn}> : ${filePath}`);
                            parsedHtml.errorLogs.forEach(helper.console.error);
                        }
                        definition.annotations.push(`${definition.fn}.view = /** jeli template **/ (function(_viewParser){ return function(parentRef){  return _viewParser.compile(${attachViewProviders(filePath, parsedHtml)}, parentRef);}})(new core["ViewParser"])/** template loader **/`);
                    }

                    // style parser
                    if (style || styleUrl) {
                        pushStyle({
                            name: definition.fn,
                            selector: obj.selector,
                            style,
                            styleUrl,
                            elementFilePath: filePath
                        });
                        // definition.annotations.push(`${definition.fn}.style = ${helper.stringifyContent(style)};`);
                    }
                }
                break;
            case ('jmodule'):
                /**
                 * compile @config and @initializers
                 */
                if (compilerObject.jModule[definition.fn].rootElement) {
                    definition.annotations.push(`${definition.fn}.rootElement = ${compilerObject.jModule[definition.fn].rootElement};`)
                }

                if (compilerObject.jModule[definition.fn].requiredModules) {
                    definition.annotations.push(`!function(){/** bootstrap module**/${helper.objectStringToAsIs(compilerObject.jModule[definition.fn].requiredModules)}.forEach(function(_module){ _module()});\n}();`);
                }
                break;
        }

        return generateScript(definition);
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

        function replaceProviders(viewProvider) {
            output = output.replace(new RegExp(`"%${viewProvider.providerName}%"`, 'g'), `${viewProvider.outputName}["${viewProvider.providerName}"]`);
        }

        return output;
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
                _compileOnBootStrapFns(compilerObject.jModule[moduleName], state);
            });
        }
    }

    function generateScriptBody() {
        return Object.keys(compilerObject.output.modules)
            .reduce((accum, filePath) => scriptGeneratorParser(accum, filePath), [])
            .concat(compilerObject.output.global).join('\n')

        /**
         * 
         * @param {*} output 
         * @param {*} filePath 
         */
        function scriptGeneratorParser(output, filePath) {
            if (changes && changes.filePath && !helper.is(changes.filePath, filePath)) {
                return output;
            }

            const implementation = compilerObject.output.modules[filePath];
            if (implementation.annotations) {
                for (const annotation of implementation.annotations) {
                    implementation.source.push(compile(annotation, filePath));
                }
            }

            if (isLib) {
                output.push(implementation.source.join(''));
            }

            return output;
        }

    }


    const isLib = helper.is('library', compilerObject.options.type);
    scriptBody = generateScriptBody();
    /**
     * save files
     */
    if (isLib) {
        await outputLibraryFiles(compilerObject, scriptBody, entry);
    } else {
        await outputApplicationFiles(compilerObject, scriptBody, changes);
    }
}

module.exports = async function(compilerObject, changes) {
    for (const name in compilerObject) {
        if (changes && changes.isStyles) {
            styleChanges(compilerObject[name], changes);
        } else {
            await CoreGenerator(compilerObject[name], name, changes);
        }
    }
};
const helper = require('@jeli/cli-utils');
const htmlParser = require('./html_parser');
const loader = require('./loader');
const { outputApplicationFiles, outputLibraryFiles, pushStyle, styleChanges, copyAndUpdateAssetsFile } = require('./output');
const { attachViewSelectorProviders } = require('./view.provider');
const annotationProps = ['name', 'selector', 'exportAs', 'module'];
const componentFacade = require('./components.facade');

/**
 * 
 * @param {*} compilerObject 
 * @param {*} entry 
 * @param {*} fileChanged 
 */
async function CoreGenerator(compilerObject, entry, changes) {
    const isLib = helper.is('library', compilerObject.options.type);
    let scriptBody = '';
    const compilerResolver = componentFacade(compilerObject);
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
                    helper.console.warn(`${helper.colors.yellow(definition.fn)} is not registered to any Module`);
                    return;
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
                        definition.annotations.push(`${definition.fn}.view = /** jeli template **/ ${generateView(filePath, parsedHtml)}/** template loader **/`);
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
                    definition.annotations.push(`${definition.fn}.fac = function(){/** bootstrap module**/${helper.objectStringToAsIs(compilerObject.jModule[definition.fn].requiredModules)}.forEach(function(m){ if(m.fac){ m.fac()} m()});\n};`);
                }
                break;
        }

        return generateScript(definition);
    }

    /**
     * 
     * @param {*} t 
     * @param {*} prop 
     * @returns 
     */
    function tmplToScript(t, viewRef, childVar) {
        var s = ``;
        if (t) {
            var templates = null;
            var children = null;
            if (t.templates) {
                templates = constructTemplate(t.templates);
            }

            if (t.children) {
                children = `function(parentRef){${constructContents(t.children, 'parentRef')}.forEach(function(child,i){if(child){parentRef.children.add(child, i); parentRef.nativeElement.appendChild(child.nativeElement || child.nativeNode); } });}`;
            }

            if (t.type === 'text') {
                s += `core["ViewParser"].builder.text(${JSON.stringify(t.ast || null)}, ${viewRef})`;
            } else {
                const definitions = ['name', 'text', 'index', 'vc', 'isc', 'attr', 'props', 'providers'].reduce((accum, key) => { if (t.hasOwnProperty(key)) { accum[key] = t[key]; } return accum; }, {});
                s += `core["ViewParser"].builder.${t.type}(${JSON.stringify(definitions)}, ${viewRef}, ${children}, ${templates})`;
            }
        }

        return `${s}`;
    }

    /**
     * 
     * @param {*} templates 
     * @returns 
     */
    function constructTemplate(templates) {
        var ret = [];
        for (const tprop in templates) {
            const tid = `${tprop}_tmpl`;
            ret.push(`${tprop}: function(){ return ${tmplToScript(templates[tprop], tid)}}`);
        }
        return `{${ret.join(',')}}`;
    }

    /**
     * 
     * @param {*} templates 
     */
    function constructContents(templates, viewRef) {
        const contents = templates.map((child, idx) => {
            return tmplToScript(child, viewRef, `${viewRef}_child_${idx}`);
        });

        return `[${contents.join(',')}]`;
    }


    /**
     * 
     * @param {*} processFilePath 
     * @param {*} parsedHtml 
     */
    function generateView(processFilePath, parsedHtml) {
        const imports = compilerObject.files[processFilePath].imports;
        const templateKeys = Object.keys(parsedHtml.templatesMapHolder);
        let output = '';
        if (compilerObject.buildOptions.AOT) {
            output = `var $tmpl=${constructTemplate(parsedHtml.templatesMapHolder)}; ${constructContents(parsedHtml.parsedContent, 'viewRef')};`;
        } else {
            output = `function(compiler){ 'use strict'; return function(viewRef){  var $tmpl=${replaceTemplateMappers(parsedHtml.templatesMapHolder, true)},_GT = function(templateId){ var tmp=$tmpl[templateId]; return tmp ? ((typeof tmp ==='object')?tmp : tmp()): null;}; return compiler.compile(${replaceTemplateMappers(parsedHtml.parsedContent)}, viewRef);}}(new core["ViewParser"].JSONCompiler)`;
        }

        attachViewSelectorProviders(parsedHtml.providers, compilerObject, imports, isLib).forEach(replaceProviders);

        function replaceProviders(viewProvider) {
            output = output.replace(new RegExp(`"%${viewProvider.providerName}%"`, 'g'), `${viewProvider.outputName}["${viewProvider.providerName}"]`);
        }

        function replaceTemplateMappers(template, attachWrapper) {
            template = JSON.stringify(template);
            template = template.replace(new RegExp(`"%tmpl_(.*?)%"`, 'g'), (_, key) => {
                if (key === 'GT') return `${attachWrapper ? 'function(tid){ return _GT(tid);}':'_GT'}`;
                const templateKey = key.split('|');
                const tmpscript = `${templateKey[1] ? 'Object.assign('+JSON.stringify(parsedHtml.templateOptionsMapper[templateKey[1]])+', $tmpl.'+templateKey[0]+')' : '_GT("'+templateKey[0]+'")' }`;
                return `${attachWrapper ? 'function(){ return '+tmpscript+';}':tmpscript}`;
            });
            return template;
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

exports.generateApp = async function(compilerObject, changes) {
    for (const name in compilerObject) {
        if (changes && changes.isStyles) {
            styleChanges(compilerObject[name], changes);
        } else {
            await CoreGenerator(compilerObject[name], name, changes);
        }
    }
};

exports.updatesAppAssets = copyAndUpdateAssetsFile;
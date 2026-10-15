const path = require('path');
const helper = require('@jeli/cli/lib/utils');
const fs = require('fs-extra');
const lodashTemplate = require('lodash.template');
const uglify = require('uglify-js');
const { getIndex, getScopeId } = require('./output-mapper');
const symbol = "ϕ";
const cssFileHolder = new Map();
const autoprefixer = require('autoprefixer')
const postcss = require('postcss')
const postcssNested = require('postcss-nested');
const rules = require('./rules');

// A pseudo-element must terminate a compound selector, so the scope attribute has to be
// inserted before it rather than appended at the very end (e.g. ".overlay[_jeli-x]:after",
// not the invalid ".overlay:after[_jeli-x]" which browsers silently drop the whole rule for).
const TRAILING_PSEUDO_ELEMENT = /(::[a-zA-Z-]+(?:\([^)]*\))?|:(?:before|after|first-line|first-letter))$/i;

function scopePlugin(scopeId) {
    return {
        postcssPlugin: 'jeli-scope',
        OnceExit(root) {
            root.walkRules(rule => {
                if (rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
                rule.selector = rule.selectors
                    .map(sel => {
                        const trimmed = sel.trim();
                        if (trimmed === ':host') return `[${scopeId}]`;
                        if (trimmed.includes(':global(')) {
                            return trimmed.replace(/:global\(([^)]*)\)/g, '$1').trim();
                        }
                        const pseudoElementMatch = sel.match(TRAILING_PSEUDO_ELEMENT);
                        if (pseudoElementMatch) {
                            const splitIndex = sel.length - pseudoElementMatch[0].length;
                            return `${sel.slice(0, splitIndex)}[${scopeId}]${sel.slice(splitIndex)}`;
                        }
                        return `${sel}[${scopeId}]`;
                    })
                    .join(', ');
            });
        }
    };
}
scopePlugin.postcss = true;

class OutputGenerator {
    static PATTERN = {
        MODULE: 'MODULE',
        UMD: 'UMD',
        DEFAULT: 'DEFAULT'
    };

    static __outputFiles = {};

    static async writeFile(filePath, data) {
        try {
            if (this.noOutputDefined) return false;

            const dirName = path.dirname(filePath);
            // check if folder already exist
            // else create one
            if (!fs.existsSync(dirName)) {
                fs.mkdirpSync(dirName);
            }

            fs.writeFileSync(filePath, data);
            // Print a success message.
            helper.console.success(`generated file "${path.basename(filePath)}" size: (${helper.colors.yellow((data.length / 1024).toFixed(2) + 'kb')}) `);
        } catch (e) {
            helper.console.error(`unable to save file, please try again`);
            helper.abort(e);
        }
    }

    /**
     * 
     * @param {*} filePath 
     * @param {*} compilerObject 
     */
    static async generateBundleData(compilerObject, fileNames) {
        /**
         * existing and new packageJSON path
         */
        const existingPackageJSON = path.join(compilerObject.options.sourceRoot, compilerObject.entryFile, '..', './package.json');
        const outputPackageJSON = path.join(compilerObject.options.output.folder, compilerObject.entryFile, '..', './package.json');
        /**
         * write the bundle path to packageJson object
         */
        let packageJSON = Object.keys(fileNames).reduce((accum, type) => {
            accum[type === 'UMD' ? 'main' : type.toLowerCase()] = `${this.getRelativePath(fileNames[type], path.dirname(outputPackageJSON))}`;
            return accum;
        }, {});

        /**
         * check for existing packageJSON data
         * then extend the existing data
         * 
         */
        if (fs.existsSync(existingPackageJSON)) {
            packageJSON = Object.assign(JSON.parse(fs.readFileSync(existingPackageJSON)), packageJSON);
        }

        if (compilerObject.buildOptions.version) {
            packageJSON.version = compilerObject.buildOptions.version;
        }

        if (compilerObject.buildOptions.hasStyles) {
            packageJSON.stylesPath = 'bundles/styles.css';
        }

        packageJSON.peerDependencies = packageJSON.peerDependencies || {};
        for (const prop in compilerObject.globalImports) {
            const globImp = compilerObject.globalImports[prop];
            if (globImp.name) {
                packageJSON.peerDependencies[globImp.name] = this.verifyVersion(globImp.version);
            }
        }

        packageJSON.metaDataPath = 'metadata.json';
        this.writeFile(outputPackageJSON, JSON.stringify(packageJSON, null, 2));
        this.saveCompilerData(compilerObject);
    }

    /**
     * 
     * @param {*} compilerObject 
     * @param {*} moduleName 
     */
    static async outputLibraryFiles(compilerObject, moduleName) {
        const files = {};
        const scriptBody = this.extractSourceCode(compilerObject, true);
        for (const type of compilerObject.options.output.patterns) {
            files[type] = await this.buildByType(type, scriptBody, moduleName, compilerObject);
        }

        await this.copyFiles(compilerObject);
        compilerObject.buildOptions.hasStyles = await this.writeCss(compilerObject.options, compilerObject.buildOptions.assetURL, true, compilerObject.buildOptions.sass);
        await this.generateBundleData(compilerObject, files);
    }

    /**
     * 
     * @param {*} filesToCopy 
     */
    static async copyFiles(compilerObject) {
        if (compilerObject.options.output.copy) {
            for (const file of compilerObject.options.output.copy) {
                try {
                    const dest = `${compilerObject.options.output.folder}${file.dest || (path.basename(file.src) + '/')}`;
                    fs.copySync(file.src, dest, {
                        recursive: true,
                        overwrite: true
                    });
                } catch (exception) { }
            }
        }
    }

    static async copyAndUpdateAssetsFile(filePath, compilerObject, item) {
        if (!fs.existsSync(filePath)) return;
        const basename = path.basename(item.src);
        const dest = `${compilerObject.options.output.folder}${basename}${filePath.split(basename)[1]}`;
        try {
            fs.copySync(filePath, dest, {
                recursive: true,
                overwrite: true
            });
        } catch (e) { }
    }

    /**
     * 
     * @param {*} compilerObject 
     * @param {*} changes 
     */
    static async outputApplicationFiles(compilerObject, changes) {
        const getBootStrapModule = filePath => {
            for (const imp of compilerObject.files[filePath].imports) {
                if (!imp.specifiers.length) continue; // side-effect-only import (e.g. webcomponent entry) - nothing to resolve
                const fn = imp.specifiers[0].local;
                if (compilerObject.jModule[fn]) {
                    return imp.absolutePath;
                }
            }
        };

        /**
         * generate the script file with below conditions
         * changes to .html .js .json
         */
        if (!changes || !changes.isStyles) {
            const changesFilePath = changes ? changes.filePath : null;
            const isLazyLoaded = (compilerObject.output.modules[changesFilePath] || { isLazyLoaded: null }).isLazyLoaded;
            const isProdBuild = (compilerObject.buildOptions && compilerObject.buildOptions.prod);
            if (!isLazyLoaded) {
                const bootStrapFilePath = path.join(compilerObject.options.sourceRoot, compilerObject.entryFile);
                const bootStrapModule = getBootStrapModule(bootStrapFilePath);
                const main = await this.resolveModules(compilerObject, changesFilePath, bootStrapModule);
                const fileName = `${compilerObject.options.output.folder}${compilerObject.entryFile}`;
                const deps = [compilerObject.output.global];
                // compile bootstrap 
                const bstDeps = this.extendImportExport(bootStrapFilePath, compilerObject, deps);
                const entry = this.writeGlobalImports(deps.join(''), bstDeps.$, false);
                const buildArgs = this.getBuildArgs(compilerObject.buildOptions);
                let script = this.loadTemplate('default', { entry, main, buildArgs });

                const bundleStyles = compilerObject.buildOptions && compilerObject.buildOptions.bundleStyles;
                if (bundleStyles) {
                    const cssScript = await this.writeCss(compilerObject.options, compilerObject.buildOptions.assetURL, false, compilerObject.buildOptions.sass, true);
                    if (cssScript) script = cssScript + '\n' + script;
                }

                await this.outputJSFiles(fileName, script, isProdBuild);
            } else {
                const lazyLoadModulePath = compilerObject.files[changesFilePath].lazyLoadModulePath;
                if (changesFilePath && !compilerObject.output.lazyLoads.includes(lazyLoadModulePath)) {
                    compilerObject.output.lazyLoads.push(lazyLoadModulePath);
                }
            }

            await this.writeLazyLoadModules(compilerObject, isProdBuild);
        }

        if (!changes) {
            await this.copyFiles(compilerObject);
            if (!(compilerObject.buildOptions && compilerObject.buildOptions.bundleStyles)) {
                await this.writeCss(compilerObject.options, compilerObject.buildOptions.assetURL, false, compilerObject.buildOptions.sass);
            }
            if (compilerObject.options.output.view) {
                this.saveApplicationView(compilerObject);
            }
            await this.saveTestMetaData(compilerObject);
        }
    }

    /**
     * 
     * @param {*} compilerObject 
     * @param {*} fileChanged 
     * @param {*} bootStrapModule 
     * @returns 
     */
    static async resolveModules(compilerObject, fileChanged, bootStrapModulePath) {
        const files = [];
        const filePaths = Object.keys(compilerObject.output.modules);
        let req = null;
        /**
         * 
         * @param {*} req 
         * @param {*} filePath 
         * @param {*} allowBuild 
         * @returns 
         */
        const generateModuleDeps = async (filePath, allowBuild) => {
            const isRequired = (req.type === 'require');
            if (allowBuild && Array.isArray(req.source)) {
                let defaultModuleImports = {};
                if (!isRequired) {
                    defaultModuleImports = this.extendImportExport(
                        filePath,
                        compilerObject,
                        req.source,
                        (bootStrapModulePath == filePath));
                } else {
                    req.source.unshift(`module.exports = `);
                }
                // rewrite source to string 
                req.source = this.writeGlobalImports(req.source.join(''), defaultModuleImports.$);
            }
            return `(module, exports, __required, global) => {\n"use strict";\n${req.source}\n}`;
        };


        for (const filePath of filePaths) {
            req = compilerObject.output.modules[filePath];
            if (req && !req.isLazyLoaded) {
                const allowBuild = (!fileChanged || (fileChanged && (helper.is(fileChanged, filePath) || helper.is(fileChanged, req.within))));
                const sourceCode = await generateModuleDeps(filePath, allowBuild);
                files.push(`${getIndex(filePath)} : ${sourceCode}`);
            }
        }

        return `{${files.join(',\n')}}`;
    }

    static async saveApplicationView(compilerObject) {
        const viewFilePath = path.join(compilerObject.options.sourceRoot, compilerObject.options.output.view);
        const buildOptions = compilerObject.buildOptions;
        if (fs.existsSync(viewFilePath)) {
            const files = buildOptions.bundleStyles ? [compilerObject.entryFile] : ['styles.js', compilerObject.entryFile];
            /**
             * rewrite rules for index.html
             * src and href will be rewritten if assetURL is defined
             */
            const assetUrl = (buildOptions.assetURL || '');
            let indexContent = rules.rewriteSrcHref(fs.readFileSync(viewFilePath, 'utf8'), assetUrl)
                .replace(/<\/body>/, _ => {
                    return files.map(file => {
                        // tagged so the live-reload client can find and re-fetch just this
                        // script on a style-only change, instead of reloading the page
                        const marker = file === 'styles.js' ? ' data-jeli-style-loader' : '';
                        return `<script src="${assetUrl}${file}" type="text/javascript"${marker}></script>`;
                    }).join('\n') + '\n' + _;
                });
            indexContent = rules.rewriteBaseHref(indexContent, buildOptions.baseHref || './');
            fs.writeFileSync(`${compilerObject.options.output.folder}${compilerObject.options.output.view}`, indexContent);
        }
    }

    /**
     * 
     * @param {*} config 
     * @param {*} append 
     * @param {*} assetURL 
     * @returns 
     */
    static async pushStyle(config, append, assetURL) {
        let result = await this.parseStyle(config, assetURL);
        if (!result || !(result.substring(1, result.length - 2))) return;
        result = helper.stringifyContent(result);
        if (append) {
            append.push(result);
        } else {
            cssFileHolder.set(config.elementFilePath, { result, config });
        }
    }

    /**
     * 
     * @param {*} compilerObject 
     * @param {*} changes 
     */
    static async styleChanges(compilerObject, changes) {
        const elementFilePath = compilerObject.output.styles[changes.filePath];
        const existingContent = cssFileHolder.get(elementFilePath);
        this.pushStyle(existingContent ? existingContent.config : {
            styleUrl: changes.filePath,
            elementFilePath,
            sassEnabled: compilerObject.buildOptions.sass
        }, null, compilerObject.buildOptions.assetURL);

        if (compilerObject.buildOptions && compilerObject.buildOptions.bundleStyles) {
            // styles live inside main.js for this project - a styles-only change still
            // needs a full regen, not just a styles.js rewrite
            return this.outputApplicationFiles(compilerObject, null);
        }

        await this.writeCss(compilerObject.options, compilerObject.buildOptions.assetURL, false, compilerObject.buildOptions.sass);
    }

    /**
     * 
     * @param {*} type 
     * @param {*} scriptBody 
     * @param {*} moduleName 
     * @param {*} compilerObject 
     * @returns 
     */
    static async buildByType(type, scriptBody, moduleName, compilerObject) {
        const trimmedName = helper.trimPackageName(moduleName);
        const isModule = (type === this.PATTERN.MODULE);
        const scriptDefinition = {
            scriptBody,
            header: '',
            footer: this.createModuleExportation(compilerObject.exports, isModule),
            moduleName: `'${moduleName}'`,
            importsAMD: '',
            importsCJS: '',
            globalArgs: '',
            args: '',
            buildOptions: this.getBuildArgs(compilerObject.buildOptions)
        };

        const imports = this.createModuleImportation(compilerObject.globalImports, isModule);
        if (!isModule) {
            const globalName = `global.${trimmedName.first}`;
            scriptDefinition.globalName = globalName;
            scriptDefinition.globalNameSpace = `${trimmedName.nameSpace ? ', ' + globalName + '["' + trimmedName.nameSpace + '"] = ' + globalName + '["' + trimmedName.nameSpace + '"] || {}' : ''}`;
            scriptDefinition.importsAMD = imports.amd.join(', ');
            scriptDefinition.importsCJS = imports.cjs.join('');
            scriptDefinition.globalArgs = imports.global.join(', ');
            scriptDefinition.args = imports.args.join(', ');
        } else {
            scriptDefinition.header = imports;
        }

        const fileName = `${trimmedName.name}-${type.toLowerCase()}`;
        const filePath = `bundles/${fileName}.js`;
        const script = this.loadTemplate(type.toLowerCase(), scriptDefinition);
        const outputFolder = compilerObject.options.output.folder;
        // overwrite template
        await this.writeFile(`${outputFolder}/${filePath}`, script);
        /**
         * uglify script if required
         */
        if (!isModule) {
            const uglifyFilename = `${fileName}.min.js`;
            const uglifiedScript = this.obfuscate(script, {
                url: `${uglifyFilename}.map`
            });

            if (!uglifiedScript.error) {
                const minFilePath = `${outputFolder}/${path.join(filePath, `../${uglifyFilename}`)}`;
                await this.writeFile(minFilePath, uglifiedScript.code);
                await this.writeFile(`${minFilePath}.map`, uglifiedScript.map);
            } else {
                helper.console.error(`obfuscation failed for this file -> ${fileName}`);
            }
        }
        return filePath;
    }

    /**
     * 
     * @param {*} script 
     * @param {*} sourceMap 
     */
    static obfuscate(script, sourceMap) {
        return uglify.minify(script, {
            nameCache: null, // or specify a name cache object
            toplevel: false,
            ie8: false,
            warnings: false,
            sourceMap,
            compress: {
                sequences: true,
                dead_code: true,
                conditionals: true,
                booleans: true,
                unused: true,
                if_return: true,
                join_vars: true,
                drop_console: false,
                properties: false
            },
            output: {
                preserve_line: false,
                beautify: false,
                max_line_len: 400
            }
        });
    }

    /**
     * 
     * @param {*} annotations 
     */
    static isModule(annotations) {
        return annotations && (annotations.find(annot => annot.isModule) || {}).fn;
    }

    /**
     * @param {*} template 
     * @returns 
     */
    static getTemplate(template) {
        template = fs.readFileSync(path.resolve(__filename, `../../utils/templates/${template}.jeli`), { encoding: 'utf8' });
        return lodashTemplate(template);
    }

    /**
     * 
     * @param {*} template 
     * @param {*} data 
     */
    static loadTemplate(template, data) {
        const templateParser = this.getTemplate(template);
        return templateParser(data);
    }

    /**
     * 
     * @param {*} needle 
     * @param {*} against 
     */
    static getRelativePath(needle, against) {
        needle = needle.split('/');
        against = against.split('/');

        for (var i = 0; i < (against.length - needle.length); i++) {
            needle.unshift('..');
        }

        return needle.join('/');
    }

    static verifyVersion(version) {
        if (version && !version.toLowerCase().includes('placeholder')) {
            return version;
        }

        return 'latest';
    }

    /**
     * 
     * @param {*} compilerObject 
     */
    static saveCompilerData(compilerObject) {
        /**
         * remove unwanted data from compilerObject
         * before saving it
         */
        const ignore = ['options', 'output', 'buildOptions', 'globalImports'];
        const metaDataFilePath = path.join(compilerObject.options.output.folder, compilerObject.entryFile, '..', './metadata.json');
        let metaData = Object.keys(compilerObject).reduce((accum, key) => {
            if (!ignore.includes(key)) {
                accum[key] = compilerObject[key]
            }
            return accum;
        }, {});
        this.writeFile(metaDataFilePath, JSON.stringify(metaData, null, 2).replace(/[']/g, ''));
        metaData = null;
        compilerObject = null;
    }

    /**
     * Opt-in (buildOptions.testMeta), application-build-only counterpart to
     * saveCompilerData: that one dumps the *entire* compilerObject (including every
     * file's full generated source), which is why it's never called for app builds.
     * This dumps only what a test harness needs to resolve DI without recompiling:
     * per source file, the already-parsed `DI` array for each Element/Directive/
     * Service/Provider/Pipe defined there (annotation.js's real, compiler-verified
     * parse - not a re-implementation), plus that file's own import table with
     * `absolutePath` already resolved through options.resolve.alias.
     *
     * Scoped to files under sourceRoot - compilerObject.files also holds every
     * transitively-touched node_modules/dist file (isLib=false walks all of them),
     * which a test resolver never looks up directly and would just bloat this file.
     *
     * @param {*} compilerObject
     */
    static async saveTestMetaData(compilerObject) {
        if (!compilerObject.buildOptions.testMeta) return;

        const REGISTRY_BUCKET = { Element: 'Element', Directive: 'Directive', Service: 'Service', Provider: 'Service', Pipe: 'Service' };
        const sourceRoot = path.resolve(compilerObject.options.sourceRoot || '');
        const files = {};

        for (const filePath in compilerObject.files) {
            if (path.relative(sourceRoot, filePath).startsWith('..')) continue;

            const fileEntry = compilerObject.files[filePath];
            const moduleEntry = compilerObject.output.modules[filePath];
            const classes = {};

            if (moduleEntry && moduleEntry.annotations) {
                for (const entry of moduleEntry.annotations) {
                    const bucket = REGISTRY_BUCKET[entry.type];
                    const definition = bucket && compilerObject[bucket][entry.fn];
                    if (definition) {
                        classes[entry.fn] = {
                            type: entry.type,
                            selector: definition.selector,
                            DI: definition.DI || []
                        };
                    }
                }
            }

            files[filePath] = {
                imports: (fileEntry.imports || []).map(imp => ({
                    source: imp.source,
                    absolutePath: imp.absolutePath || null,
                    specifiers: imp.specifiers
                })),
                classes
            };
        }

        const metaFilePath = path.join(process.cwd(), 'node_modules', '.jeliCache', 'test', 'test-metadata.json');
        await this.writeFile(metaFilePath, JSON.stringify({ files }, null, 2));
    }

    static extractSourceCode(compilerObject, isLib) {
        const sourceCode = [];
        if (isLib) {
            Object.keys(compilerObject.output.modules).forEach(filePath => {
                sourceCode.push(compilerObject.output.modules[filePath].source.join(''));
            });
        }

        sourceCode.concat(compilerObject.output.global);
        return sourceCode.join('\n');
    }

    /**
     * 
     * @param {*} fileName 
     * @param {*} script 
     * @param {*} isProd 
     */
    static async outputJSFiles(fileName, script, isProd) {
        /**
         * obfuscate code if prod flag is sent
         */
        if (isProd) {
            helper.console.write('obfuscating code...');
            const uglifiedScript = this.obfuscate(script);
            if (!uglifiedScript.error) {
                script = uglifiedScript.code;
            } else {
                helper.console.error(`obfuscation failed for this file -> ${fileName}`);
            }
        }

        await this.writeFile(fileName, script);
    }



    /**
     * 
     * @param {*} imports 
     * @param {*} isModule 
     * @returns 
     */
    static createModuleImportation(imports, isModule) {
        const keys = Object.keys(imports);
        if (isModule) {
            return keys.map(key => {
                const specifiers = imports[key].specifiers;
                return `import ${specifiers.length ? ('{ ' + specifiers.join(', ') + '} from ') : ''}'${key}';\n`;
            }).join('');
        } else {
            return keys.reduce((accum, key) => {
                const specifier = imports[key];
                accum.amd.push(`'${key}'`);
                accum.cjs.push(`, require('${key}')`);
                accum.global.push(`global.${specifier.output.first}${specifier.output.nameSpace ? "['" + specifier.output.nameSpace + "']" : ''}`);
                accum.args.push(`${specifier.output.arg}`);
                return accum;
            }, {
                amd: [],
                cjs: [''],
                global: [''],
                args: ['']
            })
        }
    }

    /**
     * 
     * @param {*} specifiers 
     * @param {*} isModule 
     */
    static createModuleExportation(specifiers, isModule) {
        if (isModule) {
            return `export { ${specifiers.map(exp => `${exp.exported}${exp.exported != exp.local ? ' as ' + exp.local : ''}`).join(' , ')} }`;
        } else {
            return specifiers.map(exp => `exports.${exp.exported} = ${exp.local};`).join('\n')
        }
    }

    /**
     * 
     * @param {*} compilerObject 
     * @param {*} importItems 
     * @param {*} output 
     * @param {*} isExternalModule 
     * @returns 
     */
    static _writeImport(compilerObject, importItems, output, isExternalModule = true) {
        const defaultModuleImports = { $: {} };
        const importedCache = {};
        const isImported = (i, n) => {
            if (importedCache[i]) {
                if (importedCache[i].includes(n)) return true;
                importedCache[i].push(n);
            } else {
                importedCache[i] = [n];
            }

            return false;
        };

        for (const importItem of importItems) {
            let index = getIndex(importItem.absolutePath);
            if (importItem.default) {
                const imported = importItem.specifiers[0].imported;
                if (compilerObject.output.modules.hasOwnProperty(importItem.absolutePath) && !isImported(index, imported)) {
                    /**
                     * empty module file
                     * files that imports and exports only
                     */
                    if (!output.join('')) {
                        defaultModuleImports[imported] = `__required(${index}, 'default')`;
                    } else {
                        output.unshift(`const ${imported} = __required(${index}, 'default');\n`);
                    }
                }
            } else if (importItem.nameSpace) {
                if (!isImported(index, importItem.specifiers[0].local))
                    output.unshift(`const ${importItem.specifiers[0].local} = __required(${index}${importItem.noExports ? '' : ",'exports'"});\n`);
            } else if (compilerObject.globalImports.hasOwnProperty(importItem.source)) {
                const globalDepMeta = compilerObject.globalImports[importItem.source];
                index = getIndex(globalDepMeta.absolutePath);
                const vArg = globalDepMeta.output.arg;
                if (globalDepMeta.default) {
                    output.unshift(`const ${importItem.specifiers[0].imported} = __required(${index}, 'default');\n`);
                } else {
                    defaultModuleImports.$[vArg] = defaultModuleImports.$[vArg] || {};
                    importItem.specifiers.forEach(specifier => {
                        if (!isExternalModule) {
                            const impExpr = !isExternalModule ? specifier.imported : specifier.local;
                            if (!defaultModuleImports.$[vArg][impExpr]) {
                                defaultModuleImports.$[vArg][impExpr] = specifier.imported;
                            }
                        } else if (!isImported(index, specifier.imported)) {
                            output.unshift(`const ${specifier.local} = ${vArg}.${specifier.imported};\n`);
                        }
                    });

                    output.unshift(`const ${vArg} = __required(${index});\n`);
                }
            } else if (compilerObject.files.hasOwnProperty(importItem.absolutePath)) {
                if (!importItem.specifiers.length) {
                    // side-effect-only import (e.g. a standalone asNative entry) - still
                    // needs to run for its registration side effects, not just sit unused
                    if (!isImported(index, '*side-effect*')) {
                        output.unshift(`__required(${index});\n`);
                    }
                } else {
                    importItem.specifiers.forEach(specifier => {
                        if (!isImported(index, specifier.imported)) {
                            output.unshift(`const ${specifier.local} = __required(${index}, '${specifier.imported || specifier.local}');\n`);
                        }
                    });
                }
            }
        }

        return defaultModuleImports;
    }

    /**
     * 
     * @param {*} exportedItems 
     * @param {*} defaultModuleImports 
     * @param {*} output 
     */
    static _writeExports(exportedItems, defaultModuleImports, output) {
        // parse exports
        for (const exp of exportedItems) {
            if (helper.is(exp.exported, 'default')) {
                const value = output.pop();
                /**
                 * export defaut contains an identifier
                 * e.g export default IDENTIFIER;
                 * append the script before the export declaration
                 */
                if (exp.local !== exp.exported) {
                    output.push(`${value}\nexports.default = ${exp.local};`);
                } else {
                    output.push(`exports.default = ${value}`);
                }
            } else {
                if (!defaultModuleImports[exp.local]) {
                    output.push(`__required.r(exports, '${exp.exported}', ${exp.local});\n`);
                } else {
                    output.push(`\nexports.${exp.exported} = ${defaultModuleImports[exp.local]};`)
                }
            }
        }
    }

    /**
     * 
     * @param {*} filePath 
     * @param {*} compilerObject 
     * @param {*} output 
     * @param {*} isBootStrapModule 
     * @returns 
     */
    static extendImportExport(filePath, compilerObject, output, isBootStrapModule) {
        const metaData = compilerObject.files[filePath];
        const defaultModuleImports = this._writeImport(compilerObject, metaData.imports, output, true);
        this._writeExports(metaData.exports, defaultModuleImports, output);
        return defaultModuleImports;
    }

    /**
     * 
     * @param {*} sourceCode 
     * @param {*} globalImports 
     * @param {*} delify 
     * @returns 
     */
    static writeGlobalImports(sourceCode, replacers, delify = true) {
        if (replacers) {
            const delimeter = delify ? ['%', '%'] : ['', ''];
            for (const ns in replacers) {
                for (const loc in replacers[ns]) {
                    sourceCode = sourceCode.replace(new RegExp(delimeter.join(loc), 'g'), _ => `${ns}.${replacers[ns][loc]}`)
                }
            }
        }

        return sourceCode;
    }

    /**
     * 
     * @param {*} compilerObject 
     * @param {*} modulePath 
     * @param {*} sourceDefinition 
     * @returns 
     */
    static extractModuleImpExp(compilerObject, modulePath, sourceDefinition) {
        const coreModule = '@jeli/core';
        const definition = compilerObject.files[modulePath];
        // get module declarations from jModule attribute
        const declarations = compilerObject[sourceDefinition.annotations[0].type][sourceDefinition.annotations[0].fn];
        // concat the ctors for jModule
        const fnDefinitions = (declarations.services || []).concat(declarations.selectors || []);
        const cache = { imp: [coreModule], exp: [] };
        const ret = { imp: [{ source: coreModule, specifiers: [] }], exp: [], replace: {}, localImp: [], ns: [] };
        const isLazyLoaded = filePath => compilerObject.files[filePath].lazyLoadModulePath;
        const index = getIndex(modulePath);
        /**
         * 
         * @param {*} item 
         * @param {*} type 
         * @param {*} g 
         */
        const pushItem = (item, type, g) => {
            if (!cache.imp.includes(item.source)) {
                ret[type].push({
                    source: item.source,
                    absolutePath: item.absolutePath,
                    specifiers: []
                });
                cache.imp.push(item.source);
            }
            // check global imports
            if (g) {
                const vi = ret[type].find(c => c.source === item.source);
                vi.specifiers.push.apply(vi.specifiers, item.specifiers);
            }
        };

        const pushToCache = (item, ext) => {
            if (!cache.exp.includes(item.absolutePath)) {
                if (item.nameSpace || ext) {
                    ret.ns.push(item);
                    ret.imp.push(item);
                } else {
                    ret.localImp.push(item);
                }
                cache.exp.push(item.absolutePath);
            }
        };

        const recurImports = (depPath, recur = false) => {
            const itemImps = compilerObject.files[depPath];
            itemImps.imports.forEach(cItem => {
                const fileDef = compilerObject.files[cItem.absolutePath];
                if (!compilerObject.globalImports.hasOwnProperty(cItem.source)) {
                    if (fileDef && !fileDef.lazyLoadModulePath) {
                        ret.imp.push(cItem);
                    } else {
                        pushToCache(cItem);
                    }

                    // trigger imports of dep
                    if (recur && isLazyLoaded(cItem.absolutePath)) {
                        recurImports(cItem.absolutePath);
                    }
                }
                // external dependencies that are imported into a lazyLoaded module
                // but never imported in main module
                else if (fileDef && fileDef.lazyLoadModulePath && fileDef.isExternalModule) {
                    pushToCache(cItem, true);
                } else {
                    pushItem(cItem, 'imp', true);
                }
            });
        };

        for (const item of definition.imports) {
            const local = (item.specifiers.length && item.specifiers[0].local);
            const impIndex = fnDefinitions.indexOf(local);
            // !local || impIndex > -1
            if (isLazyLoaded(item.absolutePath)) {
                if (cache.exp.includes(item.absolutePath)) continue;
                ret.exp.splice(impIndex, 0, item);
                cache.exp.push(item.absolutePath);
                // check what each file imports 
                recurImports(item.absolutePath, true);
            } else {
                pushItem(item, 'imp', true);
            }
        }

        return ret
    }

    /**
     * 
     * @param {*} compilerObject 
     * @param {*} impExp 
     * @param {*} output 
     */
    static _writeModuleStream(compilerObject, impExp, output, isNs) {
        const writeSource = (req, imp) => {
            if (imp.default) {
                return `module.default = ${req.source.join('')}`
            } else {
                return req.source.join('');
            }
        };

        for (const item of impExp) {
            const req = compilerObject.output.modules[item.absolutePath];
            if (isNs) {
                output.push(`${getIndex(item.absolutePath)} : (module, exports) => {\n${writeSource(req, item)}\n}`);
            } else {
                output.push(req.source.join(''));
            }
        }
    }

    /**
     * 
     * @param {*} compilerObject 
     * @param {*} isProd 
     * @returns 
     */
    static async writeLazyLoadModules(compilerObject, isProd) {
        const templateParser = this.getTemplate('lazyload');
        while (compilerObject.output.lazyLoads.length) {
            const modulePath = compilerObject.output.lazyLoads.pop();
            const output = [];
            // get the lazyLoaded module definition
            const sourceDefinition = compilerObject.output.modules[modulePath];
            try {
                const impExp = this.extractModuleImpExp(compilerObject, modulePath, sourceDefinition);
                const defaultModuleImports = this._writeImport(compilerObject, impExp.imp, output, true);
                const moduleName = sourceDefinition.annotations[0].fn;
                this._writeModuleStream(compilerObject, impExp.localImp.concat(impExp.exp), output);
                output.push(sourceDefinition.source.join(''));

                this._writeExports([{ local: moduleName, exported: moduleName }], defaultModuleImports, output);
                const fileName = `${compilerObject.options.output.folder}${getIndex(modulePath)}.js`;
                const modules = [`${getIndex(modulePath)} : (module, exports, __required, global) => {\n${output.join('')}}`];
                this._writeModuleStream(compilerObject, impExp.ns, modules, true);
                const sourceCode = this.writeGlobalImports(`{\n${modules.join(',\n')}\n}`, defaultModuleImports.$);
                await this.outputJSFiles(fileName, templateParser({ sourceCode }), isProd);
            } catch (e) {
                console.log(`[OutPut] Error generating chunk module ${modulePath}, please try again`);
            }
        }
    }

    /**
     * 
     * @param {*} config 
     * @param {*} assetURL 
     * @returns 
     */
    static async parseStyle(config, assetURL) {
        const isSassFile = config.styleUrl && /\.(scss|sass)$/i.test(config.styleUrl);
        let style;

        if (config.sassEnabled && isSassFile) {
            try {
                const sass = require('sass');
                style = sass.compile(config.styleUrl, { style: 'expanded' }).css;
            } catch (e) {
                if (e.code === 'MODULE_NOT_FOUND') {
                    console.log(`styling error: buildOptions.sass is enabled but the "sass" package is not installed. Run "npm install sass" and try again.`);
                } else {
                    console.log(`styling error: ${e.message || e} for ${config.styleUrl || 'componentStyle'} in ${helper.colors.yellow(config.elementFilePath)}`);
                }
                return "";
            }
        } else {
            style = config.styleUrl ? fs.readFileSync(config.styleUrl, 'utf8') : config.style;
            // array styles
            if (Array.isArray(style)) style = style.join('\n');
        }

        if (!style) return undefined;
        try {
            const scopeId = config.selector ? getScopeId(config.selector) : null;
            const plugins = [autoprefixer, postcssNested];
            if (scopeId) plugins.push(scopePlugin(scopeId));
            const result = await postcss(plugins)
                .process(rules.rewriteBkgUrl(style, assetURL || ''), { from: config.styleUrl, to: config.outFile });
            return result.css.toString();
        } catch (e) {
            console.log(`styling error: ${e.message || e} for ${config.styleUrl || 'componentStyle'} in ${helper.colors.yellow(config.elementFilePath)}`);
            return "";
        }
    }

    /**
     *
     * @param {*} options
     * @param {*} assetURL
     */
    static async writeCss(options, assetURL, isLib = false, sassEnabled = false, bundleStyles = false) {
        let styles = [];
        if (options.output.styles) {
            for (const style of options.output.styles) {
                await this.pushStyle({ styleUrl: style, sassEnabled }, styles, assetURL);
            }
        }

        cssFileHolder.forEach(css => { if (css.result) styles.push(css.result); });
        let outputFilePath = `${options.output.folder}/styles.js`;
        if (!isLib) {
            styles = this.loadTemplate('css', { styles, appId: JSON.stringify(options.sourceRoot || 'app') });
        } else {
            outputFilePath = `${options.output.folder}/bundles/styles.css`;
            styles = styles.map(c => c.substring(1, c.length - 1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')).join('');
        }

        if (styles.length) {
            // bundleStyles: a standalone single-file build (e.g. an embeddable webcomponent)
            // folds this straight into main.js instead of writing it as its own file
            if (bundleStyles) return styles;
            await this.writeFile(outputFilePath, styles);
            styles = '';
            return true;
        }
    }

    static getBuildArgs(buildOptions) {
        return JSON.stringify({
            buildTime: Date.now(),
            version: buildOptions.version || '1.0.0',
            baseHref: buildOptions.baseHref || '',
            assetURL: buildOptions.assetURL || '',
            production: buildOptions.prod || false
        })
    }
}


module.exports = OutputGenerator;
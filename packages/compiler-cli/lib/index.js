'use strict';
const { compiler, singleCompiler } = require('./core/compiler');
const generator = require('./core/generator');
const { CompilerObject, session } = require('./core/compilerobject');
const helper = require('@jeli/cli/lib/utils');
const loader = require('./core/loader');
const ComponentsResolver = require('./core/components.facade');
const path = require('path');
const getAssetItem = (filePath, list) => (list || []).find(item  => filePath.includes(item.src));
// compiled files whose imports resolve to filePath (absolutePath is unset when that import failed)
const findImporters = (compilerObject, filePath) => {
    const target = path.normalize(filePath);
    return Object.keys(compilerObject.files).filter(importer => {
        const definition = compilerObject.files[importer];
        return definition && (definition.imports || []).some(imp => {
            if (imp.absolutePath) return path.normalize(imp.absolutePath) === target;
            if (!imp.source || imp.source.charAt(0) !== '.') return false;
            const source = path.extname(imp.source) === '.js' ? imp.source : `${imp.source}.js`;
            return path.join(importer, '..', source) === target;
        });
    });
};

//start spinner
class CoreCompiler {
    /**
     * 
     * @param {*} projectSchema 
     * @param {*} buildOptions 
     * @param {*} resolveSchema 
     * @returns 
     */
    static async builder(projectSchema, buildOptions, resolveSchema) {
        if (!projectSchema){
            return helper.console.error(`Invalid or no configuration specified`);
        }
        
        loader.startSpinner();
        let passed = true;
        try {
            const compilerObject = await CompilerObject(projectSchema, buildOptions, resolveSchema);
            for (const name in compilerObject) {
                const componentsResolver = new ComponentsResolver(compilerObject[name]);
                await compiler(componentsResolver);
                await generator.generateApp(componentsResolver, name);
            }
    
            if (buildOptions && buildOptions.watch) {
                session.save(compilerObject);
            }
            loader.spinner.stop();
        } catch (e) {
            loader.spinner.stop();
            console.log(e);
            helper.abort(`\n${e.message}`);
            passed = false;
        }
    
        return passed;
    }

    /**
     * 
     * @param {*} filePath 
     * @param {*} eventType 
     * @param {*} isExternalModule 
     * @returns 
     */
    static async buildByFileChanges(filePath, eventType, isExternalModule) {
        const { saveApplicationView } = require('./core/output');
        const compilerObject = session.get();
        const indexObject = Object.values(compilerObject)[0];
        const componentsResolver = new ComponentsResolver(indexObject);
        const indexPath = (`${indexObject.options.sourceRoot}/${indexObject.options.output.view}`);
        const isAssetsChanges = getAssetItem(filePath, indexObject.options.output.copy);
        // 'add' is compiled like 'change', but a new .js file goes through its importers (see compileFileChanges)
        const isCompilableChange = helper.is(eventType, 'change') || helper.is(eventType, 'add');
        if (isExternalModule || (isCompilableChange && !isAssetsChanges)) {
            helper.console.clear(`\nre-compiling ${helper.colors.green(filePath)}...\n`);
            // index.html file changes
            // dont require complete compilation
            if (helper.is(indexPath, filePath))
                await saveApplicationView(indexObject);
            else
                await compileFileChanges();
        } else if (isAssetsChanges) {
            helper.console.clear(`\ncopying file ${helper.colors.green(filePath)}...\n`);
            await generator.updatesAppAssets(filePath, indexObject, isAssetsChanges);
        } else if (helper.is(eventType, 'unlink')) {
            helper.console.clear(`\nremoving ${helper.colors.green(filePath)}...\n`);
            await removeFileChanges();
        }

        /**
         * a source file was deleted (or moved away): clear its Element/Directive/
         * Service/jModule registrations and file/output cache entries so a stale
         * class name doesn't collide with whatever gets registered in its place,
         * then regenerate output so the bundle drops it.
         */
        async function removeFileChanges() {
            const components = ['Directive', 'Element', 'Pipe', 'Service', 'jModule'];
            componentsResolver.cleanFileEntry(filePath, components);
            const ext = loader.getExt(filePath);
            if (ext === '.js') require('./core/output').dropElementStyles(filePath);
            await generator.generateApp(componentsResolver, null, {
                filePath,
                ext,
                isStyles: helper.isContain(ext, ['.css', '.scss'])
            });
            return true;
        }

        /**
         * compile file changes
         */
        async function compileFileChanges() {
            // recompile a fresh instance
            if (isExternalModule) {
                componentsResolver.resetCompileObject(filePath);
                await compiler(componentsResolver);
                await generator.generateApp(componentsResolver);
                return true;
            }
    
            const ext = loader.getExt(filePath);
            const fileChanges = {
                filePath,
                ext,
                isStyles: helper.isContain(ext, ['.css', '.scss'])
            };
    
            helper.console.clear('');
            // a new template/stylesheet no element uses yet is compiled with the element that references it
            const isAdd = helper.is(eventType, 'add');
            if (isAdd && ext !== '.js' && !indexObject.output.templates.hasOwnProperty(filePath) && !indexObject.output.styles.hasOwnProperty(filePath)) {
                return true;
            }

            // compiled on its own a new file has no lazy-module context and lands in the main bundle
            if (isAdd && ext === '.js' && !componentsResolver.getFile(filePath)) {
                for (const importer of findImporters(indexObject, filePath)) {
                    const importerChanges = { filePath: importer, ext: '.js', isStyles: false };
                    await singleCompiler(componentsResolver, importerChanges);
                    await generator.generateApp(componentsResolver, null, importerChanges);
                }
                return true;
            }

            const recompile  = ['.js','.gs','.html'].includes(ext);
            if (indexObject.output.templates.hasOwnProperty(filePath)) {
                fileChanges.filePath = indexObject.output.templates[filePath];
            }
            
            if (recompile) await singleCompiler(componentsResolver, fileChanges);
            await generator.generateApp(componentsResolver, null, fileChanges);
            return true;
        }
    
        return true;
    }
}

// exports the compiler
module.exports = CoreCompiler;
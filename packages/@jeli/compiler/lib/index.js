'use strict';
const { compiler, singleCompiler } = require('./core/compiler');
const generator = require('./core/generator');
const { CompilerObject, session } = require('./core/compilerobject');
const helper = require('@jeli/cli-utils');
const { getExt, spinner } = require('./core/loader');


exports.builder = async function(projectSchema, buildOptions, resolveSchema) {
    if (!projectSchema) helper.console.error(`Invalid or no configuration specified`);
    try {
        const compilerObject = await CompilerObject(projectSchema, buildOptions, resolveSchema);
        await compiler(compilerObject);
        spinner.stop();
        await generator.generateApp(compilerObject);

        if (buildOptions.watch) {
            session.save(compilerObject);
        }
    } catch (e) {
        helper.abort(`\n${e.message}`);

    }

    return true;
};

/**
 * 
 * @param {*} filePath 
 * @param {*} eventType 
 */
exports.buildByFileChanges = async function(filePath, eventType) {
    const { saveApplicationView } = require('./core/output');
    const compilerObject = session.get();
    const indexObject = Object.values(compilerObject)[0];
    const indexPath = (`${indexObject.options.sourceRoot}/${indexObject.options.output.view}`);
    const isAssetsChanges = filePath.includes('assets');
    if (helper.is(eventType, 'change') && !isAssetsChanges) {
        helper.console.clear(`\nre-compiling ${helper.colors.green(filePath)}...\n`);
        // index.html file changes
        // dont require complete compilation
        if (helper.is(indexPath, filePath))
            await saveApplicationView(indexObject);
        else
            await compileFileChanges();
    } else if (isAssetsChanges) {
        helper.console.clear(`\ncopying file ${helper.colors.green(filePath)}...\n`);
        generator.updatesAppAssets(filePath, indexObject);
    }

    /**
     * compile file changes
     */
    async function compileFileChanges() {
        const ext = getExt(filePath);
        const fileChanges = {
            filePath,
            ext,
            isStyles: helper.isContain(ext, ['.css', '.scss'])
        };

        helper.console.clear('');
        switch (ext) {
            case ('.html'):
            case ('.js'):
            case ('.gs'):
                if (indexObject.output.templates.hasOwnProperty(filePath)) {
                    fileChanges.filePath = indexObject.output.templates[filePath];
                }

                await singleCompiler(indexObject, fileChanges);
                await generator.generateApp(compilerObject, fileChanges);
                break;
            case ('.css'):
            case ('.scss'):
                await generator.generateApp(compilerObject, fileChanges);
                break;
        }

        return true;
    }

    return true;
};
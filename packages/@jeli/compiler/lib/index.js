'use strict';
const { compiler, singleCompiler } = require('./core/compiler');
const generator = require('./core/generator');
const { CompilerObject, session } = require('./core/compilerobject');
const helper = require('@jeli/cli-utils');
const { getExt, spinner } = require('./core/loader');

/**
 * 
 * @param {*} jeliSchema 
 * @param {*} entry 
 * @param {*} buildOptions 
 * @returns 
 */
exports.builder = async function(jeliSchema, entry, buildOptions) {
    if (!jeliSchema.projects[entry]) helper.console.error(`Invalid or no configuration specified`);
    try {
        const compilerObject = await CompilerObject(jeliSchema.projects[entry], buildOptions, jeliSchema.resolve);
        await compiler(compilerObject);
        spinner.stop();
        await generator(compilerObject);

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
    helper.console.clear(`\nre-compiling ${helper.colors.green(filePath)}...\n`);
    const compilerObject = session.get();
    const indexObject = Object.values(compilerObject)[0];
    const indexPath = (`${indexObject.options.sourceRoot}/${indexObject.options.output.view}`);

    if (helper.is(eventType, 'change')) {
        // index.html file changes
        // dont require complete compilation
        if (helper.is(indexPath, filePath))
            await saveApplicationView(indexObject);
        else
            await compileFileChanges();
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
                await generator(compilerObject, fileChanges);
                break;
            case ('.css'):
            case ('.scss'):
                await generator(compilerObject, fileChanges);
                break;
        }

        return true;
    }

    return true;
};
const jeliUtils = require('@jeli/cli/lib/utils');
const path = require('path');
const fs = require('fs');

const changeCWD = folder => {
    if (folder) {
        process.chdir(folder);
    }
};

const getSchema = () => {
    const jsonSchemaPath = path.join(process.cwd(), './jeli.json');
    if (!fs.existsSync(jsonSchemaPath)) {
        jeliUtils.abort(`\nUnable to determine schema for this project, are you sure this is a jeli project?\n run "${jeliUtils.colors.yellow('jeli create PROJECT_NAME')}" to create a new project.`);
    }

    return JSON.parse(fs.readFileSync(jsonSchemaPath));
};

const getPackageJson = folder => {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.cwd(), folder || '', './package.json'), 'utf8'));
    } catch (e) {
        jeliUtils.abort(`Unable to read package.json${folder ? ` in ${folder}` : ''}: ${e.message}`);
    }
};

function checkAndValidateProjectConfigs(jeliSchemaJSON, entry, options) {
    if (!jeliSchemaJSON.projects.hasOwnProperty(entry)) {
        jeliUtils.abort(`\n unable to find project ${entry} in schema`);
    }

    const projectSchema = jeliSchemaJSON.projects[entry];
    if (options.configuration && projectSchema.configurations) {
        if (!projectSchema.configurations[options.configuration]) {
            jeliUtils.abort(`\n unable to find configurations for ${options.configuration} in ${entry} schema`);
        }

        jeliUtils.console.write(`using ${options.configuration} configuration`);
        const configuration = projectSchema.configurations[options.configuration];
        Object.keys(configuration).forEach(key => {
            if (options[key] && typeof options[key] === 'object' && typeof configuration[key] === 'object') {
                Object.assign(options[key], configuration[key]);
            } else {
                options[key] = configuration[key];
            }
        });
    }

    for (var prop in options.buildOptions) {
        if (projectSchema.hasOwnProperty(prop) && typeof projectSchema[prop] === 'object') {
            Object.assign(projectSchema[prop], options.buildOptions[prop]);
        } else {
            projectSchema[prop] = options.buildOptions[prop];
        }
    }

    // project-level buildOptions (e.g. compiledBindings, AOT) must reach the compiler too -
    // CLI-supplied buildOptions (cwd/prod/version/...) still take precedence.
    options.buildOptions = Object.assign({}, projectSchema.buildOptions, options.buildOptions);

    return projectSchema;
}

exports.build = async function build(entry, options, callback) {
    if (options.all) return this.buildAll(options);
    const jeliSchemaJSON = getSchema();
    const jeliCompiler = require(options.compilerPath);
    entry = entry || jeliSchemaJSON.default;
    const projectSchema = checkAndValidateProjectConfigs(jeliSchemaJSON, entry, options);
    changeCWD(options.buildOptions.cwd);
    const done = await jeliCompiler.builder(projectSchema, options.buildOptions, jeliSchemaJSON.resolve);
    if (done && callback) {
        callback(projectSchema, jeliSchemaJSON.resolve.alias);
    }
};

exports.buildAll = async function (options) {
    const jeliSchemaJSON = getSchema();
    const jeliCompiler = require(options.compilerPath);
    changeCWD(options.buildOptions.cwd);
    for (const name in jeliSchemaJSON.projects) {
        jeliUtils.console.write(`\nCompiling project ${name}\n`);
        const projectSchema = checkAndValidateProjectConfigs(jeliSchemaJSON, name, options);
        await jeliCompiler.builder(projectSchema, options.buildOptions, jeliSchemaJSON.resolve);
    }
};

exports.serve = async function (entry, options) {
    const { genServerOptions, attachListeners, cleanup } = require('./lib/server/utils');
    const jeliCompiler = require(options.compilerPath);
    const os = require('os');
    const httpServer = require('./lib/server/create');
    const opener = require('opener');
    const ifaces = os.networkInterfaces();
    const watchFn = require('./lib/utils/watch');

    // Resolve project config upfront - needed regardless of whether initial build succeeds
    const jeliSchemaJSON = getSchema();
    entry = entry || jeliSchemaJSON.default;
    changeCWD(options.buildOptions.cwd);
    const projectSchema = checkAndValidateProjectConfigs(jeliSchemaJSON, entry, options);
    const resolveAliasPaths = Object.values(jeliSchemaJSON.resolve.alias).map(t => path.resolve(t));

    function startServer() {
        const serverOptions = genServerOptions(options.serverOptions);
        const server = httpServer(serverOptions);
        server.listen(serverOptions.port, serverOptions.host, function() {
            var canonicalHost = jeliUtils.is(serverOptions.host, '127.0.0.1') ? 'localhost' : serverOptions.host,
                protocol = serverOptions.ssl ? 'https://' : 'http://';

            jeliUtils.console.setInitial(jeliUtils.colors.yellow('Starting up local server, \nAvailable on:'));

            if (jeliUtils.is(serverOptions.host, '0.0.0.0')) {
                Object.keys(ifaces).forEach(function(dev) {
                    ifaces[dev].forEach(function(details) {
                        if (details.family === 'IPv4') {
                            jeliUtils.console.setInitial('  ' + protocol + details.address + ':' + jeliUtils.colors.green(serverOptions.port.toString()));
                        }
                    });
                });
            } else {
                jeliUtils.console.setInitial('  ' + protocol + canonicalHost + ':' + jeliUtils.colors.green(serverOptions.port.toString()));
            }

            if (typeof serverOptions.proxy === 'string') {
                jeliUtils.console.setInitial('Unhandled requests will be served from: ' + serverOptions.proxy);
            }

            jeliUtils.console.clear('Hit CTRL-C to stop the server');
            if (options.path) {
                var openUrl = protocol + canonicalHost + ':' + serverOptions.port;
                if (jeliUtils.typeOf(options.path, 'string')) {
                    openUrl += options.path[0] === '/' ? options.path : '/' + options.path;
                }
                jeliUtils.console.write('open: ' + openUrl);
                opener(openUrl, { app: options.browser });
            }
        });

        attachListeners('Local server stopped, please reconnect.', () => {
            server.close();
            cleanup(serverOptions);
        });

        return server;
    }

    // Initial build - must complete before starting the server so console.clear wipes build logs
    let buildError = null;
    try {
        await jeliCompiler.builder(projectSchema, options.buildOptions, jeliSchemaJSON.resolve);
    } catch (err) {
        buildError = err;
        jeliUtils.console.error(err.message);
    }

    // Start server after build; console.clear inside startServer clears build output
    const server = startServer();
    if (buildError) {
        server.pushEvent('error');
    }

    // Set up file watcher regardless of initial build outcome - user can fix errors and save
    if (options.buildOptions.watch) {
        let pending = false;
        let queuedArgs = null;

        const runBuild = async (filePath, event, isExternalModule) => {
            pending = true;
            queuedArgs = null;
            server.pushEvent('compiling');
            try {
                await jeliCompiler.buildByFileChanges(filePath, event, isExternalModule);
                // style-only changes are re-fetched and swapped in place by the client
                // (see livereload.html) instead of forcing a full page reload
                const isStyleOnly = !isExternalModule && ['.css', '.scss'].includes(path.extname(filePath));
                server.pushEvent(isStyleOnly ? 'style' : 'reload');
                jeliUtils.console.success(jeliUtils.colors.green('compilation successful.'));
            } catch (e) {
                console.log(e);
                jeliUtils.console.error('compilation error.');
                server.pushEvent('error');
            } finally {
                pending = false;
                // replay the most recent change that arrived during the build
                if (queuedArgs) {
                    runBuild(...queuedArgs);
                }
            }
        };

        await watchFn({ root: [projectSchema.sourceRoot], resolveAliasPaths }, (filePath, event, isExternalModule) => {
            if (pending) {
                queuedArgs = [filePath, event, isExternalModule];
                return;
            }
            runBuild(filePath, event, isExternalModule);
        });
    }
};

exports.test = async function (entry, options) {
    const execaAsync = import('execa');
    const jeliSchemaJSON = getSchema();
    entry = entry || jeliSchemaJSON.default;
    const projectSchema = checkAndValidateProjectConfigs(jeliSchemaJSON, entry, options);
    changeCWD(options.cwd);

    // compile first: raw jeli source uses annotation calls (Element/Directive/...)
    // the compiler understands but jest can't execute in isolation. A clean build
    // here surfaces real compilation errors (bad imports, invalid annotations) before
    // wasting time running tests, matching what `jeli build`/`serve` already validate.
    const jeliCompiler = require(options.compilerPath);
    await jeliCompiler.builder(projectSchema, options.buildOptions || {}, jeliSchemaJSON.resolve);

    const { execa } = await execaAsync;
    try {
        await execa('jest', [projectSchema.sourceRoot, ...(options.args || [])], {
            stdio: 'inherit',
            preferLocal: true,
            env: { ...process.env, NODE_OPTIONS: '--experimental-vm-modules' }
        });
    } catch (err) {
        jeliUtils.abort(`\ntests failed for project ${jeliUtils.colors.cyan(entry)}`);
    }
};

exports.docs = async function (entry, options) {
    const os = require('os');
    const execaAsync = import('execa');
    const jeliSchemaJSON = getSchema();
    entry = entry || jeliSchemaJSON.default;
    const projectSchema = checkAndValidateProjectConfigs(jeliSchemaJSON, entry, options);
    const docConfig = projectSchema.output && projectSchema.output.doc;
    if (!docConfig) {
        jeliUtils.abort(`\n project ${jeliUtils.colors.cyan(entry)} has no "doc" configuration.\nRe-run "jeli create" with the esdoc option enabled, or add an "output.doc" entry to jeli.json.`);
    }

    changeCWD(options.cwd);
    const tmpConfigPath = path.join(os.tmpdir(), `jeli-esdoc-${Date.now()}.json`);
    fs.writeFileSync(tmpConfigPath, JSON.stringify(docConfig));

    const { execa } = await execaAsync;
    try {
        await execa('esdoc', ['-c', tmpConfigPath], { stdio: 'inherit', preferLocal: true });
        jeliUtils.console.success(`\ndocs generated at ${jeliUtils.colors.cyan(docConfig.destination)}`);
    } catch (err) {
        jeliUtils.abort(`\nfailed to generate docs for project ${jeliUtils.colors.cyan(entry)}`);
    } finally {
        fs.unlinkSync(tmpConfigPath);
    }
};

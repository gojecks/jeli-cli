const jeliUtils = require('@jeli/cli/lib/utils');
const jeliCompiler = require('@jeli/compiler-cli');
const path = require('path');
const fs = require('fs');

const changeCWD = folder => {
    if (folder) {
        process.chdir(folder);
    }
};

/**
 * 
 * @param {*} folder 
 */
const getSchema = () => {
    const jsonSchemaPath = path.join(process.cwd(), './jeli.json');
    if (!fs.existsSync(jsonSchemaPath)) {
        jeliUtils.abort(`\nUnable to determine schema for this project, are you sure this is a jeli project?\n run "${jeliUtils.colors.yellow('jeli create PROJECT_NAME')}" to create a new project.`);
    }

    return JSON.parse(fs.readFileSync(jsonSchemaPath));
}

const getPackageJson = folder => {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), folder || '', './package.json')) || '{}');
}

/**
 * 
 * @param {*} entry 
 * @param {*} options 
 * @param {*} startDevServer 
 */
exports.build = async function build(entry, options, startDevServer) {
    const jeliSchemaJSON = getSchema();
    entry = entry || jeliSchemaJSON.default;
    if (!jeliSchemaJSON.projects.hasOwnProperty(entry)) {
        jeliUtils.abort(`\n unable to find project ${entry} in schema`);
    }

    // set entry projectSchema
    const projectSchema = jeliSchemaJSON.projects[entry];
    if (options.configuration && projectSchema.configurations) {
        if (projectSchema.configurations && !projectSchema.configurations[options.configuration]) {
            jeliUtils.abort(`\n unable to find configurations for ${options.configuration} in ${entry} schema`);
        }

        jeliUtils.console.write(`using ${options.configuration} configuration`);
        // passed through commnand line
        const configuration = projectSchema.configurations[options.configuration];
        if (configuration.serverOptions) {
            Object.assign(options.serverOptions, configuration.serverOptions);
        } else if (configuration.buildOptions) {
            Object.assign(options.buildOptions, configuration.buildOptions);
        }
    }

    // extend project schema with configuration options
    for (var prop in options.buildOptions) {
        if (projectSchema.hasOwnProperty(prop) && typeof projectSchema[prop] === 'object') {
            Object.assign(projectSchema[prop], options.buildOptions[prop]);
        } else {
            projectSchema[prop] = options.buildOptions[prop];
        }
    }

    /**
     * change working directory
     */
    changeCWD(options.buildOptions.cwd);

    /**
     * start devServer and watcher
     */
    if (options.serverOptions) {
        startDevServer(projectSchema.sourceRoot);
    }

    /**
     * compile project
     */
    await jeliCompiler.builder(projectSchema, options.buildOptions, jeliSchemaJSON.resolve);
}

/**
 * 
 * @param {*} entry 
 * @param {*} options 
 */
exports.serve = async function(entry, options) {
    const { genServerOptions, attachListeners, cleanup } = require('./lib/server/utils');
    const os = require('os');
    const httpServer = require('./lib/server/create');
    const opener = require('opener');
    const ifaces = os.networkInterfaces();
    const watchFn = require('./lib/utils/watch');
    /**
     * port and host could be overridden by configurations
     * @returns 
     */
    function startServer() {
        const serverOptions = genServerOptions(options.serverOptions);
        /**
         * create server
         */
        const server = httpServer(serverOptions);
        server.listen(serverOptions.port, serverOptions.host, function() {
            var canonicalHost = jeliUtils.is(serverOptions.host, '127.0.0.1') ? 'localhost' : serverOptions.host,
                protocol = serverOptions.ssl ? 'https://' : 'http://';

            jeliUtils.console.setInitial(jeliUtils.colors.yellow('Starting up local server, \nAvailable on:'));

            if (jeliUtils.is(serverOptions.host, '0.0.0.0')) {
                Object.keys(ifaces).forEach(function(dev) {
                    ifaces[dev].forEach(function(details) {
                        if (details.family === 'IPv4') {
                            jeliUtils.console.setInitial(('  ' + protocol + details.address + ':' + jeliUtils.colors.green(serverOptions.port.toString())));
                        }
                    });
                });
            } else {
                jeliUtils.console.setInitial(('  ' + protocol + canonicalHost + ':' + jeliUtils.colors.green(serverOptions.port.toString())));
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

        // attach listener
        attachListeners('Local server stopped, please reconnect.', () => {
            server.close();
            cleanup(serverOptions);
        });

        return server;
    }

    async function serveAndWatch(sourceRoot){
        const server = startServer();
        if (options.buildOptions.watch) {
            const watchFolders = [sourceRoot];
            let pending = false;
            await watchFn(watchFolders, async(path, event) => {
                if (!pending) {
                    server.pushEvent('compiling');
                    pending = true;
                    try {
                        await jeliCompiler.buildByFileChanges(path, event);
                        server.pushEvent('reload');
                        jeliUtils.console.success(jeliUtils.colors.green('compilation successful.'));
                    } catch (e) {
                        console.log(e);
                        jeliUtils.console.error('compilation error.');
                        server.pushEvent('error');
                    } finally {
                        pending = false;
                    }
                }
            });
        }
    }

    /**
     * trigger the build instance
     */
    try {
        exports.build(entry, options, serveAndWatch);
    } catch (err) {
        jeliUtils.abort(err.message);
    }

}

exports.test = function(entry, options) {};
const jeliUtils = require('@jeli/cli-utils');
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
const validateSchema = (folder) => {
    const jsonSchemaPath = path.join(process.cwd(), folder || '', './jeli.json');
    if (!fs.existsSync(jsonSchemaPath)) {
        jeliUtils.abort(`\nUnable to determine schema for this project, are you sure this is a jeli project?\n run "${jeliUtils.colors.yellow('jeli create PROJECT_NAME')}" to create a new project.`);
    }

    return jsonSchemaPath;
}

/**
 * 
 * @param {*} entry 
 * @param {*} options 
 * @param {*} pushEvent 
 */
exports.build = async function build(entry, options, pushEvent) {
    const schemaPath = validateSchema(options.cwd);
    const watch = require('./lib/build/watch');
    changeCWD(options.cwd);
    const jeliSchemaJSON = JSON.parse(fs.readFileSync(schemaPath));
    entry = entry || jeliSchemaJSON.default;
    if (!jeliSchemaJSON.projects.hasOwnProperty(entry)) {
        jeliUtils.abort(`\n unable to find configurations for ${entry} in schema`);
    }

    const jeliCompiler = require('@jeli/compiler');
    await jeliCompiler.builder(jeliSchemaJSON.projects[entry], options);
    /**
     * start watcher
     */
    if (options.watch) {
        const watchFolders = ['node_modules', jeliSchemaJSON.projects[entry].sourceRoot];
        let pending = false;
        watch(watchFolders, async(path) => {
            if (!pending) {
                pushEvent('compiling');
                pending = true;
                try {
                    await jeliCompiler.buildByFileChanges(path);
                    pushEvent('reload');
                    jeliUtils.console.clear(jeliUtils.colors.green('compilation successful.'));
                } catch (e) {
                    jeliUtils.console.error('compilation error.');
                    pushEvent('error');
                } finally {
                    pending = false;
                }
            }
        });
    }
}

/**
 * 
 * @param {*} entry 
 * @param {*} options 
 */
exports.server = async function(entry, options) {
    validateSchema(options.cwd);
    const { genServerOptions, attachListeners, cleanup } = require('./lib/utils/server');
    const os = require('os');
    const httpServer = require('./lib/server/create');
    const opener = require('opener');
    const ifaces = os.networkInterfaces();
    const serverOptions = genServerOptions(options);
    const port = options.port || parseInt(process.env.PORT, 10) || 4110;
    const host = options.host || '127.0.0.1';
    /**
     * change the current working directory
     * sample usage: test
     */
    changeCWD(options.cwd);
    serverOptions.root = './dist';
    serverOptions.entryFile = 'index.html';
    serverOptions.watch = true;
    /**
     * create server
     */
    var server = httpServer(serverOptions);
    server.listen(port, host, function() {
        var canonicalHost = jeliUtils.is(host, '127.0.0.1') ? 'localhost' : host,
            protocol = serverOptions.ssl ? 'https://' : 'http://';

        jeliUtils.console.setInitial([jeliUtils.colors.yellow('Starting up local server, serving '),
            jeliUtils.colors.cyan(serverOptions.root),
            serverOptions.ssl ? (jeliUtils.colors.yellow(' through') + jeliUtils.colors.cyan(' https')) : '',
            jeliUtils.colors.yellow('\nAvailable on:')
        ].join(''));

        if (jeliUtils.is(host, '0.0.0.0')) {
            Object.keys(ifaces).forEach(function(dev) {
                ifaces[dev].forEach(function(details) {
                    if (details.family === 'IPv4') {
                        jeliUtils.console.setInitial(('  ' + protocol + details.address + ':' + jeliUtils.colors.green(port.toString())));
                    }
                });
            });

        } else {
            jeliUtils.console.setInitial(('  ' + protocol + canonicalHost + ':' + jeliUtils.colors.green(port.toString())));
        }

        if (typeof serverOptions.proxy === 'string') {
            jeliUtils.console.setInitial('Unhandled requests will be served from: ' + proxy);
        }

        jeliUtils.console.clear('Hit CTRL-C to stop the server');
        if (options.path) {
            var openUrl = protocol + canonicalHost + ':' + port;
            if (jeliUtils.typeOf(options.path, 'string')) {
                openUrl += options.path[0] === '/' ? options.path : '/' + options.path;
            }
            jeliUtils.console.write('open: ' + openUrl);
            opener(openUrl, { app: options.browser });
        }

        /**
         * trigger the build instance
         */
        build(null, {
            watch: true
        }, event => server.pushEvent(event));
    });

    // attach listener
    attachListeners('Local server stopped, please reconnect.', () => {
        server.close();
        cleanup(serverOptions);
    });

}
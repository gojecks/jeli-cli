'use strict';

const jeliUtils = require('@jeli/cli/lib/utils');
const fs = require('fs-extra');

exports.genServerOptions = options => {
    const serverOptions = {
        root: options.root,
        port: options.port || 4110,
        host: options.host || '127.0.0.1',
        cache: setCache(options.cache),
        timeout: options.timeout,
        showDir: options.showDir || false,
        autoIndex: options.autoIndex || false,
        gzip: options.gzip || false,
        brotli: options.brotli || false,
        robots: options.robots,
        ext: 'html',
        contentType: 'text/html',
        proxy: options.proxy,
        debugger: options.debugger || false,
        showDotfiles: options.dotfiles,
        username: options.username || process.env.NODE_HTTP_SERVER_USERNAME,
        password: options.password || process.env.NODE_HTTP_SERVER_PASSWORD,
        entryFile: options.entryFile || 'index.html',
        enableSocket: options.enableSocket || false
    };

    if (options.cors) {
        serverOptions.cors = true;
        if (typeof options.cors === 'string') {
            serverOptions.corsHeaders = options.cors;
        }
    }

    if (options.ssl) {
        serverOptions.https = {
            cert: options.cert || 'cert.pem',
            key: options.key || 'key.pem'
        };

        validateCerts(serverOptions.https);
    }

    return serverOptions;
};

exports.attachListeners = (message, callback) => {
    if (process.platform === 'win32') {
        require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        }).on('SIGINT', function() {
            process.emit('SIGINT');
            callback(' ');
        });
    }

    const done = function() {
        callback();
        process.exit(' ');
    };

    process.on('SIGINT', done);
    process.on('SIGTERM', done);
}

exports.cleanup = options => {
    // remove the static folder that was served
    fs.removeSync(options.root);
}


/**
 * 
 * @param {*} https 
 */
function validateCerts(https) {
    Object.keys(https).forEach(prop => {
        try {
            fs.lstatSync(https[prop]);
        } catch (err) {
            jeliUtils.console.write(jeliUtils.colors.red(`Error: Could not find ${prop} -> ${https[prop]}`));
            process.exit(1);
        }
    });
}

function setCache(cache) {
    return (
        cache === undefined ? 3600 :
        cache === -1 ? 'no-cache, no-store, must-revalidate' :
        cache // in seconds.
    );
}
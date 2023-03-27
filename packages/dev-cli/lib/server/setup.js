const jeliUtils = require('@jeli/cli/lib/utils');
const ecstatic = require('ecstatic');
const httpProxy = require('http-proxy');
const path = require('path');
const fs = require('fs-extra');


function getCaller() {
    try {
        var stack = new Error().stack;
        var stackLines = stack.split('\n');
        var callerStack = stackLines[3];
        return callerStack.match(/at (.+) \(/)[1];
    } catch (error) {
        return '';
    }
}

var _pathNormalize = path.normalize;
path.normalize = function(p) {
    var caller = getCaller();
    var result = _pathNormalize(p);
    // https://github.com/jfhbrook/node-ecstatic/blob/master/lib/ecstatic.js#L20
    if (caller === 'decodePathname') {
        result = result.replace(/\\/g, '/');
    }
    return result;
};
/**
 * 
 * @param {*} options 
 * @param {*} apps 
 */
function setupValidations(options, apps) {
    const secureCompare = require('secure-compare');
    const auth = require('basic-auth');
    if (options.username || options.password) {
        apps.push((req, res, next) => {
            var credentials = auth(req);

            // We perform these outside the if to avoid short-circuiting and giving
            // an attacker knowledge of whether the username is correct via a timing
            // attack.
            if (credentials) {
                // if credentials is defined, name and pass are guaranteed to be string
                // type
                var usernameEqual = secureCompare(options.username.toString(), credentials.name);
                var passwordEqual = secureCompare(options.password.toString(), credentials.pass);
                if (usernameEqual && passwordEqual) {
                    return next();
                }
            }

            res.statusCode = 401;
            res.setHeader('WWW-Authenticate', 'Basic realm=""');
            res.end('Access denied');
        });
    }
}

/**
 * 
 * @param {*} options 
 * @param {*} app 
 */
function setupCors(options, app) {
    const corser = require('corser');
    if (options.cors) {
        options.headers['Access-Control-Allow-Origin'] = '*';
        options.headers['Access-Control-Allow-Headers'] = 'Origin, X-Requested-With, Content-Type, Accept, Range';
        if (options.corsHeaders) {
            options.corsHeaders.split(/\s*,\s*/)
                .forEach(function(h) { options.headers['Access-Control-Allow-Headers'] += ', ' + h; });
        }
        app.use(corser.create(options.corsHeaders ? {
            requestHeaders: options.headers['Access-Control-Allow-Headers'].split(/\s*,\s*/)
        } : null));
    }
}

/**
 * 
 * @param {*} options 
 * @param {*} app 
 */
function setupRobots(options, app) {
    if (options.robots) {
        app.use((req, res, next) => {
            if (req.url === '/robots.txt') {
                res.setHeader('Content-Type', 'text/plain');
                var robots = options.robots === true ?
                    'User-agent: *\nDisallow: /' :
                    options.robots.replace(/\\n/, '\n');

                return res.end(robots);
            }

            next();
        });
    }
}

/**
 * 
 * @param {*} options 
 * @param {*} app 
 */
function setupLogger(options, app) {
    if (options.debugger) {
        app.use((req, res, next) => {
            debugLogger(req, res);
            next();
        });

        // attach logger
        options.log = debugLogger;
    }
}

function setupStatic(options, app) {
    if (!options.root) {
        jeliUtils.abort(`missing option (root) is required for serving files`);
    }

    const ecstaticInstance = ecstatic({
        root: options.root,
        cache: options.cache,
        showDir: options.showDir,
        showDotfiles: options.showDotfiles,
        autoIndex: options.autoIndex,
        defaultExt: options.ext,
        gzip: options.gzip,
        brotli: options.brotli,
        contentType: options.contentType,
        handleError: !jeliUtils.typeOf(options.proxy, 'string')
    });

    app.use((req, res) => {
        res.setHeader('x-powered-by', 'jeli');
        const pathReq = req.url.split('?')[0];
        const isContentRequest = /(\w+\.\w+)/.test(pathReq)
        if (options.entryFile && !isContentRequest) {
            const filePath = path.join(options.root, options.entryFile);
            if (fs.existsSync(filePath)) {
                let content = fs.readFileSync(filePath, 'utf8');
                if (options.enableSocket) {
                    content = content.replace(/<\/head>/, _ => {
                        return `${fs.readFileSync(path.join(__dirname, "../utils/snippet/livereload.html"), "utf8")}${_}`;
                    });
                }

                res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' })
                return res.end(content);
            }
        }

        const _setHeader = res.setHeader;
        res.setHeader = function(name, value) {
            _setHeader.call(res, name, jeliUtils.is(name, 'server') ? 'jeli-dev-server' : value);
        };
        ecstaticInstance(req, res);
    });
}

function setupProxy(options, app) {
    if (jeliUtils.typeOf(options.proxy, 'string')) {
        var proxy = httpProxy.createProxyServer({});
        app.use((req, res, next) => {
            proxy.web(req, res, {
                target: options.proxy,
                changeOrigin: true
            }, function(err, req, res, target) {
                if (options.debugger) {
                    debugLogger(req, res, {
                        message: err.message,
                        status: res.statusCode
                    });
                }

                next();
            });
        });
    }
}


function setupSpa(options, app) {
    if (options.spa) {
        /**
         * set the hash in response header
         */
        app.use((req, res, next) => {
            if (!jeliUtils.isContain(req.method, ["GET", "HEAD"]) || jeliUtils.is(req.url, '/')) {
                return next();
            }

            var route = req.url;
            req.url = '/';
            res.statusCode = 302;
            res.setHeader('Location', `${req.url}${route}`);
            res.end();
        });
    }
}

const debugLogger = (req, res, error) => {
    var date = options.utc ? new Date().toUTCString() : new Date();
    var ip = options['log-ip'] ? req.headers['x-forwarded-for'] || '' + req.connection.remoteAddress : '';
    if (error) {
        jeliUtils.console.write(
            '[%s] %s "%s %s" Error (%s): "%s"',
            date, ip, jeliUtils.colors.red(req.method), jeliUtils.colors.red(req.url),
            jeliUtils.colors.red(error.status.toString()), jeliUtils.colors.red(error.message)
        );
    } else {
        jeliUtils.console.write(
            '[%s] %s "%s %s" "%s"',
            date, ip, jeliUtils.colors.cyan(req.method), jeliUtils.colors.cyan(req.url),
            req.headers['user-agent']
        );
    }
};


module.exports = (options, app) => {
    setupSpa(options, app);
    setupLogger(options, app);
    setupValidations(options, app);
    setupCors(options, app);
    setupRobots(options, app);
    setupStatic(options, app);
    setupProxy(options, app);
};
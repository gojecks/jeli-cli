const jeliUtils = require('@jeli/cli/lib/utils');
const ecstatic = require('ecstatic');
const httpProxy = require('http-proxy');
const path = require('path');
const fs = require('fs-extra');

// Windows + ecstatic path workaround: ecstatic's decodePathname uses path.normalize
// which returns backslashes on Windows, causing 404s. Patch it to forward-slashes only
// for that specific call site.
if (process.platform === 'win32') {
    // captures a stack trace per call, so it must not run (process-wide) where it isn't needed
    var _pathNormalize = path.normalize;
    path.normalize = function(p) {
        var result = _pathNormalize(p);
        try {
            var stack = new Error().stack.split('\n')[3] || '';
            if (stack.match(/at (.+) \(/)?.[1] === 'decodePathname') {
                result = result.replace(/\\/g, '/');
            }
        } catch (_) {}
        return result;
    };
}

function makeDebugLogger(options) {
    return (req, res, error) => {
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
}

function setupSecurityHeaders(app) {
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('X-XSS-Protection', '0'); // disabled - modern browsers ignore it; CSP is the replacement
        next();
    });
}

function setupValidations(options, app) {
    const secureCompare = require('secure-compare');
    const auth = require('basic-auth');
    if (options.username || options.password) {
        app.use((req, res, next) => {
            var credentials = auth(req);
            if (credentials) {
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

function setupCors(options, app) {
    const corser = require('corser');
    if (options.cors) {
        options.headers = options.headers || {};
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

function setupLogger(options, app) {
    if (options.debugger) {
        const debugLogger = makeDebugLogger(options);
        app.use((req, res, next) => {
            debugLogger(req, res);
            next();
        });
        // expose on options so setupProxy can reuse it
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

    app.use((req, res, next) => {
        res.setHeader('x-powered-by', 'jeli');
        const pathReq = req.url.split('?')[0];
        const isContentRequest = /(\w+\.\w+)/.test(pathReq);
        if (options.entryFile && !isContentRequest) {
            const filePath = path.join(options.root, options.entryFile);
            if (fs.existsSync(filePath)) {
                let content = fs.readFileSync(filePath, 'utf8');
                if (options.enableSocket) {
                    content = content.replace(/<\/head>/, _ => {
                        return `${fs.readFileSync(path.join(__dirname, '../utils/snippet/livereload.html'), 'utf8')}${_}`;
                    });
                }

                res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
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
            }, function(err, req, res) {
                if (options.log) {
                    options.log(req, res, {
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
        app.use((req, res, next) => {
            // only intercept GET/HEAD for non-root paths that look like SPA routes (no file extension)
            if (!jeliUtils.isContain(req.method, ['GET', 'HEAD']) || jeliUtils.is(req.url, '/')) {
                return next();
            }
            const pathReq = req.url.split('?')[0];
            if (/\.\w+$/.test(pathReq)) {
                return next(); // has a file extension - let ecstatic handle it
            }
            // rewrite to root so ecstatic serves index.html; client-side router takes over
            req.url = '/';
            return next();
        });
    }
}

module.exports = (options, app) => {
    setupSecurityHeaders(app);
    setupSpa(options, app);
    setupLogger(options, app);
    setupValidations(options, app);
    setupCors(options, app);
    setupRobots(options, app);
    setupStatic(options, app);
    setupProxy(options, app);
};

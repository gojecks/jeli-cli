const https = require('https');

/**
 * fetch the "latest" dist-tag version for a package from the npm registry.
 * uses the built-in https module rather than a dependency, since this needs
 * to work from a plain installed @jeli/cli with no extra deps.
 */
exports.getLatestVersion = pkgName => {
    return new Promise((resolve, reject) => {
        https.get(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`, {
            headers: { 'User-Agent': 'jeli-cli' }
        }, res => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`registry request failed with status ${res.statusCode}`));
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).version);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
};

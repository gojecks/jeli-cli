const chokidar = require('chokidar');
module.exports = async(folders, callback) => {
    /**
     * start watching for file changes
     */

    const watcher = chokidar.watch('.', {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true
    });


    watcher.on('all', (event, path) => {
        if (folders.includes(path.split('/')[0])) {
            callback(path, event);
        }
    });
};
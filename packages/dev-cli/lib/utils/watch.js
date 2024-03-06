const chokidar = require('chokidar');
module.exports = async(foldersConfig, callback) => {
    /**
     * start watching for file changes
     */
    const watchPaths = ['.'].concat(foldersConfig.resolveAliasPaths);
    const watcher = chokidar.watch(watchPaths, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true
    });

    let timer = null; // property to hold our timer
    const setTimer = (event, path) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout (() => {
            const filePath = foldersConfig.resolveAliasPaths.find(k => path.includes(k));
            if (filePath) callback(event, filePath, true);            
            timer = null;
        }, 3000);
    };

    // watcher.add()
    watcher.on('all', (event, path) => {
        if (foldersConfig.root.includes(path.split('/')[0])) {
            return callback(path, event);
        }

        if (event == 'unlinkDir' && foldersConfig.resolveAliasPaths.includes(path)) {
            var watchedPaths = watcher.getWatched();
            // we add back the path to be watched if removed from watcher list
            if (!watchedPaths[path]){
                watcher.options.ignoreInitial = false;
                watcher.add(path);
            }
        }

        if (event == 'addDir' && foldersConfig.resolveAliasPaths.includes(path)){
            console.log(`Alias Path<${path}> changed`);
            // we wait for 3 secs before triggering callback
            watcher.options.ignoreInitial = true;
            return setTimer(event, path);
        }

        if (['add', 'change'].includes(event) && foldersConfig.resolveAliasPaths.some(k => path.includes(k))) {
            setTimer(event, path);
        }
    });
};
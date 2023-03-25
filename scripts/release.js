const { versionPrompt, updatePackageVersionTask, publishTask, gitTask } = require('./task');
const currentVersion = require('../package.json').version

async function runTask() {
    const response = await versionPrompt(currentVersion);
    if (!response.confirmRelease) return;
    await updatePackageVersionTask('Updating package versions...', response.version);
    await gitTask('commit to git..', [
        ['add', '-A'],
        ['commit', '-m', `release: v${response.version}`]
    ]);
    // await publishTask();
    // await gitTask('Push to git..', [
    //     ['tag', `v${response.version}`],
    //     ['push', 'origin', `refs/tags/v${response.version}`],
    //     ['push']
    // ]);
}

runTask();

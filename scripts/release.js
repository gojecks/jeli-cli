const ReleaseTaskRunner = require('../packages/cli/lib/utils/release-task');
const path = require('path');

async function runTask() {
    const taskRunner = new ReleaseTaskRunner(path.resolve(__dirname, '../packages'));
    const confirmRelease = await taskRunner.versionPrompt();
    if (!confirmRelease) return;
    await taskRunner.updatePackageVersionTask('Updating package versions...');
    // await taskRunner.updateDeps();
    await taskRunner.updateLockFileTask()
    await taskRunner.gitCommitTask('commit git changes ..', [
        ['add', '-A'],
        ['commit', '-m', `release: v${taskRunner.targetVersion}`]
    ]);
    await taskRunner.publishTask('Publishing Packages...', taskRunner.targetVersion);
    await taskRunner.gitPushTask('Push to git..', [
        ['tag', `v${taskRunner.targetVersion}`],
        ['push', 'origin', `refs/tags/v${taskRunner.targetVersion}`],
        ['push']
    ]);
}

runTask();

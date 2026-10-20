const fs = require('fs');
const os = require('os');
const path = require('path');
const compiler = require('../lib');

const FIXTURE = path.join(__dirname, 'fixtures', 'lazy-app');
const schema = () => ({ type: 'application', sourceRoot: 'src', output: { folder: 'out/', entryFile: 'main.js' } });
const resolve = () => ({ alias: { '@jeli/core': 'stubs/jeli-core' } });
const manifest = () => JSON.parse(fs.readFileSync('out/chunks.json', 'utf8'));

describe('buildOptions.chunkManifest', () => {
    const cwd = process.cwd();
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeli-chunks-'));
        fs.cpSync(FIXTURE, dir, { recursive: true });
        process.chdir(dir);
    });

    afterEach(() => {
        process.chdir(cwd);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('maps each lazy module to its chunk file, also in an obfuscated build', async () => {
        expect(await compiler.builder(schema(), { chunkManifest: true, prod: true }, resolve())).toBe(true);
        const chunks = manifest();
        expect(Object.keys(chunks)).toEqual(['lazy/lazy.module.js']);
        expect(fs.existsSync(path.join('out', chunks['lazy/lazy.module.js']))).toBe(true);
    });

    it('writes nothing unless asked', async () => {
        expect(await compiler.builder(schema(), {}, resolve())).toBe(true);
        expect(fs.existsSync('out/chunks.json')).toBe(false);
    });

    it('keeps entries for chunks a watch rebuild did not touch', async () => {
        expect(await compiler.builder(schema(), { chunkManifest: 'lazy-chunks.json', watch: true }, resolve())).toBe(true);
        const before = JSON.parse(fs.readFileSync('out/lazy-chunks.json', 'utf8'));
        fs.writeFileSync('out/lazy-chunks.json', JSON.stringify({ 'other/old.module.js': '9999.js' }));
        fs.appendFileSync('src/lazy/lazy.element.js', '\n');
        await compiler.buildByFileChanges('src/lazy/lazy.element.js', 'change');
        expect(JSON.parse(fs.readFileSync('out/lazy-chunks.json', 'utf8'))).toEqual(Object.assign({ 'other/old.module.js': '9999.js' }, before));
    });
});

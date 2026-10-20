const fs = require('fs');
const os = require('os');
const path = require('path');
const compiler = require('../lib');

const FIXTURE = path.join(__dirname, 'fixtures', 'lazy-app');
const schema = () => ({ type: 'application', sourceRoot: 'src', output: { folder: 'out/', entryFile: 'main.js' } });
const resolve = () => ({ alias: { '@jeli/core': 'stubs/jeli-core' } });
const LAZY_ELEMENT_WITH_EXTRA = "import { shared } from './shared';\nimport { extra } from './extra';\n" +
    "Element({ selector: 'app-lazy', template: '<p>lazy</p>' })\n" +
    "export class LazyElement { constructor() { this.v = shared() + extra(); } }\n";

const ROOT_ELEMENT_WITH_HELPER = "import { Helper } from './helper';\n" +
    "Element({ selector: 'app-root', template: '<p>root</p>' })\n" +
    "export class RootElement { constructor() { this.v = Helper.run(); } }\n";

// which output files contain the given source text
const bundlesWith = text => fs.readdirSync('out')
    .filter(file => file.endsWith('.js') && fs.readFileSync(path.join('out', file), 'utf8').includes(text))
    .sort();

describe('watch mode: new files imported by a lazy module', () => {
    const cwd = process.cwd();
    let dir;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeli-watch-'));
        fs.cpSync(FIXTURE, dir, { recursive: true });
        process.chdir(dir);
        expect(await compiler.builder(schema(), { watch: true }, resolve())).toBe(true);
    });

    afterEach(() => {
        process.chdir(cwd);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('builds the fixture with the lazy module in its own chunk', () => {
        expect(bundlesWith('function shared')).toEqual(['1001.js']);
    });

    it('bundles a file added before its importer into the lazy chunk', async () => {
        fs.writeFileSync('src/lazy/extra.js', 'export function extra() { return 2; }\n');
        await compiler.buildByFileChanges('src/lazy/extra.js', 'add');
        fs.writeFileSync('src/lazy/lazy.element.js', LAZY_ELEMENT_WITH_EXTRA);
        await compiler.buildByFileChanges('src/lazy/lazy.element.js', 'change');
        expect(bundlesWith('function extra')).toEqual(['1001.js']);
    });

    it('bundles a file added after its importer failed into the lazy chunk', async () => {
        fs.writeFileSync('src/lazy/lazy.element.js', LAZY_ELEMENT_WITH_EXTRA);
        await expect(compiler.buildByFileChanges('src/lazy/lazy.element.js', 'change')).rejects.toThrow();
        fs.writeFileSync('src/lazy/extra.js', 'export function extra() { return 2; }\n');
        await compiler.buildByFileChanges('src/lazy/extra.js', 'add');
        expect(bundlesWith('function extra')).toEqual(['1001.js']);
    });

    it('registers the exports of a new file imported from the main bundle', async () => {
        fs.writeFileSync('src/helper.js', 'export class Helper { static run() { return 1; } }\n');
        await compiler.buildByFileChanges('src/helper.js', 'add');
        fs.writeFileSync('src/root.element.js', ROOT_ELEMENT_WITH_HELPER);
        await compiler.buildByFileChanges('src/root.element.js', 'change');
        expect(bundlesWith("__required.r(exports, 'Helper', Helper)")).toEqual(['main.js']);
    });

    it('registers the exports of a new file added after its importer changed', async () => {
        fs.writeFileSync('src/root.element.js', ROOT_ELEMENT_WITH_HELPER);
        await expect(compiler.buildByFileChanges('src/root.element.js', 'change')).rejects.toThrow();
        fs.writeFileSync('src/helper.js', 'export class Helper { static run() { return 1; } }\n');
        await compiler.buildByFileChanges('src/helper.js', 'add');
        expect(bundlesWith("__required.r(exports, 'Helper', Helper)")).toEqual(['main.js']);
    });

    it('does not bundle a new file nothing imports', async () => {
        fs.writeFileSync('src/lazy/orphan.js', 'export function orphan() { return 3; }\n');
        await compiler.buildByFileChanges('src/lazy/orphan.js', 'add');
        expect(bundlesWith('function orphan')).toEqual([]);
    });

    it('survives a lazy component being deleted file by file', async () => {
        const rejections = [];
        const onRejection = reason => rejections.push(reason);
        process.on('unhandledRejection', onRejection);
        fs.writeFileSync('src/lazy/widget.element.js', "Element({ selector: 'app-widget', templateUrl: './widget.element.html', styleUrl: './widget.element.css' })\nexport class WidgetElement {}\n");
        fs.writeFileSync('src/lazy/widget.element.html', '<p>widget</p>');
        fs.writeFileSync('src/lazy/widget.element.css', '.widget-marker { color: red; }');
        const moduleSource = fs.readFileSync('src/lazy/lazy.module.js', 'utf8');
        fs.writeFileSync('src/lazy/lazy.module.js', "import { WidgetElement } from './widget.element';\n" + moduleSource.replace('selectors: [LazyElement]', 'selectors: [LazyElement, WidgetElement]'));
        for (const file of ['widget.element.js', 'widget.element.html', 'widget.element.css']) {
            await compiler.buildByFileChanges('src/lazy/' + file, 'add');
        }
        await compiler.buildByFileChanges('src/lazy/lazy.module.js', 'change');
        expect(bundlesWith('app-widget')).toEqual(['1001.js']);
        expect(bundlesWith('widget-marker')).toEqual(['styles.js']);

        fs.writeFileSync('src/lazy/lazy.module.js', moduleSource);
        for (const file of ['widget.element.css', 'widget.element.html', 'widget.element.js']) {
            fs.rmSync('src/lazy/' + file);
            await compiler.buildByFileChanges('src/lazy/' + file, 'unlink');
        }
        await compiler.buildByFileChanges('src/lazy/lazy.module.js', 'change');
        await new Promise(resolve => setImmediate(resolve));
        process.off('unhandledRejection', onRejection);

        expect(rejections).toEqual([]);
        expect(bundlesWith('widget-marker')).toEqual([]);
        expect(bundlesWith('function shared')).toEqual(['1001.js']);
    });
});

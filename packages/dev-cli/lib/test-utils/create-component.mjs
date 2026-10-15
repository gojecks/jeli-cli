import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';

// "jeli test" (not plain `npx jest`) compiles the project first with
// buildOptions.testMeta set, which makes OutputGenerator.saveTestMetaData
// (@jeli/compiler-cli) dump node_modules/.jeliCache/test/test-metadata.json: per
// source file, the real, already-parsed `DI` array for each Element/Service/...
// defined there (the same parse annotation.js uses to build the actual compiled
// ctors - not a reimplementation), plus that file's import table with
// `absolutePath` already resolved through the consuming project's jeli.json
// resolve.alias. That means this module never needs to parse source itself or
// hand-maintain an alias table - the compiler already did both, for whichever
// project is running its own `jeli test`.
const METADATA_PATH = path.join(process.cwd(), 'node_modules', '.jeliCache', 'test', 'test-metadata.json');

const BUILTIN_STUBS = {
    changeDetector: () => ({
        detectChanges: jest.fn(),
        onlySelf: jest.fn(),
        markAsManual: jest.fn(),
        manualCheck: jest.fn()
    }),
    elementRef: () => ({ nativeElement: {} }),
    templateRef: () => ({}),
    viewRef: () => ({}),
    webState: () => ({ go: jest.fn(), getParam: jest.fn(), setParam: jest.fn(), getUrlParams: jest.fn() })
};

let metadataCache = null;

function loadMetadata() {
    if (metadataCache) return metadataCache;
    if (!fs.existsSync(METADATA_PATH)) {
        throw new Error(
            `create-component: ${METADATA_PATH} not found. Run "jeli test" at least once ` +
            '(not "npx jest" directly) so the compiler can emit DI metadata - see ' +
            'OutputGenerator.saveTestMetaData in @jeli/compiler-cli.'
        );
    }
    metadataCache = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
    return metadataCache;
}

function toSourcePath(fileUrlOrPath) {
    return fileUrlOrPath instanceof URL ? fileURLToPath(fileUrlOrPath) : fileUrlOrPath;
}

// jeli source consistently omits the .js extension on relative imports; tolerate
// either spelling in override keys.
function normalizeSource(specifier) {
    return specifier.endsWith('.js') ? specifier.slice(0, -3) : specifier;
}

function autoMock() {
    const fns = new Map();
    return new Proxy({}, {
        get(_target, prop) {
            if (typeof prop !== 'string') return undefined;
            if (!fns.has(prop)) fns.set(prop, jest.fn());
            return fns.get(prop);
        }
    });
}

export function resolveDI(sourceFileUrlOrPath, { overrides = {}, className } = {}) {
    const sourcePath = toSourcePath(sourceFileUrlOrPath);
    const relativeKey = path.relative(process.cwd(), sourcePath);
    const metadata = loadMetadata();
    const fileEntry = metadata.files[relativeKey];
    if (!fileEntry) {
        throw new Error(
            `create-component: no metadata for ${relativeKey} in test-metadata.json - ` +
            're-run "jeli test" if this file is new or was moved.'
        );
    }

    const classNames = Object.keys(fileEntry.classes);
    const resolvedName = className || classNames[0];
    const classMeta = resolvedName && fileEntry.classes[resolvedName];
    if (!classMeta) {
        throw new Error(`create-component: no Element/Service/... annotation found for ${relativeKey} in test-metadata.json`);
    }

    const normalizedOverrides = new Map(
        Object.entries(overrides).map(([key, value]) => [normalizeSource(key), value])
    );

    return (classMeta.DI || []).map(token => {
        if (token && typeof token === 'object') {
            const stubFactory = BUILTIN_STUBS[token.tokenName.replace(/'/g, '')];
            return stubFactory ? stubFactory() : {};
        }
        const importEntry = fileEntry.imports.find(imp =>
            imp.specifiers && imp.specifiers.some(s => s.local === token)
        );
        const source = importEntry && importEntry.source && normalizeSource(importEntry.source);
        if (source && normalizedOverrides.has(source)) {
            return normalizedOverrides.get(source);
        }
        return autoMock();
    });
}

// `new Ctor(...)` works identically whether the component is declared as
// `export class X` or the older `export function X(){}` + `.prototype.method =`
// style (both are valid jeli component shapes) - no need to branch on it.
export function createComponent(sourceFileUrlOrPath, Ctor, options) {
    return new Ctor(...resolveDI(sourceFileUrlOrPath, options));
}

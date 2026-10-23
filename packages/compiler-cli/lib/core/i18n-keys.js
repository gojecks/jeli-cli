// buildOptions.i18n (true, or { file, exclude: [path prefixes under sourceRoot] }): every text key the build sees -
// `'key' | t:'default'` / `'key' | tOverride:'default';override` in templates, `I18n.t('key', 'default')` and `I18n.define({ key: 'default' })` in scripts -
// written to <output>/i18n.json as { keys: { key: { default, files } }, sources: { file: [{ key, default }] } }.
// sources lets watch rebuilds replace one file's entries without re-reading the others.
const fs = require('fs');
const path = require('path');
const espree = require('espree');

const KEY = '[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*';
const TEMPLATE_KEY = new RegExp(`(?<![\\\\\\w])(['"])(${KEY})\\1\\s*\\|\\s*t(?:Override)?\\b(?:\\s*:\\s*(['"])((?:(?!\\3)[^\\\\]|\\\\.)*)\\3)?`, 'g');
const KEY_PATTERN = new RegExp(`^${KEY}$`);

function option(compilerObject) {
    const value = compilerObject.buildOptions && compilerObject.buildOptions.i18n;
    if (!value) return null;
    const config = value === true ? {} : value;
    return { file: config.file || 'i18n.json', exclude: [].concat(config.exclude || []) };
}

function relative(compilerObject, filePath) {
    return path.relative(compilerObject.options.sourceRoot || '', filePath).split(path.sep).join('/');
}

function fromTemplate(source) {
    const entries = [];
    String(source || '').replace(TEMPLATE_KEY, (match, quote, key, defaultQuote, text) => {
        entries.push({ key, default: text === undefined ? null : text.replace(/\\(.)/g, '$1') });
        return match;
    });
    return entries;
}

function literal(node) {
    return node && node.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
}

function isI18nCall(node, method) {
    const callee = node.callee;
    return callee && callee.type === 'MemberExpression' && !callee.computed
        && callee.object.type === 'Identifier' && callee.object.name === 'I18n'
        && callee.property.type === 'Identifier' && callee.property.name === method;
}

function fromScript(source) {
    if (!/\bI18n\.(t|define)\s*\(/.test(source || '')) return [];
    let ast;
    try {
        ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    } catch (e) {
        return [];
    }
    const entries = [];
    const visit = node => {
        if (!node || typeof node.type !== 'string') return;
        if (node.type === 'CallExpression') {
            if (isI18nCall(node, 't')) {
                const key = literal(node.arguments[0]);
                if (key && KEY_PATTERN.test(key)) entries.push({ key, default: literal(node.arguments[1]) });
            } else if (isI18nCall(node, 'define') && node.arguments[0] && node.arguments[0].type === 'ObjectExpression') {
                node.arguments[0].properties.forEach(prop => {
                    const key = prop.key && (prop.key.type === 'Identifier' ? prop.key.name : literal(prop.key));
                    if (key && KEY_PATTERN.test(key)) entries.push({ key, default: literal(prop.value) });
                });
            }
        }
        Object.keys(node).forEach(name => {
            if (name === 'parent') return;
            const child = node[name];
            if (Array.isArray(child)) child.forEach(visit);
            else if (child && typeof child.type === 'string') visit(child);
        });
    };
    visit(ast);
    return entries;
}

// files outside sourceRoot (aliased libraries, node_modules) and excluded prefixes are skipped
function collect(compilerObject, filePath, source, isTemplate) {
    const config = option(compilerObject);
    if (!config) return;
    const file = relative(compilerObject, filePath);
    if (file.startsWith('..') || path.isAbsolute(file) || config.exclude.some(prefix => file.startsWith(prefix))) return;
    if (source === undefined) {
        try {
            source = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            return;
        }
    }
    const sources = compilerObject.i18nSources = compilerObject.i18nSources || {};
    // scripts may hold inline templates too
    sources[file] = isTemplate ? fromTemplate(source) : fromScript(source).concat(fromTemplate(source));
}

function build(sources) {
    const keys = {};
    Object.keys(sources).sort().forEach(file => {
        sources[file].forEach(entry => {
            const item = keys[entry.key] = keys[entry.key] || { default: null, files: [] };
            if (item.default === null && entry.default !== null) item.default = entry.default;
            if (!item.files.includes(file)) item.files.push(file);
        });
    });
    return Object.keys(keys).sort().reduce((out, key) => (out[key] = keys[key], out), {});
}

function write(compilerObject) {
    const config = option(compilerObject);
    const folder = compilerObject.options.output && compilerObject.options.output.folder;
    if (!config || !folder || !compilerObject.i18nSources) return;
    const filePath = `${folder}${config.file}`;
    let existing = {};
    try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf8')).sources || {};
    } catch (e) { }
    const sources = Object.assign(existing, compilerObject.i18nSources);
    Object.keys(sources).forEach(file => !sources[file].length && delete sources[file]);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ keys: build(sources), sources }, null, 2) + '\n');
    compilerObject.i18nSources = {};
}

module.exports = { option, fromTemplate, fromScript, collect, build, write };

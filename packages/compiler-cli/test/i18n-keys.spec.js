const fs = require('fs');
const os = require('os');
const path = require('path');
const i18nKeys = require('../lib/core/i18n-keys');

const project = (i18n, folder) => ({
    buildOptions: { i18n },
    options: { sourceRoot: '/app/src', output: { folder } }
});

describe('i18n keys', () => {
    it('reads template keys with and without an inline default', () => {
        const entries = i18nKeys.fromTemplate(`
            <p>\${'cart.empty' | t:'Your cart is empty'}</p>
            <b>\${"cart.items" | t:null;total}</b>
            <i>\${'menu.close' | t}</i>
            <u>\${'it\\'s' | t:'x'}</u>
            <s>\${label | t:'not a key'}</s>
            <q>\${'quote' | t:'Say \\'hi\\''}</q>
            <a>\${'cookies.accept' | tOverride:'Accept';config.yesText}</a>`);
        expect(entries).toEqual([
            { key: 'cart.empty', default: 'Your cart is empty' },
            { key: 'cart.items', default: null },
            { key: 'menu.close', default: null },
            { key: 'quote', default: "Say 'hi'" },
            { key: 'cookies.accept', default: 'Accept' }
        ]);
    });

    it('does not take other pipes that start with t', () => {
        expect(i18nKeys.fromTemplate(`\${'x.y' | timeAgo}\${'a.b' | translate:'z'}`)).toEqual([]);
    });

    it('reads I18n.t calls and I18n.define dictionaries from scripts', () => {
        const entries = i18nKeys.fromScript(`
            import { I18n } from '@jeli/i18n';
            I18n.define({ 'cart.empty': 'Your cart is empty', total: 'Total', 'cart.items.one': '{{0}} item', computed: label });
            export class Cart {
                get title() { return I18n.t('cart.title', 'Your cart'); }
                get other() { return I18n.t(key, 'dynamic keys are skipped') + I18n.t('cart.note'); }
            }`);
        expect(entries).toEqual([
            { key: 'cart.empty', default: 'Your cart is empty' },
            { key: 'total', default: 'Total' },
            { key: 'cart.items.one', default: '{{0}} item' },
            { key: 'computed', default: null },
            { key: 'cart.title', default: 'Your cart' },
            { key: 'cart.note', default: null }
        ]);
        expect(i18nKeys.fromScript('const x = 1;')).toEqual([]);
        expect(i18nKeys.fromScript('I18n.t( broken')).toEqual([]);
    });

    it('is off unless buildOptions.i18n is set, and skips excluded and outside files', () => {
        const off = project(undefined, '/tmp/');
        i18nKeys.collect(off, '/app/src/a.html', "${'k' | t}", true);
        expect(off.i18nSources).toBeUndefined();

        const on = project({ exclude: ['pages/builder'] }, '/tmp/');
        i18nKeys.collect(on, '/app/src/pages/builder/x.html', "${'b' | t}", true);
        i18nKeys.collect(on, '/app/lib/other.html', "${'c' | t}", true);
        i18nKeys.collect(on, '/app/src/pages/home.html', "${'h' | t:'Home'}", true);
        expect(on.i18nSources).toEqual({ 'pages/home.html': [{ key: 'h', default: 'Home' }] });
    });

    it('writes i18n.json and merges watch rebuilds by file', () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-keys-')) + '/';
        const first = project(true, folder);
        i18nKeys.collect(first, '/app/src/a.html', "${'shared' | t:'Shared'}${'only.a' | t}", true);
        i18nKeys.collect(first, '/app/src/b.js', "I18n.t('shared'); I18n.t('only.b', 'B');");
        i18nKeys.write(first);
        let written = JSON.parse(fs.readFileSync(folder + 'i18n.json', 'utf8'));
        expect(written.keys).toEqual({
            'only.a': { default: null, files: ['a.html'] },
            'only.b': { default: 'B', files: ['b.js'] },
            shared: { default: 'Shared', files: ['a.html', 'b.js'] }
        });

        const rebuild = project(true, folder);
        i18nKeys.collect(rebuild, '/app/src/a.html', "${'shared' | t:'Shared'}", true);
        i18nKeys.write(rebuild);
        written = JSON.parse(fs.readFileSync(folder + 'i18n.json', 'utf8'));
        expect(Object.keys(written.keys)).toEqual(['only.b', 'shared']);
    });
});

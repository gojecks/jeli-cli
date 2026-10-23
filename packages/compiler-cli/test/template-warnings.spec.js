const { checkTemplate } = require('../lib/core/template-warnings');
const OutputGenerator = require('../lib/core/output');

const rules = list => list.map(item => item.rule);

describe('template warnings', () => {
    it('flags a bare {prop} on an element with a :directive, not the explicit form or plain elements', () => {
        const found = checkTemplate('<div>\n  <button :geDragHandle {treeMutator} {sourceType}="type"></button>\n</div>');
        expect(rules(found)).toEqual(['directive-bare-prop']);
        expect(found[0].line).toBe(2);
        expect(found[0].message).toContain('{treeMutator}="treeMutator"');
        expect(checkTemplate('<button :geDragHandle {treeMutator}="treeMutator"></button>')).toEqual([]);
        expect(checkTemplate('<ge-selection-overlay {treeMutator} {canvasState}></ge-selection-overlay>')).toEqual([]);
    });

    it('flags *for with template on one j-fragment, not the nested form or *if', () => {
        expect(rules(checkTemplate('<j-fragment template="card" *for="view of views"></j-fragment>'))).toEqual(['for-with-template']);
        expect(rules(checkTemplate('<j-fragment {template}="x" *for="v of list"></j-fragment>'))).toEqual(['for-with-template']);
        expect(checkTemplate('<j-fragment *for="v of list"><j-fragment template="card"></j-fragment></j-fragment>')).toEqual([]);
        expect(checkTemplate('<j-fragment *if="cond" {template}="x.type"></j-fragment>')).toEqual([]);
    });

    it('flags *for locals that call methods, not property paths or $index', () => {
        const found = checkTemplate('<li *for="field of list; base=chainEntryBase(entry); i=$index; row=rows.byId"></li>');
        expect(rules(found)).toEqual(['for-local-call']);
        expect(found[0].message).toContain('base=chainEntryBase(entry)');
        expect(checkTemplate('<li *for="field of list; base=row.base; i=$index"></li>')).toEqual([]);
    });

    it('flags JSON-looking static attributes on HTML elements only', () => {
        const found = checkTemplate(`<textarea placeholder='{"fr": {"hello": "Bonjour"}}'></textarea>`);
        expect(rules(found)).toEqual(['json-static-attr']);
        expect(checkTemplate(`<fo-chart options='{"type":"bar"}'></fo-chart>`)).toEqual([]);
        expect(checkTemplate('<input placeholder="{name} and more">')).toEqual([]);
        expect(checkTemplate(`<input attr-placeholder='{"a":1}' {value}="[1,2]">`)).toEqual([]);
    });

    it('flags @for/@if written as text, not real blocks, &#64; or emails', () => {
        const found = checkTemplate('<p>Use <code>@for</code> to loop and @if for conditions.</p>');
        expect(rules(found)).toEqual(['literal-control-flow', 'literal-control-flow']);
        expect(found[0].message).toContain('&#64;for');
        const ok = '@for(item of items) { <li>${item}</li> }\n@if(a) { <p>a</p> } @else if(b) { <p>b</p> } @else { <p>c</p> }\n'
            + '<p>&#64;for and support@formula.com and @click</p><button @click="go()">x</button>';
        expect(checkTemplate(ok)).toEqual([]);
    });

    it('reads attributes with ">" inside quotes and skips comments', () => {
        expect(checkTemplate('<button @click="a > b" :drag {x}></button>')).toHaveLength(1);
        expect(checkTemplate('<!-- <button :drag {x}></button> -->')).toEqual([]);
    });

    it(':global keeps nested parentheses when styles are scoped', async () => {
        const compile = async css => (await OutputGenerator.parseStyle({ style: css, selector: 'my-el' }, '')).replace(/\s+/g, ' ').trim();
        expect(await compile('.x :global(.a:not(.b) > ul) { color: red; }')).toBe('.x .a:not(.b) > ul { color: red; }');
        expect(await compile(':global(li:nth-child(odd)) { color: red; }')).toBe('li:nth-child(odd) { color: red; }');
        expect(await compile(':global(.plain) .y, .z { color: red; }')).toMatch(/^\.plain \.y, \.z\[_jeli-\w+\] \{ color: red; \}$/);
        expect(OutputGenerator.unwrapGlobal(':global(:is(a, b):not(.c)) :global(.d)')).toBe(':is(a, b):not(.c) .d');
    });
});

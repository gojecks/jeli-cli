/**
 * End-to-end regression test for the database-hooks bug: a `*for` row's
 * `@click="selectedHook=hook.value"` must compile a write to the component
 * instance ($cmp), never to the row's own template-local context ($ctx) -
 * see compileAssignmentToJs's doc comment for the runtime bug this
 * statically prevents (jeli-js's setModelValue shadow-writing onto a *for
 * row's Object.create(componentInstance) context).
 */
const compilerObject = new (require('../lib/core/compiler.output'))('testSuite', undefined, { compiledBindings: true });
const htmlParser = require('../lib/core/view-parser/v1');
const componentsResolver = new (require('../lib/core/components.facade'))(compilerObject);

componentsResolver.addEntry('Element', 'TestSuiteElement', {
    module: 'TestSuiteModule'
});
componentsResolver.addEntry('jModule', 'TestSuiteModule', {
    requiredModules: []
});

['if', 'for'].forEach(selector => {
    const className = `${selector[0].toUpperCase()}${selector.slice(1)}Directive`;
    componentsResolver.addEntry('Directive', className, {
        selector,
        module: 'TestSuiteModule'
    });
});

htmlParser.init(componentsResolver);

const ctor = {
    selector: 'test-suite',
    props: {}
};

function parse(html) {
    return htmlParser.parse(html, false, ctor, 'TestSuiteElement');
}

describe('*for row @click assignment - compile-time scope resolution', () => {
    it('compiles the row div\'s own @click assignment to write $cmp, even though *for appears AFTER @click in the attribute list', () => {
        const output = parse(
            `<div class="db-split-sidebar-list">` +
            `<div class="db-list-item" @click="selectedHook=hook.value" *for="hook in hooks; idx=index">` +
            `<span>\${hook.label}</span>` +
            `</div>` +
            `</div>`
        );

        expect(output.errorLogs).toEqual([]);

        // the *for wraps the row in a type-8 "##" fragment; the row div itself
        // is output.templatesMapHolder / output.parsedContent[0].children[0].templates.for
        const forFragment = output.parsedContent[0].children[0];
        expect(forFragment.type).toBe(8);
        expect(forFragment.text).toBe('for');

        const rowDiv = forFragment.templates.for;
        expect(rowDiv.context.hook).toBe('$context');

        const clickEvent = rowDiv.events.find(e => e.name === 'click');
        expect(clickEvent.compiledFn).toMatch(/^<%CFN:\d+%>$/);

        const idx = Number(clickEvent.compiledFn.match(/\d+/)[0]);
        expect(output.compiledFnSources[idx]).toBe(
            'function($ctx, $cmp, $event) { ($cmp["selectedHook"] = core.resolveIdentifier("hook", $ctx, $cmp)?.["value"]); }'
        );

        // .value is deleted once .compiledFn is attached - every runtime
        // consumer of an events-array entry checks .compiledFn first (see
        // event.handler.js's triggerEvents/attachEventEmitter/
        // attachEventDispatcher), so keeping the now-unused interpreted AST
        // around would just be dead weight in the bundle
        expect(clickEvent.value).toBeUndefined();
    });

    it('resolves a nested *for row\'s @click assignment against the INNER loop-local, not the outer one', () => {
        const output = parse(
            `<div *for="outer in outers">` +
            `<span @click="outer.picked=true" *for="inner in outer.items">\${inner}</span>` +
            `</div>`
        );

        expect(output.errorLogs).toEqual([]);
        const outerForFragment = output.parsedContent[0];
        const outerRow = outerForFragment.templates.for;
        const innerForFragment = outerRow.children[0];
        const innerRow = innerForFragment.templates.for;

        const clickEvent = innerRow.events.find(e => e.name === 'click');
        const idx = Number(clickEvent.compiledFn.match(/\d+/)[0]);
        // `outer` is the ANCESTOR *for's loop-local (depth 1, one *for
        // level up from the inner row) - getScopeNames tracks the exact
        // depth, and compileAssignmentToJs emits exactly one
        // [core.SCOPE_PARENT] hop before reaching it, never a runtime
        // search - $ctx alone (no hop) would be the INNER row's own scope,
        // which does not have `outer`
        expect(output.compiledFnSources[idx]).toContain('$ctx[core.SCOPE_PARENT]["outer"]["picked"] = true');
    });

    it('sibling *for scopes stay isolated from each other, while both still reach their shared ancestor', () => {
        // <div *for="outer in outers">
        //   <span @click="outer.picked=true" *for="inner in outer.items">${inner}</span>
        //   <span @click="inner=1" *for="page in pagination">${page}</span>  <- `inner` is the
        //     OTHER span's variable, and `pagination` is a root/component
        //     property, not part of `outer` at all - neither should leak here
        const output = parse(
            `<div *for="outer in outers">` +
            `<span @click="outer.picked=true" *for="inner in outer.items">\${inner}</span>` +
            `<span @click="inner=1" *for="page in pagination">\${page}</span>` +
            `</div>`
        );

        expect(output.errorLogs).toEqual([]);
        const outerRow = output.parsedContent[0].templates.for;
        const innerRow = outerRow.children[0].templates.for;
        const pageRow = outerRow.children[1].templates.for;

        const innerClickIdx = Number(innerRow.events.find(e => e.name === 'click').compiledFn.match(/\d+/)[0]);
        const pageClickIdx = Number(pageRow.events.find(e => e.name === 'click').compiledFn.match(/\d+/)[0]);

        // the inner span still correctly reaches `outer` (depth 1), same as before
        expect(output.compiledFnSources[innerClickIdx]).toContain('$ctx[core.SCOPE_PARENT]["outer"]["picked"] = true');

        // the page span's `inner=1` must NOT resolve as a scope write (that
        // would require reaching into the SIBLING span's own local scope,
        // which is not reachable via any ancestor chain) - it must be
        // treated as an ordinary component property, exactly like
        // `pagination` (the *for's own source expression, a root/component
        // property) is
        expect(output.compiledFnSources[pageClickIdx]).toBe('function($ctx, $cmp, $event) { ($cmp["inner"] = 1); }');
    });

    it('leaves a consumer-scope assignment inside <j-template> interpreted, but still compiles a template-local *for one', () => {
        const output = parse(
            `<div *for="comp of items"><j-fragment {template}="comp.type + 'ViewEditor'"></j-fragment></div>` +
            `<j-template #markupViewEditor><p>x</p><input @input="comp.content=$event.target.value"></j-template>` +
            `<j-template #accViewEditor><div *for="row of comp.items"><input @input="row.content=$event.target.value"></div></j-template>`
        );

        const markupInput = output.templatesMapHolder.markupViewEditor.children[1].events[0];
        expect(markupInput.compiledFn).toBeUndefined();
        expect(markupInput.value).toBeDefined();

        const accInput = output.templatesMapHolder.accViewEditor.templates.for.children[0].events[0];
        const idx = Number(accInput.compiledFn.match(/\d+/)[0]);
        expect(output.compiledFnSources[idx]).toContain('$ctx["row"]["content"] =');
    });

    it('does not compile the assignment when compiledBindings build option is off', () => {
        const offOutput = new (require('../lib/core/compiler.output'))('testSuite', undefined, { compiledBindings: false });
        const offResolver = new (require('../lib/core/components.facade'))(offOutput);
        offResolver.addEntry('Element', 'TestSuiteElement', { module: 'TestSuiteModule' });
        offResolver.addEntry('jModule', 'TestSuiteModule', { requiredModules: [] });
        ['for'].forEach(selector => {
            offResolver.addEntry('Directive', 'ForDirective', { selector, module: 'TestSuiteModule' });
        });
        const offParser = require('../lib/core/view-parser/v1');
        offParser.init(offResolver);
        const output = offParser.parse(
            `<div @click="selectedHook=hook.value" *for="hook in hooks">\${hook}</div>`,
            false, ctor, 'TestSuiteElement'
        );

        const rowDiv = output.parsedContent[0].templates.for;
        const clickEvent = rowDiv.events.find(e => e.name === 'click');
        expect(clickEvent.compiledFn).toBeUndefined();

        // re-init the shared htmlParser back to the compiledBindings:true resolver
        // for any tests that run after this one in the same file/process
        htmlParser.init(componentsResolver);
    });
});

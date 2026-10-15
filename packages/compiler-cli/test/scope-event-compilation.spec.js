const BaseViewParser = require('../lib/core/view-parser/base.parser');
const { parseAst } = require('../lib/core/ast.generator');

describe('BaseViewParser.getScopeNames', () => {
    it('returns an empty set when nothing in the chain has a context', () => {
        expect(BaseViewParser.getScopeNames({}).size).toBe(0);
        expect(BaseViewParser.getScopeNames(null).size).toBe(0);
    });

    it('collects the astNode\'s own *for-introduced names at depth 0', () => {
        const astNode = { context: { hook: '$context', idx: { type: 'raw' } } };
        const names = BaseViewParser.getScopeNames(astNode);
        expect(names.get('hook')).toBe(0);
        expect(names.get('idx')).toBe(0);
        expect(names.size).toBe(2);
    });

    it('accumulates names up the elementParent chain, depth increasing per *for/*if level', () => {
        // <div *for="row of rows"><span *for="col of row.cols"><button @click=...>
        const outerForRow = { context: { row: '$context' }, elementParent: null };
        const innerForRow = { context: { col: '$context' }, elementParent: outerForRow };
        const button = { elementParent: innerForRow };
        const names = BaseViewParser.getScopeNames(button);
        expect(names.get('col')).toBe(0);
        expect(names.get('row')).toBe(1);
        expect(names.size).toBe(2);
    });

    it('a name closer to astNode wins if the same name is (unusually) reused at two levels', () => {
        const outerForRow = { context: { item: '$context' }, elementParent: null };
        const innerForRow = { context: { item: '$context' }, elementParent: outerForRow };
        const names = BaseViewParser.getScopeNames(innerForRow);
        expect(names.get('item')).toBe(0);
        expect(names.size).toBe(1);
    });

    it('does not blow up on an ancestor with no context, and does not count it as a depth level', () => {
        const plainWrapper = { elementParent: null };
        const forRow = { context: { hook: '$context' }, elementParent: plainWrapper };
        const names = BaseViewParser.getScopeNames(forRow);
        expect(Array.from(names.entries())).toEqual([['hook', 0]]);
    });

    it('a sibling *for\'s variable is never visible - only the ancestor chain counts, not other subtrees', () => {
        // <div *for="outer in outers">
        //   <span *for="inner in outer.items">...</span>
        //   <span *for="page in pagination">...</span>  <- sibling, does NOT see `inner`
        // </div>
        const outerRow = { context: { outer: '$context' }, elementParent: null };
        const innerSpanRow = { context: { inner: '$context' }, elementParent: outerRow };
        const pageSpanRow = { context: { page: '$context' }, elementParent: outerRow };

        const pageScope = BaseViewParser.getScopeNames(pageSpanRow);
        expect(pageScope.has('inner')).toBe(false);
        expect(pageScope.get('page')).toBe(0);
        expect(pageScope.get('outer')).toBe(1);

        // and the reverse: inner's scope must not see `page` either
        const innerScope = BaseViewParser.getScopeNames(innerSpanRow);
        expect(innerScope.has('page')).toBe(false);
    });
});

describe('BaseViewParser.compileEventAssignments', () => {
    function makeOutput() {
        return { compiledFnSources: [], errorLogs: [] };
    }

    beforeEach(() => {
        BaseViewParser.componentResolver = { compilerObject: { buildOptions: { compiledBindings: true } } };
    });

    it('attaches a compiledFn that writes to $cmp when the assignment target is not a loop-local', () => {
        // the database-hooks bug: *for="hook in hooks; idx=index" (context: {hook,idx})
        // + @click="selectedHook=hook.value" on the SAME element - selectedHook is a
        // real component property, not a loop-local, so it must resolve to $cmp
        const astNode = {
            context: { hook: '$context', idx: { type: 'raw', value: 0 } },
            events: [{ name: 'click', value: parseAst('selectedHook=hook.value') }]
        };
        const output = makeOutput();

        BaseViewParser.compileEventAssignments(astNode, output);

        expect(astNode.events[0].compiledFn).toMatch(/^<%CFN:\d+%>$/);
        const idx = Number(astNode.events[0].compiledFn.match(/\d+/)[0]);
        expect(output.compiledFnSources[idx]).toBe(
            'function($ctx, $cmp, $event) { ($cmp["selectedHook"] = core.resolveIdentifier("hook", $ctx, $cmp)?.["value"]); }'
        );
        // .value is redundant once .compiledFn exists - every runtime
        // consumer (event.handler.js's triggerEvents/attachEventEmitter/
        // attachEventDispatcher) checks .compiledFn first
        expect(astNode.events[0].value).toBeUndefined();
    });

    it('attaches a compiledFn that writes to $ctx when the assignment target IS a loop-local', () => {
        const astNode = {
            context: { idx: { type: 'raw', value: 0 } },
            events: [{ name: 'click', value: parseAst('idx=idx+1') }]
        };
        const output = makeOutput();

        BaseViewParser.compileEventAssignments(astNode, output);

        expect(astNode.events[0].compiledFn).toBeDefined();
        const idx = Number(astNode.events[0].compiledFn.match(/\d+/)[0]);
        expect(output.compiledFnSources[idx]).toContain('$ctx["idx"] =');
    });

    it('resolves scope names from an ancestor *for, not just the event\'s own element', () => {
        // <div *for="row in rows"><span @click="row.selected=true">
        const outerForRow = { context: { row: '$context' }, elementParent: null };
        const span = {
            elementParent: outerForRow,
            events: [{ name: 'click', value: parseAst('row.selected=true') }]
        };
        const output = makeOutput();

        BaseViewParser.compileEventAssignments(span, output);

        const idx = Number(span.events[0].compiledFn.match(/\d+/)[0]);
        expect(output.compiledFnSources[idx]).toContain('$ctx["row"]["selected"] = true');
    });

    it('does nothing when compiledBindings build option is off (interpreter fallback stays intact)', () => {
        BaseViewParser.componentResolver = { compilerObject: { buildOptions: { compiledBindings: false } } };
        const astNode = {
            context: { hook: '$context' },
            events: [{ name: 'click', value: parseAst('selectedHook=hook.value') }]
        };
        const output = makeOutput();

        BaseViewParser.compileEventAssignments(astNode, output);

        expect(astNode.events[0].compiledFn).toBeUndefined();
        expect(output.compiledFnSources.length).toBe(0);
        // the interpreter fallback must be left completely intact whenever
        // compilation doesn't happen
        expect(astNode.events[0].value).toBeDefined();
    });

    it('compiles a plain method-call event via compileValueToJs, run for its side effect', () => {
        const astNode = {
            events: [{ name: 'click', value: parseAst('doSomething()') }]
        };
        const output = makeOutput();

        BaseViewParser.compileEventAssignments(astNode, output);

        const idx = Number(astNode.events[0].compiledFn.match(/\d+/)[0]);
        expect(output.compiledFnSources[idx]).toBe('function($ctx, $cmp, $event) { core.resolveCall("doSomething", [], $ctx, $cmp); }');
        expect(astNode.events[0].value).toBeUndefined();
    });

    it('compiles a multi-statement event handler, joining every statement in source order', () => {
        const astNode = {
            context: { hook: '$context' },
            events: [{ name: 'click', value: parseAst('selectedHook=hook.value;doSomething()') }]
        };
        const output = makeOutput();

        BaseViewParser.compileEventAssignments(astNode, output);

        const idx = Number(astNode.events[0].compiledFn.match(/\d+/)[0]);
        expect(output.compiledFnSources[idx]).toBe(
            'function($ctx, $cmp, $event) { ($cmp["selectedHook"] = core.resolveIdentifier("hook", $ctx, $cmp)?.["value"]); core.resolveCall("doSomething", [], $ctx, $cmp); }'
        );
        expect(astNode.events[0].value).toBeUndefined();
    });

    it('leaves a multi-statement event handler uncompiled if ANY statement fails to compile', () => {
        const astNode = {
            events: [{ name: 'click', value: parseAst('doSomething();selectedHook=a[dynamicKey].fn()') }]
        };
        const output = makeOutput();

        BaseViewParser.compileEventAssignments(astNode, output);

        expect(astNode.events[0].compiledFn).toBeUndefined();
        expect(astNode.events[0].value).toBeDefined();
    });

    it('leaves an assignment to an unknown root inside <j-template> uncompiled (consumer scope supplies it)', () => {
        // <j-template #markupViewEditor><fo-markup-editor @markupEditorChange="comp.content=$event">
        const template = { templateBoundary: true, elementParent: null };
        const editor = {
            elementParent: template,
            events: [{ name: 'markupEditorChange', value: parseAst('comp.content=$event') }]
        };
        const output = makeOutput();

        BaseViewParser.compileEventAssignments(editor, output);

        expect(editor.events[0].compiledFn).toBeUndefined();
        expect(editor.events[0].value).toBeDefined();
    });

    it('still compiles a <j-template>-local *for assignment, ignoring scopes above the template', () => {
        const outerFor = { context: { comp: '$context' }, elementParent: null };
        const template = { templateBoundary: true, elementParent: outerFor };
        const innerFor = { context: { row: '$context' }, elementParent: template };
        const span = { elementParent: innerFor, events: [{ name: 'click', value: parseAst('row.selected=true') }] };
        const output = makeOutput();

        expect(BaseViewParser.getScopeNames(span).has('comp')).toBe(false);
        BaseViewParser.compileEventAssignments(span, output);

        const idx = Number(span.events[0].compiledFn.match(/\d+/)[0]);
        expect(output.compiledFnSources[idx]).toContain('$ctx["row"]["selected"] = true');
    });

    it('does nothing when the element has no events', () => {
        const output = makeOutput();
        expect(() => BaseViewParser.compileEventAssignments({}, output)).not.toThrow();
        expect(output.compiledFnSources.length).toBe(0);
    });
});

const { parseAst, compileAssignmentToJs, compileValueToJs, compileEventBodyToJs } = require('../lib/core/ast.generator');

/**
 * compileAssignmentToJs statically resolves an assignment expression's write
 * target at compile time (Angular-style scope resolution, with an exact
 * `*for`/`*if` hop count - not just "in scope somewhere") instead of the
 * runtime interpreter's dynamic scope-chain search (jeli-js's
 * setModelValue).
 *
 * `scopeNames` is a Map<name, depth> of identifier names known, at compile
 * time, to be local template variables in scope at this point (from
 * `*for`'s astNode.context keys, accumulated up the ancestor chain, each
 * tagged with EXACTLY how many *for/*if scope levels up it lives - 0 = the
 * row's own variable, 1 = its immediate ancestor *for's, ...) - anything
 * not in that map is a component-instance property. `scope(...)` builds
 * one where every name is at depth 0 (the common case for these unit
 * tests: a *for row referencing its OWN variable) - depth-aware
 * (nested-ancestor) cases build the Map explicitly instead.
 */
function scope(...names) {
    return new Map(names.map(name => [name, 0]));
}

function compileFirstStatement(expression, scopeNames) {
    const [node] = parseAst(expression);
    return compileAssignmentToJs(node, scopeNames);
}

describe('compileAssignmentToJs', () => {
    it('returns null for a non-assignment node', () => {
        expect(compileAssignmentToJs({ type: 'call', fn: 'foo', args: [] }, scope())).toBeNull();
    });

    it('returns null for a nullish node', () => {
        expect(compileAssignmentToJs(null, scope())).toBeNull();
        expect(compileAssignmentToJs(undefined, scope())).toBeNull();
    });

    it('compiles a simple identifier LHS not in scope to a $cmp write', () => {
        const compiled = compileFirstStatement('selectedHook=hook.value', scope('hook', 'idx'));
        expect(compiled).toBe('($cmp["selectedHook"] = core.resolveIdentifier("hook", $ctx, $cmp)?.["value"])');
    });

    it('compiles a simple identifier LHS that IS a known scope name (depth 0) to a $ctx write', () => {
        // hypothetical: a loop-local being reassigned - the root name decides
        // the target regardless of what the RHS reads
        const compiled = compileFirstStatement('idx=1', scope('hook', 'idx'));
        expect(compiled).toBe('($ctx["idx"] = 1)');
    });

    it('compiles a member-expression LHS whose root is NOT in scope to a nested $cmp write', () => {
        const compiled = compileFirstStatement('user.name=hook.label', scope('hook'));
        expect(compiled).toBe('($cmp["user"]["name"] = core.resolveIdentifier("hook", $ctx, $cmp)?.["label"])');
    });

    it('compiles a member-expression LHS whose root IS in scope (depth 0) to a nested $ctx write', () => {
        const compiled = compileFirstStatement('row.selected=true', scope('row'));
        expect(compiled).toBe('($ctx["row"]["selected"] = true)');
    });

    it('compiles a member-expression LHS whose root is an ANCESTOR scope (depth 1) with one SCOPE_PARENT hop', () => {
        // <div *for="outer in outers"><span *for="inner in outer.items" @click="outer.picked=true">
        const compiled = compileFirstStatement('outer.picked=true', new Map([['inner', 0], ['outer', 1]]));
        expect(compiled).toBe('($ctx[core.SCOPE_PARENT]["outer"]["picked"] = true)');
    });

    it('compiles a depth-2 ancestor write with two exact SCOPE_PARENT hops, no more, no less', () => {
        const compiled = compileFirstStatement('grand.flag=false', new Map([['inner', 0], ['outer', 1], ['grand', 2]]));
        expect(compiled).toBe('($ctx[core.SCOPE_PARENT][core.SCOPE_PARENT]["grand"]["flag"] = false)');
    });

    it('compiles a namespaced call on the RHS via core.resolveNamespacedCall', () => {
        const compiled = compileFirstStatement('selectedHook=a.b.fn()', scope());
        expect(compiled).toBe('($cmp["selectedHook"] = core.resolveNamespacedCall(["a","b"], "fn", [], $ctx, $cmp))');
    });

    it('falls back to null when a namespace segment is computed (dynamic, not a plain string)', () => {
        // deliberately not compiled: a[dynamicKey].fn() - resolveNamespacedCall's
        // codegen only supports statically-known string namespace segments
        const compiled = compileFirstStatement('selectedHook=a[dynamicKey].fn()', scope());
        expect(compiled).toBeNull();
    });

    it('compiles a deeper (3-segment) namespace with multiple, mixed-type arguments in order', () => {
        const compiled = compileFirstStatement('selectedHook=a.b.c.fn(1, hook.value, "x")', scope('hook'));
        expect(compiled).toBe(
            '($cmp["selectedHook"] = core.resolveNamespacedCall(["a","b","c"], "fn", [1, core.resolveIdentifier("hook", $ctx, $cmp)?.["value"], "x"], $ctx, $cmp))'
        );
    });

    it('falls back to null when an argument (not just the namespace) uses an uncompilable construct', () => {
        // the namespace itself (a.b) is fine; it's one of fn's own
        // arguments that is a namespaced call, which recurses back into
        // the same computed-namespace bail-out
        const compiled = compileFirstStatement('selectedHook=a.b.fn(x[dynamicKey].other())', scope());
        expect(compiled).toBeNull();
    });

    it('compiles a single-segment namespace (edge of the array shape, not just 2+)', () => {
        // note: unlike the assignment LHS (compileAssignmentToJs, which
        // decides $ctx vs $cmp - and how many SCOPE_PARENT hops - from
        // scopeNames at COMPILE time), resolveNamespacedCall's root-segment
        // resolution is always dynamic/runtime (context-first, same as a
        // plain identifier read) regardless of scopeNames - scopeNames only
        // ever affects an assignment's write target, never a call's
        // receiver resolution
        const compiled = compileFirstStatement('selectedHook=hook.render()', scope('hook'));
        expect(compiled).toBe('($cmp["selectedHook"] = core.resolveNamespacedCall(["hook"], "render", [], $ctx, $cmp))');
    });

    it('resolves the write target from an empty scope (everything is a component property)', () => {
        const compiled = compileFirstStatement('count=count+1', scope());
        expect(compiled).toBe('($cmp["count"] = (core.resolveIdentifier("count", $ctx, $cmp) + 1))');
    });
});

describe('compileEventBodyToJs', () => {
    function compileStatements(expression, scopeNames) {
        return compileEventBodyToJs(parseAst(expression), scopeNames);
    }

    it('returns null for an empty or non-array statement list', () => {
        expect(compileEventBodyToJs(null, scope())).toBeNull();
        expect(compileEventBodyToJs([], scope())).toBeNull();
    });

    it('compiles a single assignment statement the same way compileAssignmentToJs would', () => {
        const compiled = compileStatements('selectedHook=hook.value', scope('hook'));
        expect(compiled).toBe('($cmp["selectedHook"] = core.resolveIdentifier("hook", $ctx, $cmp)?.["value"])');
    });

    it('compiles a plain call statement via compileValueToJs', () => {
        const compiled = compileStatements('doSomething()', scope());
        expect(compiled).toBe('core.resolveCall("doSomething", [], $ctx, $cmp)');
    });

    it('compiles multiple statements in source order, joined by "; "', () => {
        const compiled = compileStatements('selectedHook=hook.value;doSomething()', scope('hook'));
        expect(compiled).toBe(
            '($cmp["selectedHook"] = core.resolveIdentifier("hook", $ctx, $cmp)?.["value"]); core.resolveCall("doSomething", [], $ctx, $cmp)'
        );
    });

    it('is all-or-nothing: returns null if ANY statement fails to compile, even when others would succeed', () => {
        const compiled = compileStatements('doSomething();selectedHook=a[dynamicKey].fn()', scope());
        expect(compiled).toBeNull();
    });
});

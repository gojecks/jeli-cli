const { parseAst, compileValueToJs, compileAssignmentToJs, compileEventBodyToJs } = require('../lib/core/ast.generator');

/**
 * `compileValueToJs` was built for text/attribute bindings, whose compiled
 * function shape is `function($ctx, $cmp) { ... }` - no `$event` parameter
 * exists there. Reusing it for EVENT bodies (compileEventBodyToJs/
 * compileAssignmentToJs, whose generated shape is
 * `function($ctx, $cmp, $event) { ... }` - see event.handler.js's
 * triggerEvents calling `registeredEvent.compiledFn(context, componentInstance, event)`)
 * left the literal string `"$event"` falling through to the generic
 * identifier branch - `core.resolveIdentifier("$event", $ctx, $cmp)` -
 * which looks for a property literally named "$event" instead of
 * referencing the function's own third parameter.
 *
 * `allowEvent` (default false, so text/attribute compilation is completely
 * unaffected) fixes this, and is threaded recursively into every sub-node
 * so `$event` resolves correctly anywhere it's written in an event
 * expression. This is a DELIBERATE, documented divergence from the
 * interpreter (see compileValueToJs's doc comment for the full reasoning):
 * the interpreter's own `$event` support is much narrower - broken the
 * moment `$event` is nested one level past a bare call-argument or a bare
 * assignment RHS - and that narrowness reads as an implementation gap, not
 * an intentional contract worth preserving bug-for-bug. The compiled path
 * is strictly MORE correct here; nothing that worked interpreted stops
 * working compiled.
 */
describe('compileValueToJs - $event handling', () => {
    it('leaves "$event" as a plain identifier lookup by default (text/attribute compilation, no $event parameter exists there)', () => {
        expect(compileValueToJs('$event')).toBe('core.resolveIdentifier("$event", $ctx, $cmp)');
    });

    it('references the real $event parameter when allowEvent is true', () => {
        expect(compileValueToJs('$event', true)).toBe('$event');
    });

    it('does not affect the pre-existing $this special case', () => {
        expect(compileValueToJs('$this', true)).toBe('$cmp');
        expect(compileValueToJs('$this', false)).toBe('$cmp');
    });

    it('threads allowEvent through a member-chain whose root is $event', () => {
        expect(compileValueToJs(['$event', 'target', 'value'], true)).toBe('$event?.["target"]?.["value"]');
        // default (false): unchanged, existing behavior
        expect(compileValueToJs(['$event', 'target', 'value'])).toBe('core.resolveIdentifier("$event", $ctx, $cmp)?.["target"]?.["value"]');
    });

    it('a computed member-chain segment is compiled normally - it is just a key expression, not itself $event', () => {
        const node = ['$event', ['key']]; // $event[key]
        expect(compileValueToJs(node, true)).toBe('$event?.[core.resolveIdentifier("key", $ctx, $cmp)]');
    });

    it('threads allowEvent through a call\'s arguments, mixed with non-$event arguments', () => {
        const [node] = parseAst('run($event, comp)');
        expect(compileValueToJs(node, true)).toBe('core.resolveCall("run", [$event, core.resolveIdentifier("comp", $ctx, $cmp)], $ctx, $cmp)');
    });

    it('threads allowEvent through a namespaced call\'s arguments', () => {
        const [node] = parseAst('a.b.fn($event.target)');
        expect(compileValueToJs(node, true)).toBe('core.resolveNamespacedCall(["a","b"], "fn", [$event?.["target"]], $ctx, $cmp)');
    });

    it('compiles a call whose namespace root is $event via core.resolveEventNamespacedCall', () => {
        const [node] = parseAst('$event.stopPropagation()');
        expect(compileValueToJs(node, true)).toBe('core.resolveEventNamespacedCall([], "stopPropagation", [], $event)');
    });

    it('compiles a deeper $event-rooted namespaced call, stripping only the leading $event segment', () => {
        const [node] = parseAst('$event.target.closest(".row")');
        expect(compileValueToJs(node, true)).toBe('core.resolveEventNamespacedCall(["target"], "closest", [".row"], $event)');
    });

    it('leaves an $event-rooted namespaced call as a plain (broken) lookup when allowEvent is false', () => {
        // matches default/non-event compilation - never reachable from
        // compileEventBodyToJs/compileAssignmentToJs in practice, but
        // proves allowEvent actually gates this branch
        const [node] = parseAst('$event.stopPropagation()');
        expect(compileValueToJs(node, false)).toBe('core.resolveNamespacedCall(["$event"], "stopPropagation", [], $ctx, $cmp)');
    });

    it('threads allowEvent through a ternary\'s test/cons/alt - the reported case', () => {
        const [node] = parseAst('$event.target.dataset.id==1?run():false');
        expect(compileValueToJs(node, true)).toBe(
            '(($event?.["target"]?.["dataset"]?.["id"] == 1) ? core.resolveCall("run", [], $ctx, $cmp) : false)'
        );
    });

    it('threads allowEvent through a binary expression\'s left/right', () => {
        const [node] = parseAst('$event.type=="click"');
        expect(compileValueToJs(node, true)).toBe('($event?.["type"] == "click")');
    });

    it('threads allowEvent through a unary expression\'s argument', () => {
        const [node] = parseAst('!$event.defaultPrevented');
        expect(compileValueToJs(node, true)).toBe('(!$event?.["defaultPrevented"])');
    });

    it('threads allowEvent through an object-literal\'s values', () => {
        const [node] = parseAst('({x: $event.clientX})');
        expect(compileValueToJs(node, true)).toBe('({"x": $event?.["clientX"]})');
    });

    it('threads allowEvent through a call nested as an argument to another call', () => {
        const [node] = parseAst('run(other($event))');
        expect(compileValueToJs(node, true)).toBe('core.resolveCall("run", [core.resolveCall("other", [$event], $ctx, $cmp)], $ctx, $cmp)');
    });
});

describe('compileAssignmentToJs / compileEventBodyToJs - $event handling', () => {
    it('compiles $event correctly on the RHS (it is always event context)', () => {
        const [node] = parseAst('c=$event.target.value');
        expect(compileAssignmentToJs(node, new Map())).toBe('($cmp["c"] = $event?.["target"]?.["value"])');
    });

    it('compiles an assignment whose RHS is a call using $event - broken in the interpreter, works compiled', () => {
        const [node] = parseAst('c=run($event)');
        expect(compileAssignmentToJs(node, new Map())).toBe('($cmp["c"] = core.resolveCall("run", [$event], $ctx, $cmp))');
    });

    it('compileEventBodyToJs compiles the originally reported case correctly end to end', () => {
        const statements = parseAst('c=$event.target.dataset.id==1?run():false;');
        expect(compileEventBodyToJs(statements, new Map())).toBe(
            '($cmp["c"] = (($event?.["target"]?.["dataset"]?.["id"] == 1) ? core.resolveCall("run", [], $ctx, $cmp) : false))'
        );
    });

    it('compileEventBodyToJs threads $event through a non-assignment call statement', () => {
        const statements = parseAst('$event.stopPropagation();c=1');
        expect(compileEventBodyToJs(statements, new Map())).toBe(
            'core.resolveEventNamespacedCall([], "stopPropagation", [], $event); ($cmp["c"] = 1)'
        );
    });

    it('compileEventBodyToJs handles run($event, comp) as a whole statement', () => {
        const statements = parseAst('run($event, comp)');
        expect(compileEventBodyToJs(statements, new Map())).toBe(
            'core.resolveCall("run", [$event, core.resolveIdentifier("comp", $ctx, $cmp)], $ctx, $cmp)'
        );
    });
});

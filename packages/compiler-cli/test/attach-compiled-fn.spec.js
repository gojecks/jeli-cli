const BaseViewParser = require('../lib/core/view-parser/base.parser');

/**
 * attachCompiledFn compiles a filterModel (native attr / component-prop
 * binding) into a `.compiledFn`. Unlike compileEventAssignments (which
 * deletes an event's `.value` outright), this one keeps `.once`/`.type`/
 * `.suffix` regardless - AttributeAppender.byType still reads `.type`/
 * `.suffix` for the `style` case independent of how the value was computed
 * - but DOES delete `.prop` once `.compiledFn` succeeds, since it's
 * redundant for value computation from that point on (mirrors the events
 * case). See lifecycle-compiled-fn.spec.js (jeli-js) for the one runtime
 * consumer (LifeCycle._updateViewBinding) that had to be updated first,
 * since it used `.prop`'s mere presence - not its value - as a type
 * discriminator between a dynamic binding and a raw literal prop.
 */
describe('BaseViewParser.attachCompiledFn', () => {
    beforeEach(() => {
        BaseViewParser.componentResolver = { compilerObject: { buildOptions: { compiledBindings: true } } };
    });

    function makeOutput() {
        return { compiledFnSources: [] };
    }

    it('deletes .prop once .compiledFn is successfully attached', () => {
        const filterModel = { prop: 'selectedHook' };
        const output = makeOutput();

        BaseViewParser.attachCompiledFn(filterModel, output);

        expect(filterModel.compiledFn).toMatch(/^<%CFN:\d+%>$/);
        expect(filterModel.prop).toBeUndefined();
    });

    it('keeps .once/.type/.suffix (style-specific metadata) alongside .compiledFn', () => {
        const filterModel = { prop: ['hook', 'tint'], type: 'color', suffix: 'px', once: true };
        const output = makeOutput();

        BaseViewParser.attachCompiledFn(filterModel, output);

        expect(filterModel.compiledFn).toBeDefined();
        expect(filterModel.type).toBe('color');
        expect(filterModel.suffix).toBe('px');
        expect(filterModel.once).toBe(true);
        expect(filterModel.prop).toBeUndefined();
    });

    it('leaves .prop untouched when compiledBindings is off', () => {
        BaseViewParser.componentResolver = { compilerObject: { buildOptions: { compiledBindings: false } } };
        const filterModel = { prop: 'selectedHook' };
        const output = makeOutput();

        BaseViewParser.attachCompiledFn(filterModel, output);

        expect(filterModel.compiledFn).toBeUndefined();
        expect(filterModel.prop).toBe('selectedHook');
    });

    it('leaves .prop untouched when a filter/pipe is present (compilation skipped)', () => {
        const filterModel = { prop: 'selectedHook', fns: ['%uppercase%'] };
        const output = makeOutput();

        BaseViewParser.attachCompiledFn(filterModel, output);

        expect(filterModel.compiledFn).toBeUndefined();
        expect(filterModel.prop).toBe('selectedHook');
    });

    it('leaves .prop untouched when compileValueToJs can\'t compile the expression', () => {
        // a computed namespace segment - a statically-known namespace like
        // a.b.fn() compiles fine (via core.resolveNamespacedCall); a
        // dynamic one doesn't, same "intentionally not compiled" bail-out
        const filterModel = { prop: { type: 'call', fn: 'fn', args: [], namespaces: [['dynamicKey'], 'b'] } };
        const output = makeOutput();

        BaseViewParser.attachCompiledFn(filterModel, output);

        expect(filterModel.compiledFn).toBeUndefined();
        expect(filterModel.prop).toBeDefined();
    });
});

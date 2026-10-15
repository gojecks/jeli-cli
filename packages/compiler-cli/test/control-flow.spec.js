const compilerObject = new (require('../lib/core/compiler.output'))('testSuite');
const htmlParser = require('../lib/core/view-parser/v1');
const componentsResolver = new (require('../lib/core/components.facade'))(compilerObject);

componentsResolver.addEntry('Element', 'TestSuiteElement', {
    module: 'TestSuiteModule'
});
componentsResolver.addEntry('jModule', 'TestSuiteModule', {
    requiredModules: []
});

// register the CommonModule structural directives this suite exercises, mirroring how a real
// build resolves `*if` / `*for` / `{:switch}` / `*switchCase` / `*switchDefault` to
// common.IfDirective / common.ForDirective / common.SwitchDirective / common.SwitchCaseDirective /
// common.SwitchDefaultDirective, so assertions here reflect real compiled output shape.
['if', 'for', 'switch', 'switchCase', 'switchDefault'].forEach(selector => {
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

describe('control-flow block syntax', () => {
    it('compiles @if into a structural *if directive', () => {
        const ast = parse(`<div>@if(showModal){<p>Hello</p>}</div>`);
        const block = ast.parsedContent[0].children[0];
        expect(block.type).toBe(8);
        expect(block.text).toBe('if');
        expect(block.props.if.prop).toBe('showModal');
        expect(block.templates.if.children[0].name).toBe('p');
        expect(block.providers.length).toBe(1);
    });

    it('does not leak raw @if(...) text into the output', () => {
        const ast = parse(`<div>@if(cond){<p>Hi</p>}</div>`);
        expect(JSON.stringify(ast)).not.toContain('@if(');
    });

    it('compiles @for into a structural *for directive with loop context', () => {
        const ast = parse(`<ul>@for(item of items){<li>\${item}</li>}</ul>`);
        const block = ast.parsedContent[0].children[0];
        expect(block.type).toBe(8);
        expect(block.text).toBe('for');
        expect(block.props.forOf.prop).toBe('items');
        expect(block.templates.for.context).toEqual({ item: '$context' });
        expect(block.providers.length).toBe(1);
    });

    it('compiles @switch/@case/@switchDefault into Switch directives', () => {
        const ast = parse(`
            <div>
                @switch(status){
                    @case(1){<span>One</span>}
                    @case(2){<span>Two</span>}
                    @switchDefault(){<span>Other</span>}
                }
            </div>
        `);
        const switchNode = ast.parsedContent[0].children[0];
        // non-structural binding: {:switch}="status" on the wrapping fragment
        expect(switchNode.props.switch.prop).toBe('status');
        expect(switchNode.providers.length).toBe(1);

        const [case1, case2, defaultCase] = switchNode.children;
        expect(case1.text).toBe('switchCase');
        expect(case1.props.switchCase.prop).toBe(1);
        expect(case2.props.switchCase.prop).toBe(2);
        expect(defaultCase.text).toBe('switchDefault');
        expect(defaultCase.props).toBeUndefined();
    });

    it('keeps interpolation bindings scoped to their own @case block', () => {
        const ast = parse(`
            <div>
                @switch(v){
                    @case(0){Case \${zero}}
                    @case(1){Case \${one}}
                }
            </div>
        `);
        const [case0, case1] = ast.parsedContent[0].children[0].children;
        const case0Text = case0.templates.switchCase.children[0];
        const case1Text = case1.templates.switchCase.children[0];
        expect(case0Text.ast[1][0][1].prop).toBe('zero');
        expect(case1Text.ast[1][0][1].prop).toBe('one');
    });

    it('compiles @if/@else into *if with an else-template reference', () => {
        const ast = parse(`<div>@if(loggedIn){<p>Hi</p>} @else {<p>Bye</p>}</div>`);
        const block = ast.parsedContent[0].children[0];
        expect(block.type).toBe(8);
        expect(block.props.if.prop).toBe('loggedIn');
        // "else as X" compiles ifElse into a template-key reference resolved against templatesMapHolder
        expect(block.templates).toHaveProperty('ifElse');

        const elseRefName = Object.keys(ast.templatesMapHolder)[0];
        expect(elseRefName).toMatch(/^__jeliElse\d+$/);
        expect(ast.templatesMapHolder[elseRefName].name).toBe('p');
    });

    it('compiles @if/@else-if/@else into a nested *if chain', () => {
        const ast = parse(`
            <div>
                @if(a){<p>A</p>} @else if(b){<p>B</p>} @else {<p>C</p>}
            </div>
        `);
        const block = ast.parsedContent[0].children[0];
        expect(block.props.if.prop).toBe('a');

        const refNames = Object.keys(ast.templatesMapHolder);
        expect(refNames.length).toBe(2);

        // outer else-template holds the nested @else-if chain (structural *if again)
        const outerRef = refNames.find(name => ast.templatesMapHolder[name].type === 8);
        expect(ast.templatesMapHolder[outerRef].props.if.prop).toBe('b');

        // innermost else-template holds the final @else content
        const innerRef = refNames.find(name => name !== outerRef);
        expect(ast.templatesMapHolder[innerRef].name).toBe('p');
    });

    it('allows an HTML comment between a block\'s closing brace and the next @else-if/@else', () => {
        const ast = parse(`
            <div>
                @if(a){<p>A</p>}
                <!-- b branch -->
                @else if(b){<p>B</p>}
                <!-- c branch -->
                @else {<p>C</p>}
            </div>
        `);
        const block = ast.parsedContent[0].children[0];
        expect(block.type).toBe(8);
        expect(block.props.if.prop).toBe('a');
        expect(ast.errorLogs).toEqual([]);
    });

    it('does not treat a bare @else (without a preceding @if) as control flow', () => {
        const ast = parse(`<div>@else {<p>orphan</p>}</div>`);
        expect(JSON.stringify(ast)).toContain('@else');
        expect(ast.errorLogs).toEqual([
            '[@else] must immediately follow an @if or @else-if block'
        ]);
    });

    it('has no errorLogs for well-formed blocks', () => {
        const ast = parse(`
            <div>
                @if(a){<p>A</p>} @else if(b){<p>B</p>} @else {<p>C</p>}
                @for(item of items){<li>\${item}</li>}
                @switch(v){ @case(1){<span>1</span>} @switchDefault(){<span>d</span>} }
            </div>
        `);
        expect(ast.errorLogs).toEqual([]);
    });
});

describe('control-flow block syntax - validation', () => {
    it('reports a missing closing brace for @if and leaves it untransformed', () => {
        const ast = parse(`<div>@if(cond){<p>Hi</p></div>`);
        expect(ast.errorLogs).toEqual([
            `[@if] missing '{ ... }' block body`
        ]);
        expect(JSON.stringify(ast)).toContain('@if(cond){');
    });

    it('reports a missing closing paren for @if', () => {
        const ast = parse(`<div>@if(cond</div>`);
        expect(ast.errorLogs).toEqual([
            `[@if] missing closing ')' for condition`
        ]);
    });

    it('reports an empty @if condition', () => {
        const ast = parse(`<div>@if(){<p>Hi</p>}</div>`);
        expect(ast.errorLogs).toEqual([
            '[@if] requires a condition, e.g. @if(expression) { ... }'
        ]);
    });

    it('reports @case used outside a @switch block', () => {
        const ast = parse(`<div>@case(1){<span>One</span>}</div>`);
        expect(ast.errorLogs).toEqual([
            '[@case] must be used directly inside a @switch(...) { } block'
        ]);
    });

    it('reports @switchDefault used outside a @switch block', () => {
        const ast = parse(`<div>@switchDefault(){<span>Other</span>}</div>`);
        expect(ast.errorLogs).toEqual([
            '[@switchDefault] must be used directly inside a @switch(...) { } block'
        ]);
    });

    it('reports @case nested inside another @case, not directly inside @switch', () => {
        const ast = parse(`
            <div>
                @switch(v){
                    @case(1){ @case(2){<span>nested</span>} }
                }
            </div>
        `);
        expect(ast.errorLogs).toEqual([
            '[@case] must be used directly inside a @switch(...) { } block'
        ]);
    });

    it('reports malformed @for syntax missing an "of"/"in" clause', () => {
        const ast = parse(`<ul>@for(items){<li>x</li>}</ul>`);
        expect(ast.errorLogs).toEqual([
            '[@for] expected syntax: @for(item of items) { ... } or @for(item in items) { ... }'
        ]);
    });

    it('reports a missing @else-if body', () => {
        const ast = parse(`<div>@if(a){<p>A</p>} @else if(b)</div>`);
        expect(ast.errorLogs).toEqual([
            `[@else if] missing '{ ... }' block body`
        ]);
    });
});

describe('control-flow block syntax - nesting', () => {
    it('compiles @if nested inside @for, resolving the loop variable in the condition and body', () => {
        const ast = parse(`<ul>@for(item of items){ @if(item.active){<span>\${item.name}</span>} }</ul>`);
        expect(ast.errorLogs).toEqual([]);

        const forNode = ast.parsedContent[0].children[0];
        expect(forNode.text).toBe('for');
        expect(forNode.templates.for.context).toEqual({ item: '$context' });

        const ifNode = forNode.templates.for.children[0];
        expect(ifNode.text).toBe('if');
        expect(ifNode.props.if.prop).toEqual(['item', 'active']);
        expect(ifNode.templates.if.children[0].children[0].ast[1][0][1].prop).toEqual(['item', 'name']);
    });

    it('compiles @for nested inside @if', () => {
        const ast = parse(`<div>@if(showList){ @for(item of items){<li>\${item}</li>} }</div>`);
        expect(ast.errorLogs).toEqual([]);

        const ifNode = ast.parsedContent[0].children[0];
        expect(ifNode.text).toBe('if');
        const forNode = ifNode.templates.if.children[0];
        expect(forNode.text).toBe('for');
        expect(forNode.props.forOf.prop).toBe('items');
    });

    it('compiles @for nested inside @case, correctly scoped as a direct child of @switch', () => {
        const ast = parse(`
            <div>
                @switch(mode){
                    @case(1){ @for(item of items){<li>\${item}</li>} }
                    @switchDefault(){<span>none</span>}
                }
            </div>
        `);
        expect(ast.errorLogs).toEqual([]);

        const [case1, defaultCase] = ast.parsedContent[0].children[0].children;
        expect(case1.text).toBe('switchCase');
        const forNode = case1.templates.switchCase.children[0];
        expect(forNode.text).toBe('for');
        expect(defaultCase.text).toBe('switchDefault');
    });

    it('compiles @switch nested inside @for, with @case/@switchDefault still correctly scoped', () => {
        const ast = parse(`
            <div>@for(row of rows){ @switch(row.type){ @case(1){<span>a</span>} @switchDefault(){<span>b</span>} } }</div>
        `);
        expect(ast.errorLogs).toEqual([]);

        const forNode = ast.parsedContent[0].children[0];
        const switchNode = forNode.templates.for.children[0];
        expect(switchNode.props.switch.prop).toEqual(['row', 'type']);
        expect(switchNode.children.map(c => c.text)).toEqual(['switchCase', 'switchDefault']);
    });

    it('compiles a 4-level-deep @for > @if > @switch > @case chain with no errors', () => {
        const ast = parse(`
            <div>@for(item of items){ @if(item.active){ @switch(item.type){ @case(1){<span>a</span>} @switchDefault(){<span>b</span>} } } }</div>
        `);
        expect(ast.errorLogs).toEqual([]);
    });

    it('compiles @for nested inside an @else block', () => {
        const ast = parse(`<div>@if(a){<p>A</p>} @else { @for(item of items){<li>\${item}</li>} }</div>`);
        expect(ast.errorLogs).toEqual([]);

        const refName = Object.keys(ast.templatesMapHolder)[0];
        expect(ast.templatesMapHolder[refName].text).toBe('for');
    });

    it('assigns unique else-template ref names across independent sibling @if/@else pairs', () => {
        const ast = parse(`<div>@if(a){<p>A</p>} @else {<p>B</p>} <span>@if(c){<p>C</p>} @else {<p>D</p>}</span></div>`);
        expect(ast.errorLogs).toEqual([]);
        expect(Object.keys(ast.templatesMapHolder)).toEqual(['__jeliElse0', '__jeliElse1']);
    });

    it('correctly balances parens for @switch/@case expressions containing their own function calls', () => {
        const ast = parse(`<div>@switch(getMode()){ @case(getStatus(1,2)){<span>a</span>} }</div>`);
        expect(ast.errorLogs).toEqual([]);
        expect(ast.parsedContent[0].children[0].props.switch.prop).toEqual({
            type: 'call', args: [], fn: 'getMode'
        });
    });
});

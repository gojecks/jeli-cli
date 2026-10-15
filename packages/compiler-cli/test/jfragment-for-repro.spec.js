// compile-time half of the @for(){} single-row-rendering repro - see jeli-js's test/jfragment-for-repro.spec.js for the DOM-level reproduction and fix
const compilerObject = new (require('../lib/core/compiler.output'))('testSuite');
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

describe('@for(...) { <singleElement> } avoids the synthetic # fragment when it safely can', () => {
    it('plain <li>${alphabet.id}</li> block body: *for attaches directly to the <li>, no # wrapper', () => {
        const output = parse(
            `<ul>@for(alphabet of alphabets){<li>\${alphabet.id}</li>}</ul>`
        );
        expect(output.errorLogs).toEqual([]);
        const body = output.parsedContent[0].children[0].templates.for;
        expect(body.type).toBe(1);
        expect(body.name).toBe('li');
        expect(body.context).toEqual({ alphabet: '$context' });
    });

    it('<li *for="alphabet of alphabets"> attribute-style: same shape, NOT wrapped', () => {
        const output = parse(
            `<ul><li *for="alphabet of alphabets">\${alphabet.id}</li></ul>`
        );
        const body = output.parsedContent[0].children[0].templates.for;
        expect(body.type).toBe(1);
        expect(body.name).toBe('li');
        expect(body.context).toEqual({ alphabet: '$context' });
    });

    it('<j-fragment {template}="..."/> block body: still wrapped in {type:1,name:"#"} - *for stays off the SAME <j-fragment> that dispatches template=, to avoid the separate loop-variable-loss bug', () => {
        const output = parse(
            `<ul>@for(alphabet of alphabets){<j-fragment {template}="alphabet.id" />}</ul>`
        );
        expect(output.errorLogs).toEqual([]);

        const forFragment = output.parsedContent[0].children[0];
        expect(forFragment.type).toBe(8);
        expect(forFragment.text).toBe('for');

        const body = forFragment.templates.for;
        expect(body.type).toBe(1);
        expect(body.name).toBe('#');
        expect(body.context).toEqual({ alphabet: '$context' });
        expect(body.children[0].type).toBe(13);
        expect(body.children[0].$templateId.prop).toEqual(['alphabet', 'id']);
    });

    it('@for(...) { @if(...) { <span>...</span> } } block body: still wrapped - *for stays off the <j-fragment *if=...> the nested block produces, since *for + *if can\'t combine on one element', () => {
        const output = parse(
            `<ul>@for(item of items){ @if(item.active){<span>\${item.name}</span>} }</ul>`
        );
        expect(output.errorLogs).toEqual([]);
        const body = output.parsedContent[0].children[0].templates.for;
        expect(body.type).toBe(1);
        expect(body.name).toBe('#');
        expect(body.children[0].text).toBe('if');
    });

    it('hand-split <j-fragment *for="..."><j-fragment template="..."/></j-fragment>: unaffected, same # wrapper as the @for(){} block form', () => {
        const output = parse(
            `<ul><j-fragment *for="alphabet of alphabets"><j-fragment {template}="alphabet.id" /></j-fragment></ul>`
        );
        const body = output.parsedContent[0].children[0].templates.for;
        expect(body.type).toBe(1);
        expect(body.name).toBe('#');
        expect(body.children[0].type).toBe(13);
    });
});

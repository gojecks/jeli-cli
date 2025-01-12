const chai = require('chai');
const expect = chai.expect;
const htmlParser = require('../lib/core/html_parser');
const compilerObject = new (require('../lib/core/compiler.output'))('testSuite');
const componentsResolver = new (require('../lib/core/components.facade'))(compilerObject);
componentsResolver.addEntry('Element','TestSuiteElement', {
    module: 'TestSuiteModule'
});

const ctor = {
    selector: 'test-suite',
    events: {
        'click': {
            type: 'event',
            value: [
                {
                    type: 'call',
                    args: [
                        '$event'
                    ],
                    fn: 'onButtonClick'
                }
            ],
            target: [
                'button'
            ]
        }
    },
    props: {
        value: {}
    }
};

describe('HTML Parser', () => {
    it('Generates HTML AST', () => {
        const htmlAst = htmlParser('<p>Jeli Rocks</p>',  ctor);
        expect(htmlAst.parsedContent[0].name).equal('p');
        expect(htmlAst.parsedContent[0].children[0].ast[0]).equal('Jeli Rocks');
    })

    it('generates arrayList based on $n(n, n++)', () => {
        const htmlAst = htmlParser('<p *for="i of $range(1,5)" template="test"></p>',  ctor, componentsResolver, 'TestSuiteElement');
        // expect(htmlAst.parsedContent[0].name).equal('p');
        // expect(htmlAst.parsedContent[0].children[0].ast[0]).equal('Jeli Rocks');
        console.log(JSON.stringify(htmlAst.parsedContent[0]));
    })
})
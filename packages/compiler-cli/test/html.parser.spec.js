const chai = require('chai');
const expect = chai.expect;
const htmlParser = require('../lib/core/html_parser');
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
})
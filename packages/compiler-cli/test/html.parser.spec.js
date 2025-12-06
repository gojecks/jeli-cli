const compilerObject = new (require('../lib/core/compiler.output'))('testSuite');
const htmlParser = require('../lib/core/view-parser/v1');
const componentsResolver = new (require('../lib/core/components.facade'))(compilerObject);
componentsResolver.addEntry('Element','TestSuiteElement', {
    module: 'TestSuiteModule'
});

htmlParser.init(componentsResolver);

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
        const htmlAst = htmlParser.parse('<p>Jeli Rocks</p>', false,  ctor);
        expect(htmlAst.parsedContent[0].name).toBe('p');
        expect(htmlAst.parsedContent[0].children[0].ast[0]).toBe('Jeli Rocks');
    })

    it('generates arrayList based on $n(n, n++)', () => {
        const content = `
            <div>
                @if(true){
                    <div class="modal-overlay" id="profileModal" role="dialog" aria-modal="true" aria-labelledby="profileModalTitle" tabindex="-1">
                            <div class="modal">
                                <button class="close-btn" aria-label="Close profile editor" id="closeProfileModal">&times;</button>
                                <h2 id="profileModalTitle">Edit Profile</h2>
                                @if(showForm){
                                    <form id="profileForm" novalidate>
                                        <label for="profileName">Name
                                            <input type="text" id="profileName" name="profileName" required autocomplete="name" />
                                        </label>
                                        <label for="profileEmail">Email
                                            <input type="email" id="profileEmail" name="profileEmail" required autocomplete="email" />
                                        </label>
                                        <label for="profileBio">Bio
                                            <textarea id="profileBio" name="profileBio" rows="4" placeholder="Write a short bio about yourself..."></textarea>
                                        </label>
                                        <button type="submit" class="submit-btn">Save Changes</button>
                                        <div class="form-message" id="profileFormMessage" aria-live="polite"></div>
                                    </form>
                                }
                            </div>
                        </div>
                    </div>
                    @for(v of vs){
                        <p>This is paragraph</p>
                        <div class="switch-mode">
                            @switch(v){
                                @case(0){
                                    This is case \$\{0\}
                                }
                                
                                @case(1){
                                    <div class="case-1">This is case 1</div>
                                }
                                
                                @switchDefault(){
                                    <div class="default">
                                        @for(another of testings){
                                            <div>\$\{another\}</div>
                                        }
                                    </div>
                                }
                            }
                        </div>
                    }
                } 
            @for(test of tests){
                <p template="test"></p>
            }
            <p *for="i of $range(1,5)" template="test"></p>
        `;
        const htmlAst = htmlParser.parse(content, false,  ctor, 'TestSuiteElement');
        // expect(htmlAst.parsedContent[0].name).toBe('p');
        // expect(htmlAst.parsedContent[0].children[0].ast[0]).toBe('Jeli Rocks');
        console.log(JSON.stringify(htmlAst));
    })
})
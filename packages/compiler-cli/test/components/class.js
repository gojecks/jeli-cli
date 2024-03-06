Element({
    selector: 'test-class',
    template: '<p>Test Class Instance',
    props: ['value']
})
export class TestClass extends HTMLElement{

    constructor(testBedService){
        this.testBedService = testBedService
    }

    get _testBed(){
        return this.testBedService;
    }

    didInit(){
        console.log('Component Init')
    }
}
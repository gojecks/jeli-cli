Element({
    selector: 'test-suite',
    template: '<p>This is a test suite</p>',
    props: ['value'],
    events: ['click-delegate:button=onButtonClick($event)']
})
export function TestSuiteElement(){
    this.value = 'Test Bed'
}
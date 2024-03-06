Pipe({
    name: 'testPipe'
})
export function TestSuitePipe(){
    this.compile = function(){
        return 'This is test suite';
    }
}
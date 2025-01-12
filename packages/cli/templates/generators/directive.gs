
Directive({
    selector: "[SELECTOR]"
})
export class [NAME]Directive {
    constructor(){
        [SCRIPTCONTENT]
    }

    didInit(){
        console.log('[NAME] did initialize');
    }

    viewDidDestroy(){
        console.log('[NAME] view did destroy');
    }
}
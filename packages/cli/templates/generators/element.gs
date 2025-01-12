
Element({
    selector: '[SELECTOR]',
    templateUrl: './[FILENAME].html',
    styleUrl: './[FILENAME].[STYLING]'
})
export class [NAME]Element {
    
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

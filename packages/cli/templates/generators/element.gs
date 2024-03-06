
Element({
    selector: '[SELECTOR]',
    templateUrl: './[FILENAME].html',
    styleUrl: './[FILENAME].[STYLING]'
})
export function [NAME]Element() {
    [SCRIPTCONTENT]
}

[NAME].prototype.didInit = function(){
    console.log('[NAME] did initialize');
}

[NAME].prototype.viewDidDestroy = function(){
    console.log('[NAME] view did destroy');
}
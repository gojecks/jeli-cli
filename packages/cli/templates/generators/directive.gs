
Directive({
    selector: "[SELECTOR]"
})
export function [NAME]Directive() {

}

[NAME].prototype.didInit = function(){
    console.log('[NAME] did initialize');
}

[NAME].prototype.viewDidDestroy = function(){
    console.log('[NAME] view did destroy');
}
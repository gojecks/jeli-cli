import { CommonModule } from '@jeli/common';
import { AppElement } from './app.element';

jModule({
    requiredModules: [
        CommonModule
    ],
    selectors: [
        AppElement
    ],
    rootElement: AppElement
})
export function AppModule() {

}
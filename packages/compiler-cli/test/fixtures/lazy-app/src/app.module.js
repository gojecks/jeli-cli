import { RootElement } from './root.element';
jModule({
    selectors: [RootElement],
    rootElement: RootElement
})
export class AppModule {
    constructor() {
        this.load = () => lazyload('./lazy/lazy.module').then(m => m.LazyModule);
    }
}

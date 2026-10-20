import { shared } from './shared';
Element({ selector: 'app-lazy', template: '<p>lazy</p>' })
export class LazyElement { constructor() { this.v = shared(); } }

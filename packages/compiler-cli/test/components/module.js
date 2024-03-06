import { TestClass } from './class';
import { TestSuiteElement } from './elements';
import { TestSuitePipe } from "./pipe";
import { TestBedService } from "./service";

jModule({
    selectors: [
        TestSuiteElement,
        TestClass
    ],
    services: [
        TestBedService,
        TestSuitePipe
    ]
})
export function TestSuiteModule() {

}
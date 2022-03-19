import { RouterModule } from '@jeli/router';

jModule({
    requiredModules: [
        RouterModule
    ]
})
export function [NAME]RouterModule() {
    var routes = [];
    RouterModule.setRoutes(routes);
}
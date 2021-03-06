const { findTokenInGlobalImports } = require('./compilerobject');
const helper = require('@jeli/cli-utils');
/**
 * 
 * @param {*} queryElements
 * @param {*} element 
 */
function _query(queryElements, element) {
    let found = false;
    for (let i = 0; i < queryElements.length; i++) {
        const query = queryElements[i];
        found = (query.name === element.name);
        if (found && query.match && element.attr) {
            let inc = 0;
            for (let k = 0; k < query.match.length; k++) {
                const match = query.match[k];
                let matcher = false;
                if (match.name) {
                    matcher = element.attr.hasOwnProperty(match.name);
                    if (matcher && match.is) {
                        matcher = match.is.includes(element.attr[match.name]);
                    } else if (matcher && match.not) {
                        matcher = !match.not.includes(element.attr[match.name]);
                    }
                } else if (match.any) {
                    matcher = match.any.some(attr => element.attr.hasOwnProperty(attr));
                }

                // increment counter
                if (matcher) {
                    inc++;
                }
            }

            if (inc === query.match.length) {
                return true;
            }
        }

        // force return
        if (found && !query.match) {
            return found;
        }
    }

    return false;
}

/**
 * 
 * @param {*} registeredElement 
 * @param {*} queries 
 * @param {*} selector 
 * @param {*} element 
 * @param {*} moduleList 
 */
function _CoreSelector(registeredElement, queries, selector, element, moduleList) {
    const _runQuery = name => {
        const dir = registeredElement[name];
        /**
         * check first if module matches
         */
        if (!moduleList.includes(dir.module)) {
            return false;
        }

        if (queries.hasOwnProperty(dir.selector) && element) {
            return _query(queries[dir.selector], element);
        }

        if (dir.selector === selector) {
            return true;
        }
    };

    return Object.keys(registeredElement).filter(_runQuery).map(name => {
        return {
            fn: name,
            obj: registeredElement[name]
        };
    });
};

/**
 * 
 * @param {*} compilerObject 
 * @param {*} type 
 * @param {*} selector 
 * @param {*} componentName 
 * @param {*} element 
 */
exports.CoreQuerySelector = (compilerObject, type, selector, componentName, element) => {
    const startModule = compilerObject['Element'][componentName].module;
    const found = [];
    search(compilerObject, startModule);
    if (!element && found.length) {
        return found;
    }

    /**
     * 
     * @param {*} reqModule 
     */
    function search(meta, moduleName) {
        if (!meta || !meta.jModule[moduleName]) return;
        const moduleList = [moduleName].concat(meta.jModule[moduleName].requiredModules || []);
        found.push.apply(found, _CoreSelector(meta[type], meta.queries, selector, element, moduleList));
    }

    /**
     * find in requiredModules
     */
    const parentModule = compilerObject.jModule[startModule];
    const isResolvedModule = [];
    if (parentModule.requiredModules) {
        findInRequiredModules(parentModule.requiredModules);
    }

    function findInRequiredModules(requiredModules) {
        for (const moduleName of requiredModules) {
            /**
             * check if module is registered to the current compiler
             */
            if (isResolvedModule.includes(moduleName)) {
                break;
            }

            if (compilerObject.jModule.hasOwnProperty(moduleName)) {
                const childModule = compilerObject.jModule[moduleName];
                if (childModule.requiredModules && childModule.requiredModules.length)
                    findInRequiredModules(compilerObject.jModule[moduleName].requiredModules);
            } else {
                const libModules = findTokenInGlobalImports(moduleName, compilerObject);
                found.push.apply(found, search(libModules, moduleName));
            }

            isResolvedModule.push(moduleName);
        }
    }

    isResolvedModule.length = 0;

    return found.sort((a, b) => {
        if (a.obj.resolve) {
            return -1;
        }
        if (b.obj.resolve && !a.obj.resolve) {
            return 1;
        }
        // a must be equal to b
        return 0;
    });
}

exports.parseQuery = querySelector => {
    return helper.splitAndTrim(querySelector, ',').map(key => {
        const props = helper.splitAndTrim(key, ':');
        const ret = {
            name: props.shift()
        };

        if (props.length) {
            ret.match = props.map(prop => {
                let matcher;
                const notIsRegExp = /[=!]/;
                const combinationRegExp = /\[(.*?)\]/;
                if (notIsRegExp.test(prop)) {
                    const keyValPair = helper.splitAndTrim(prop, notIsRegExp);
                    matcher = {
                        name: keyValPair.shift()
                    };

                    if (keyValPair.length) {
                        matcher[helper.isContain('!', prop) ? "not" : 'is'] = helper.splitAndTrim(keyValPair.pop(), '|');
                    }
                } else if (combinationRegExp.test(prop)) {
                    matcher = {
                        any: helper.splitAndTrim(prop.match(combinationRegExp)[1], '|')
                    };
                } else {
                    matcher = {
                        name: prop
                    };
                }
                return matcher;
            });
        }

        return ret;
    })
}
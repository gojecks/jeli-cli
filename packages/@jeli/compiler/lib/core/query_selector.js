const { findTokenInGlobalImports } = require('./compilerobject');
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
            let len = query.match.length;
            for (let k = 0; k < len; k++) {
                const match = query.match[k];
                let matcher = element.attr.hasOwnProperty(match.name);
                if (matcher && match.is) {
                    matcher = match.is.includes(element.attr[match.name]);
                } else if (matcher && match.not) {
                    matcher = !match.not.includes(element.attr[match.name]);
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
 */
function _CoreSelector(registeredElement, queries, selector, element) {
    const _runQuery = name => {
        const dir = registeredElement[name];
        if (queries.hasOwnProperty(dir.selector) && element) {
            return _query(queries[dir.selector], element);
        } else if (dir.selector === selector) {
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
function CoreQuerySelector(compilerObject, type, selector, componentName, element) {
    const found = _CoreSelector(compilerObject[type], compilerObject.queries, selector, element);

    if (!element && found.length) {
        return found;
    }

    /**
     * find in requiredModules
     */
    const parentModule = compilerObject.modules[compilerObject['Element'][componentName].module];
    if (parentModule.requiredModules) {
        parentModule.requiredModules.forEach(moduleName => {
            /**
             * check if module is registered to the current compiler
             */
            if (!compilerObject.modules.hasOwnProperty(moduleName)) {
                const libModules = findTokenInGlobalImports(moduleName, compilerObject);
                found.push.apply(found, _CoreSelector(libModules[type], libModules.queries, selector, element));
            }
        });
    }

    return found;
}

module.exports = CoreQuerySelector;
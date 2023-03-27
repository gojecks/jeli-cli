const helper = require('@jeli/cli/lib/utils');
const delimeter = ['${', '}'];
const defaultTemplateExp = new RegExp(escapeRegExp(delimeter[0]) + '([\\s\\S]*?)' + escapeRegExp(delimeter[1]), 'g');;
/**
 * set delimeter
 */
function escapeRegExp(s) {
    return s.replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1');
}
/**
 * 
 * @param {*} delimeter 
 */
exports.getDelimeter = () => defaultTemplateExp;

/**
 * 
 * @param {*} ast 
 */
exports.parser = (ast, pipesProvider) => {
    ast = this.getTemplateKeys(ast);
    var binding = [ast.data];

    if (ast.exprs.length) {
        var once = false;
        binding.push(ast.exprs.map((key, idx) => {
            once = key.charAt(0) === ":";
            if (once) {
                key = key.slice(1);
            }
            return [delimeter.join(idx), exports.removeFilters(key, pipesProvider)];
        }));
        binding.push(once);
    }

    return binding;
}

/**
 * 
 * @param {*} data 
 */
exports.getTemplateKeys = (data) => {
    const exprs = [];
    let idx = 0;
    try {
        data = data.replace(defaultTemplateExp, (match, key) => {
            exprs.push(key);
            return delimeter.join(idx++);
        });
    } catch (e) {
        throw new Error(`unable to parse template ${data}`);
    }

    return {
        data,
        exprs
    };
};



/**
 * remove filters from string
 * @param {*} key 
 */
exports.removeFilters = (key, pipesProvider) => {
    var filter = { prop: "" };
    var hasFilter = helper.removeSingleOperand(key, '[|]', '^', 'g').split('^');
    filter.prop = helper.simpleArgumentParser(hasFilter[0].trim());
    if (hasFilter && hasFilter.length > 1) {
        filter.args = [];
        filter.fns = [];
        //check if filter has additional requirement;
        //useful to extend filter value
        //@sample : dateTime filter
        var AllFilters = hasFilter.slice(1);
        for (var i in AllFilters) {
            pipesProvider(AllFilters[i].trim(), filter);
        }
    }

    return filter;
};

exports.hasTemplateBinding = function(template) {
    return defaultTemplateExp.test(template);
}
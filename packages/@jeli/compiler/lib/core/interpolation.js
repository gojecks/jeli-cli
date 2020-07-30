const helper = require('@jeli/cli-utils');
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
    var binding = {
        rawValue: ast.data
    };

    if (ast.exprs.length) {
        binding.templates = ast.exprs.map((key, idx) => {
            var observe = key.charAt(0) !== ":";
            if (observe) {
                binding.$ = true;
            }
            return [delimeter.join(idx), exports.removeFilters(key, pipesProvider)];
        });
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
    data = data.replace(defaultTemplateExp, (match, key) => {
        exprs.push(key);
        return delimeter.join(idx++);
    });

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
            var hasExpression = AllFilters[i].split(':').map(key => helper.removeSingleQuote(key.trim()));
            const filterName = hasExpression.shift();
            pipesProvider(filterName, filter.fns);
            filter.args.push(hasExpression);
        }
    }

    return filter;
};
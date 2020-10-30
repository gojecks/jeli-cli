const colors = require('colors/safe');
const _clearConsole = require('console-clear');
const readline = require('readline');
const chalk = require('chalk');
const $isBooleanValue = 'true | false | 1 | 0';
const quote = '\'';
let initialMsg = [];
/**
 * 
 * @param {*} str 
 */
exports.removeSingleQuote = (str) => {
    if (this.isContain(str, $isBooleanValue) || typeof str === undefined) return str;

    return String(str).replace(/[']/g, "");
}

/**
 * 
 * @param {*} key 
 * @param {*} model 
 */
function generateArrayKeyType(key, model) {
    if (isContain("[", key)) {
        model = model || {};
        return splitAndTrim(key, '[').map(function(current) {
            if (isContain(']', current)) {
                var _key = current.split(']')[0];
                return ((model.hasOwnProperty(_key)) ? model[_key] : _key);
            }

            return current;
        }).join('.');
    }

    return key
}



//@function simpleBooleanParser
//credit to  CMCDragonkai for the idea
exports.simpleBooleanParser = ($boolValue) => {
    return ({
        'true': true,
        '1': true,
        'on': true,
        'yes': true,
        'false': false,
        '0': false,
        'off': false,
        'no': false,
        'null': null,
        'undefined': undefined
    })[$boolValue];
}

/**
 * 
 * @param {*} expression 
 */
exports.simpleArgumentParser = (expression) => {
    const possibleMatcher = this.simpleBooleanParser(expression),
        isNum = Number(expression);
    if (typeof expression === 'number') {
        return expression;
    } else if (expression && !isNaN(isNum)) {
        return isNum;
    } else if (typeof possibleMatcher !== "undefined") {
        return possibleMatcher;
    } else if (this.isContain(expression.charAt(0), '[{')) {
        try {
            return JSON.parse(expression);
        } catch {
            return expression;
        }
    }

    return expression;
}


exports._eval = (str) => {
    return new Function("try { return " + str + "} catch(e){ return " + str + "};").call(null, {});
}

exports.camelCase = (str) => {
    return str.replace(/-(\w)/g, (_, c) => c ? c.toUpperCase() : '');
}

exports.isContain = (needle, haystack) => {
    return needle && haystack.indexOf(needle) > -1;
}

/**
 * 
 * @param {*} str 
 * @param {*} matcher 
 * @param {*} retemplateOutletHolder 
 * @param {*} flags 
 */
exports.removeSingleOperand = (str, matcher, retemplateOutletHolder, flags) => {
    return str.replace(new RegExp(matcher, flags), function(s, n, t) {
        if ((t.charAt(n + 1) === s && t.charAt(n - 1) !== s) || (t.charAt(n + 1) !== s && t.charAt(n - 1) === s)) {
            return s;
        } else {
            return retemplateOutletHolder;
        }

    });
}

/**
 * 
 * @param {*} str 
 */
exports.$removeWhiteSpace = (str) => {
    str = (str || '')
    if (/["']/g.test(str)) {
        return str
    }
    return str.replace(/\s+/g, '');
}

exports.hexToRgb = (hex) => {
    // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
    var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, function(m, r, g, b) {
        return r + r + g + g + b + b;
    });

    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

exports.rgbToHex = (r, g, b) => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

exports.splitAndTrim = (stack, needle) => stack.split(needle).map(key => key.trim()).filter(needle => needle);

/**
 * 
 * @param {*} prop 
 * @param {*} useName 
 * @param {*} skipQuote 
 */
exports.stringToObjectNameValueMapping = (prop, useName, skipQuote) => {
    const inp = this.splitAndTrim(prop, /=/);
    const nameProp = this.splitAndTrim(inp.shift(), ":");
    const item = {
        name: (nameProp.shift()).replace(/[?#]/g, ''),
    };

    if (this.isContain('?', prop)) {
        item.optional = true;
    }

    if (nameProp.length) {
        item.type = `'${nameProp.pop()}'`;
    }

    if (inp.length || useName) {
        item.value = `${(!skipQuote?"'" : "")}${(inp[0] || item.name)}${(!skipQuote?"'" : "")}`;
    }

    return item;
};


exports.throwError = (msg) => {
    throw new Error(msg);
};

exports.is = (a, b) => a === b;
exports.typeOf = (a, b) => this.is(typeof a, b);
exports.trimPackageName = str => {
    const name = str.replace(/@/, '').replace(/[\/]/g, '-');
    const nameSpace = name.split('-');
    const first = nameSpace.shift();
    return {
        name,
        first,
        arg: nameSpace[nameSpace.length - 1] || first,
        nameSpace: nameSpace.join('/')
    };
};

/**
 * 
 * @param {*} name 
 * @param {*} version 
 */
exports.BuildVersion = (name, version) => {
    var vSplit = version.split('.'),
        matchPhase = { dot: 0, major: 1, minor: 2 };

    for (var n in matchPhase) {
        if (vSplit[matchPhase[n]]) {
            matchPhase[n] = parseInt(vSplit[matchPhase[n]]);
        } else {
            matchPhase[n] = 0;
        }
    }

    matchPhase['name'] = name;

    return matchPhase;
};

exports.clearConsole = async function(msg, scroll) {
    _clearConsole(scroll);
    console.log(initialMsg.join('\n'));
    console.log(msg || '');
};

exports.isNotFoundError = err => err.message.match(/Cannot find module/);
exports.ternary = (a, b, c) => this.is(a, b) ? a : c;

/**
 * 
 * @param {*} content 
 */
exports.stringifyContent = (content) => {
    content = content.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), '\\' + quote);
    content = quote + content.replace(/\n/g, '') + quote;

    return content;
}

exports.abort = _ => {
    console.log(colors.red(_ || '\nPlease fix errors.'));
    process.exit(1);
};

// commander passes the Command object itself as options,
// extract only actual options into a fresh object.
exports.cleanArgs = (cmd) => {
    const args = {}
    cmd.options.forEach(o => {
        const key = exports.camelCase(o.long.replace(/^--/, ''))
            // if an option is not present and Command has a method with the same name
            // it should not be copied
        if (typeof cmd[key] !== 'function' && typeof cmd[key] !== 'undefined') {
            args[key] = cmd[key]
        }
    })
    return args
};

exports.kebabCase = str => {
    return str.split('').map((char, idx) => {
        if (/[A-Z]/.test(char)) {
            return ('-' != str[idx - 1]) ? `-${char.toLowerCase()}` : char.toLowerCase()
        }

        return char;
    }).join('')
};

exports.pascalCase = str => {
    return str.charAt(0).toUpperCase() + this.camelCase(str.substring(1));
};

exports.console = {
    error: msg => console.log(colors.red(msg)),
    warn: msg => console.log(colors.yellow(msg)),
    write: msg => console.log(msg),
    header: msg => console.log(colors.underline(msg)),
    success: msg => console.log(colors.green(msg)),
    setInitial: msg => initialMsg.push(msg),
    clear: exports.clearConsole
};

exports.writeline = text => {
    readline.clearLine(process.stdout);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(text);
};

exports.chalk = chalk;
exports.colors = colors;
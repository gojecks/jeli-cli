// Build-time warnings for template patterns the compiler accepts but turns into wrong output without an error.
// checkTemplate returns [{rule, line, message}]; generator.js prints them with the file path.

const CONTROL_FLOW_NAMES = ['for', 'if', 'else', 'switch', 'case', 'switchDefault'];

function lineAt(source, index) {
    let line = 1;
    for (let i = 0; i < index && i < source.length; i++) {
        if (source[i] === '\n') line++;
    }
    return line;
}

// start tags with their attributes; quoted values may contain '>' and are kept whole
function startTags(source) {
    const tags = [];
    let i = 0;
    while (i < source.length) {
        if (source.startsWith('<!--', i)) {
            const end = source.indexOf('-->', i + 4);
            i = end < 0 ? source.length : end + 3;
            continue;
        }
        const open = /^<([a-zA-Z][\w:-]*)/.exec(source.slice(i, i + 64));
        if (!open) {
            i++;
            continue;
        }
        const tag = { name: open[1].toLowerCase(), index: i, attrs: [] };
        let j = i + open[0].length;
        while (j < source.length && source[j] !== '>') {
            if (/\s|\//.test(source[j])) {
                j++;
                continue;
            }
            const nameStart = j;
            while (j < source.length && !/[\s=>]/.test(source[j]) && !(source[j] === '/' && source[j + 1] === '>')) j++;
            const attr = { name: source.slice(nameStart, j), value: null, index: nameStart };
            while (/\s/.test(source[j] || '')) j++;
            if (source[j] === '=') {
                j++;
                while (/\s/.test(source[j] || '')) j++;
                const quote = source[j];
                if (quote === '"' || quote === "'") {
                    const end = source.indexOf(quote, j + 1);
                    attr.value = source.slice(j + 1, end < 0 ? source.length : end);
                    j = end < 0 ? source.length : end + 1;
                } else {
                    const valueStart = j;
                    while (j < source.length && !/[\s>]/.test(source[j])) j++;
                    attr.value = source.slice(valueStart, j);
                }
            }
            if (attr.name) tag.attrs.push(attr);
        }
        tags.push(tag);
        i = j + 1;
    }
    return tags;
}

function isBinding(name) {
    return /^[:*#@{(\[]/.test(name) || name.startsWith('attr-');
}

function checkTemplate(source) {
    const warnings = [];
    const warn = (rule, index, message) => warnings.push({ rule, line: lineAt(source, index), message });

    for (const tag of startTags(source)) {
        const names = tag.attrs.map(attr => attr.name);

        // a bare {prop} next to a :directive is dropped from the compiled props
        if (names.some(name => /^:[a-zA-Z]/.test(name))) {
            tag.attrs.filter(attr => /^\{[\w$]+\}$/.test(attr.name) && attr.value === null).forEach(attr => {
                const prop = attr.name.slice(1, -1);
                warn('directive-bare-prop', attr.index, `<${tag.name}> has a :directive, so ${attr.name} is dropped - write ${attr.name}="${prop}"`);
            });
        }

        // *for and template= on one <j-fragment> loses the loop variable in the dispatched template
        if (tag.name === 'j-fragment' && names.includes('*for') && names.some(name => name === 'template' || name === '{template}')) {
            warn('for-with-template', tag.index, '*for and template on the same <j-fragment> lose the loop variable - put the template on an inner <j-fragment>');
        }

        // *for locals are evaluated without the component, so method calls give null
        tag.attrs.filter(attr => attr.name === '*for' && attr.value).forEach(attr => {
            attr.value.split(';').slice(1).forEach(local => {
                const match = /^\s*([\w$]+)\s*=\s*(.+)$/.exec(local);
                if (match && /[\w$\]]\s*\(/.test(match[2])) {
                    warn('for-local-call', attr.index, `*for local "${match[1]}=${match[2].trim()}" calls a method and will be null - use a property path`);
                }
            });
        });

        // a static attribute that parses as a JSON object/array becomes an object ([object Object] in the page)
        if (!tag.name.includes('-')) {
            tag.attrs.filter(attr => !isBinding(attr.name) && attr.value && /^\s*[\[{]/.test(attr.value)).forEach(attr => {
                try {
                    const parsed = JSON.parse(attr.value);
                    if (parsed && typeof parsed === 'object') {
                        warn('json-static-attr', attr.index, `${attr.name} on <${tag.name}> is valid JSON and becomes an object - bind the text from the component (attr-${attr.name}="prop")`);
                    }
                } catch (e) { }
            });
        }
    }

    // @for/@if/... not followed by its block are control-flow errors; as text they need &#64;
    const flow = /@([a-zA-Z]+)/g;
    let match;
    while ((match = flow.exec(source))) {
        const name = match[1];
        if (!CONTROL_FLOW_NAMES.includes(name)) continue;
        const rest = source.slice(match.index + match[0].length).replace(/^\s+/, '');
        const ok = name === 'else' ? /^(\{|if\b)/.test(rest) : (name === 'switchDefault' ? rest[0] === '{' : rest[0] === '(');
        if (!ok) warn('literal-control-flow', match.index, `@${name} without its block - to show it as text write &#64;${name}`);
    }

    return warnings;
}

// prints each warning as path:line [rule] message
function report(warnings, filePath) {
    if (!warnings.length) return;
    const helper = require('@jeli/cli/lib/utils');
    warnings.forEach(item => helper.console.warn(`${filePath}:${item.line} [${item.rule}] ${item.message}`));
}

module.exports = { checkTemplate, startTags, report };

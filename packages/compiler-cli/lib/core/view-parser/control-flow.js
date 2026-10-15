/**
 * Preprocessor for the `@if(...) { }` / `@for(...) { }` / `@switch(...) { @case(...) { } @switchDefault { } }`
 * block syntax, including `@else` / `@else if(...)` chains. Runs on the raw template string before
 * HTML tokenization and rewrites each block into the equivalent, already-supported attribute-directive
 * syntax wrapped in a `<j-fragment>` - `*if`, `*for`, `{:switch}`, `*switchCase`, `*switchDefault` - so
 * the rest of the compiler pipeline (attributeParser, parseStructuralDirective, etc.) handles it
 * completely unchanged.
 *
 * `@else` reuses the framework's existing `*if="cond; else as refName"` + `<j-template #refName>`
 * mechanism (already used in hand-written templates), rather than inventing a new one.
 *
 * Malformed blocks (unclosed parens/braces, missing conditions, `@case`/`@switchDefault` outside a
 * `@switch`, orphaned `@else`, `@for` without a recognizable "item of/in list" clause) are reported via
 * `errorLogs` and left untransformed - same degrade-gracefully-and-report pattern the rest of the
 * parser uses (see `parseStructuralDirective`'s `restrictedCombination` check).
 */
const CONTROL_FLOW_DIRECTIVES = {
    for: { attr: '*for' },
    switch: { attr: '{:switch}' },
    case: { attr: '*switchCase' },
    switchDefault: { attr: '*switchDefault', ignoreArgs: true }
};

// matches what parseStructuralDirective/astStringParser actually requires downstream to produce
// forOf/forIn - a single word surrounded by whitespace (`item of items`, `item in items`, ...).
const FOR_LOOP_PATTERN = /\s+\w+\s/;

function skipWhitespace(source, idx) {
    while (idx < source.length && /\s/.test(source[idx])) idx++;
    return idx;
}

// like skipWhitespace, but also hops over `<!-- ... -->` comments - lets authors annotate
// each branch of an @if/@else-if/@else chain without breaking the chain lookahead below.
function skipWhitespaceAndComments(source, idx) {
    let prev;
    do {
        prev = idx;
        idx = skipWhitespace(source, idx);
        if (source.startsWith('<!--', idx)) {
            const end = source.indexOf('-->', idx);
            idx = end === -1 ? source.length : end + 3;
        }
    } while (idx !== prev);
    return idx;
}

/**
 * @param {string} source
 * @param {number} startIdx index of the opening char
 * @param {string} openChar
 * @param {string} closeChar
 * @returns {number} index of the matching closing char, or -1
 */
function findBalancedEnd(source, startIdx, openChar, closeChar) {
    let depth = 0;
    for (let i = startIdx; i < source.length; i++) {
        if (source[i] === openChar) depth++;
        else if (source[i] === closeChar) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function scanTagEnd(source, from) {
    let quote = null;
    let i = from;
    while (i < source.length) {
        const c = source[i];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '>') {
            return { end: i + 1, selfClosing: source[i - 1] === '/' };
        }
        i++;
    }
    return null;
}

function findElementExtent(source, idx) {
    const tagNameMatch = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(source.slice(idx));
    if (!tagNameMatch) return null;
    const tagName = tagNameMatch[1];
    const tagNameEnd = idx + 1 + tagName.length;

    const openTag = scanTagEnd(source, tagNameEnd);
    if (!openTag) return null;
    if (openTag.selfClosing || VOID_ELEMENTS.has(tagName.toLowerCase())) {
        return { tagName, tagNameEnd, openTagEnd: openTag.end, contentEnd: openTag.end };
    }

    let depth = 1;
    let i = openTag.end;
    while (i < source.length && depth > 0) {
        if (source[i] === '<') {
            if (source.startsWith('<!--', i)) {
                const end = source.indexOf('-->', i);
                i = end === -1 ? source.length : end + 3;
                continue;
            }
            const closeMatch = /^<\/[a-zA-Z][a-zA-Z0-9:-]*\s*>/.exec(source.slice(i));
            if (closeMatch) {
                depth--;
                i += closeMatch[0].length;
                continue;
            }
            const openMatch = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(source.slice(i));
            if (openMatch) {
                const inner = scanTagEnd(source, i + 1 + openMatch[1].length);
                if (!inner) return null;
                i = inner.end;
                if (!inner.selfClosing && !VOID_ELEMENTS.has(openMatch[1].toLowerCase())) depth++;
                continue;
            }
        }
        i++;
    }
    if (depth !== 0) return null;
    return { tagName, tagNameEnd, openTagEnd: openTag.end, contentEnd: i };
}

function attachForToSingleElement(trimmedBody, attrString) {
    if (!trimmedBody.startsWith('<') || trimmedBody.startsWith('<!--')) return null;
    const extent = findElementExtent(trimmedBody, 0);
    if (!extent || extent.contentEnd !== trimmedBody.length) return null;
    if (extent.tagName === 'j-fragment') return null;

    return trimmedBody.slice(0, extent.tagNameEnd) + ' ' + attrString + trimmedBody.slice(extent.tagNameEnd);
}

function quoteAttrValue(value) {
    if (!value.includes('"')) return `"${value}"`;
    if (!value.includes("'")) return `'${value}'`;
    return `"${value.replace(/"/g, '&quot;')}"`;
}

function reportError(state, message) {
    state.errorLogs.push(message);
}

/**
 * Reads an optional `(args)` group starting at idx (whitespace before it is skipped).
 * @returns {{args: string, next: number} | null} null only when a `(` was opened but never closed
 */
function readArgs(source, idx) {
    idx = skipWhitespace(source, idx);
    if (source[idx] !== '(') return { args: '', next: idx };
    const closeIdx = findBalancedEnd(source, idx, '(', ')');
    if (closeIdx === -1) return null;
    return { args: source.slice(idx + 1, closeIdx), next: closeIdx + 1 };
}

/**
 * Reads a required `{ body }` group starting at idx (whitespace before it is skipped).
 * @returns {{body: string, next: number} | null}
 */
function readBody(source, idx) {
    idx = skipWhitespace(source, idx);
    if (source[idx] !== '{') return null;
    const closeIdx = findBalancedEnd(source, idx, '{', '}');
    if (closeIdx === -1) return null;
    return { body: source.slice(idx + 1, closeIdx), next: closeIdx + 1 };
}

/**
 * Parses an `if(...) { ... }` construct starting right after the "if" keyword (works for both the
 * top-level `@if` and a chained `@else if`), including any trailing `@else` / `@else if` chain.
 * @param {string} source
 * @param {number} ifKeywordEnd index right after the "if" keyword
 * @param {{refIndex: number, errorLogs: string[]}} state
 * @param {string} label `@if` or `@else if`, for error messages
 * @returns {{html: string, next: number} | null}
 */
function parseIfChain(source, ifKeywordEnd, state, label) {
    const argsResult = readArgs(source, ifKeywordEnd);
    if (!argsResult) {
        reportError(state, `[${label}] missing closing ')' for condition`);
        return null;
    }
    if (!argsResult.args.trim()) {
        reportError(state, `[${label}] requires a condition, e.g. ${label}(expression) { ... }`);
        return null;
    }
    const bodyResult = readBody(source, argsResult.next);
    if (!bodyResult) {
        reportError(state, `[${label}] missing '{ ... }' block body`);
        return null;
    }

    const condition = argsResult.args.trim();
    const body = transform(bodyResult.body, state, false);
    let next = bodyResult.next;

    let elseHtml = null;
    const afterBody = skipWhitespaceAndComments(source, next);
    if (source.startsWith('@else', afterBody)) {
        const afterElse = skipWhitespace(source, afterBody + '@else'.length);
        if (source.startsWith('if', afterElse) && /[\s(]/.test(source[afterElse + 2] || '')) {
            // @else if(...) { ... } - recurse, treating it as a nested if-chain
            const nested = parseIfChain(source, afterElse + 2, state, '@else if');
            if (nested) {
                elseHtml = nested.html;
                next = nested.next;
            } else {
                // parseIfChain already reported the specific error; consume through the "@else if"
                // keyword so the main loop doesn't re-scan and re-report this same "@else" as orphaned
                next = afterElse + 2;
            }
        } else {
            const elseBody = readBody(source, afterElse);
            if (!elseBody) {
                reportError(state, `[@else] missing '{ ... }' block body`);
                next = afterElse; // consume through the "@else" keyword itself, same reasoning as above
            } else {
                elseHtml = transform(elseBody.body, state, false);
                next = elseBody.next;
            }
        }
    }

    let html;
    if (elseHtml !== null) {
        const ref = `__jeliElse${state.refIndex++}`;
        const attrValue = `${condition}; else as ${ref}`;
        html = `<j-fragment *if=${quoteAttrValue(attrValue)}>${body}</j-fragment><j-template #${ref}>${elseHtml}</j-template>`;
    } else {
        html = `<j-fragment *if=${quoteAttrValue(condition)}>${body}</j-fragment>`;
    }

    return { html, next };
}

function parseSimpleBlock(source, atIdx, name, directive, state, insideSwitchBody) {
    const label = `@${name}`;
    if ((name === 'case' || name === 'switchDefault') && !insideSwitchBody) {
        reportError(state, `[${label}] must be used directly inside a @switch(...) { } block`);
        return null;
    }

    let cursor = atIdx + 1 + name.length; // skip "@name"
    const argsResult = readArgs(source, cursor);
    if (!argsResult) {
        reportError(state, `[${label}] missing closing ')' for arguments`);
        return null;
    }
    if (!directive.ignoreArgs && !argsResult.args.trim()) {
        reportError(state, `[${label}] requires an expression, e.g. ${label}(expression) { ... }`);
        return null;
    }
    if (name === 'for' && !FOR_LOOP_PATTERN.test(argsResult.args)) {
        reportError(state, `[${label}] expected syntax: @for(item of items) { ... } or @for(item in items) { ... }`);
        return null;
    }

    const bodyResult = readBody(source, argsResult.next);
    if (!bodyResult) {
        reportError(state, `[${label}] missing '{ ... }' block body`);
        return null;
    }

    const body = transform(bodyResult.body, state, name === 'switch');
    const attrString = directive.ignoreArgs
        ? directive.attr
        : `${directive.attr}=${quoteAttrValue(argsResult.args.trim())}`;

    if (name === 'for') {
        const singleElement = attachForToSingleElement(body.trim(), attrString);
        if (singleElement) return { html: singleElement, next: bodyResult.next };
    }

    return { html: `<j-fragment ${attrString}>${body}</j-fragment>`, next: bodyResult.next };
}

const NAME_PATTERN = /^@([a-zA-Z]+)/;

function transform(source, state, insideSwitchBody) {
    let output = '';
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (ch === '@') {
            const nameMatch = NAME_PATTERN.exec(source.slice(i));
            const name = nameMatch && nameMatch[1];
            if (name === 'if') {
                const parsed = parseIfChain(source, i + 1 + name.length, state, '@if');
                if (parsed) {
                    output += parsed.html;
                    i = parsed.next;
                    continue;
                }
            } else if (name === 'else') {
                reportError(state, `[@else] must immediately follow an @if or @else-if block`);
            } else if (name && CONTROL_FLOW_DIRECTIVES.hasOwnProperty(name)) {
                const block = parseSimpleBlock(source, i, name, CONTROL_FLOW_DIRECTIVES[name], state, insideSwitchBody);
                if (block) {
                    output += block.html;
                    i = block.next;
                    continue;
                }
            }
        }
        output += ch;
        i++;
    }
    return output;
}

/**
 * @param {string} source raw template HTML
 * @param {string[]} [errorLogs] collects human-readable diagnostics for malformed blocks; the block
 * is left untransformed (and will most likely surface a second, less clear error further down the
 * pipeline) whenever this happens
 * @returns {string} template HTML with control-flow blocks rewritten to attribute-directive syntax
 */
function transformControlFlowBlocks(source, errorLogs) {
    return transform(source, { refIndex: 0, errorLogs: errorLogs || [] }, false);
}

exports.transformControlFlowBlocks = transformControlFlowBlocks;

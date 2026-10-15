
const BaseViewParser = require('./base.parser');
const helper = require('@jeli/cli/lib/utils');
class ViewParser extends BaseViewParser {
    /**
     * 
     * @param {*} htmlContent 
     * @param {*} fileChanges 
     * @param {*} ctor 
     * @param {*} componentClassName 
     * @returns 
     */
    static parse(htmlContent, fileChanges, ctor, componentClassName) {
        // removed resolved elements from cache if exists
        this.cleanup(ctor.selector, fileChanges);
        const output = this.createOutputContext(componentClassName, ctor);
        this.htmlParser(htmlContent, output, true);
        // set annotation
        if (!output.errorLogs.length) {
            this.resolvePendingElements(ctor.selector);
        }

        // remove unwanted properties
        delete output.componentClassName;
        delete output.ctor;

        return output;
    }

    /**
     * 
     * @param {*} htmlContent 
     * @param {*} output 
     * @param {*} ignoreClosingTag 
     * @returns 
     */
    static htmlParser(htmlContent, output, ignoreClosingTag = true) {
        const ignoreCompilationType = 'ignoreCompilation';
        let openedBraces = 0;
        let openParenteses = 0;
        let openedTag = 0;
        let pendingOpenBrace = 0;
        let elementEntry = null;
        let elementParent = null;
        let currentToken = '';
        let state = 'text'; // default
        let currentAttrName = '';
        let line = 0;
        const ignoreCompilation = false;
        // push errors
        const assertError = error => output.errorLogs.push(error);

        const utils = {
            openTag: nextState => {
                const tag = currentToken;
                const isIgnoreTag = tag == ignoreCompilationType;
                if (openedTag && !isIgnoreTag){
                    elementParent = elementEntry;
                }

                openedTag++;
                if(isIgnoreTag){
                    ignoreCompilation = true;
                } else {
                    elementEntry = {
                        type: 1,
                        children: [],
                        tag,
                        name: this.isFragmentElement(tag) ? "#" : tag,
                        isc: this.isComponent(tag),
                        elementParent,
                        line
                    };
                }

                utils.setNextState(nextState);
            },
            setAttrName: (nextState, noValue) => {
                currentAttrName = currentToken.trim();
                currentToken = '';
                if (currentAttrName && noValue)
                    utils.setAttrValue(nextState)
                else 
                    utils.setNextState(nextState);
            },
            setAttrValue: (nextState) => {
                this.attributeParser(currentAttrName, currentToken, elementEntry, ignoreCompilation, output);
                currentAttrName = '';
                utils.setNextState(nextState);
            },
            addText: nextState => {
                if (currentToken.trim().length > 0) {
                    // push text to entryElement
                    elementEntry.children.push(
                        this.astTextParser(currentToken.trim(), false, ignoreCompilation, output)
                    );
                }

                utils.setNextState(nextState);
            },
            collectComments: (nextState) => {
                // record all comments
                utils.setNextState(nextState);
            },
            setNextState: nextState => {
                currentToken = '';
                state = nextState;
            },
            open: () => {
                openedBraces++;
                pendingOpenBrace--;
            },
            closeTag: nextState => {
                openedTag--;

                utils.addText(nextState);
                // add text if pending
                const newAst = utils.finalizeParsing();
                if (!openedTag) {
                    if (newAst) {
                        newAst.index = output.parsedContent.length;
                        output.parsedContent.push(newAst);
                    }
                } else {
                    delete elementEntry.elementParent;
                    if (elementParent.isc && !ignoreCompilation) {
                        this.attachContentChildren(elementParent, newAst, output);
                    } else {
                        if (newAst) {
                            newAst.index = output.parsedContent.length;
                            elementParent.children.push(newAst);
                        }
                        
                        elementEntry = elementParent;
                        elementParent = elementEntry.elementParent;
                    }
                }

                // reset ignoreCompilation flag
                if(ignoreCompilation && ignoreCompilation == (openedTag + 1))
                    ignoreCompilation = 0;

                utils.setNextState(nextState);
            },
            annotationCondition: nextState => {
                elementEntry.expr = currentToken;
                utils.setNextState(nextState);
            },
            processAttrValue: type => char => {
                if (char == type) {
                    // set the attr value to found attrName
                    utils.setAttrValue('attrName');
                } else {
                    currentToken += char;
                }
            },
            finalizeParsing:() => {
                if(!ignoreCompilation){
                    if (elementEntry.isc) this._validateCustomElementAndThrowError(elementEntry, output);
                    this.attachViewChildToAst(elementEntry, output);
                    // compiledBindings: see the matching call/comment in v1.js
                    this.compileEventAssignments(elementEntry, output);
                    if (elementEntry.structuralDirective) {
                        // remove the directives prop
                        if (helper.is(elementEntry.tag, 'j-place')) {
                            this.jPlaceCompiler(elementEntry, elementParent, output);
                        }
    
                        return this.buildStructuralDirectiveTemplates(elementEntry, output);
                    }
    
                    return this.checkAndBuildTemplateElement(elementEntry, elementParent, output);
                }

                return elementEntry;
            }
        };

        const tokenizerStates = {
            text: char => {
                if (char == '<' || char == '@') {
                    utils.addText((char == '@') ? 'annotation' : 'tagStart');
                } else if (char == '$') {
                    state = 'templateBinding';
                } else if (char == '}' && openedBraces) { // annotation closed
                    openedBraces--;
                    utils.closeTag('text');
                } else {
                    currentToken += char == '\n' ? '' : char;
                }
            },
            tagStart: char => {
                if (char == '/') { //closing tag
                    state = 'tagEnd';
                } else if (char == '!') { // collect comments
                    if (content.substring(1, i + 3) == '!--') {
                        state = 'comment';
                        i += 2;
                    } else {
                        state = 'tagName';
                    }

                } else if (char == '>') {
                    // malformed tag opening
                    state = 'text';
                } else {
                    currentToken += char;
                    state = 'tagName';
                }
            },
            tagEnd: char => {
                if (char == '>') {
                    utils.closeTag('text');
                }
            },
            tagName: char => {
                if (char == '>') {
                    // set the entryElement tagName
                    utils.openTag('text');
                } else if (char == ' ' || char == '\t' || char == '\n') {
                    // set the entryElement tagName
                    utils.openTag('attrName');
                } else {
                    currentToken += char;
                }
            },
            attrName: char => {
                if (char == '=') {
                    // collect elementEntry attrName
                    utils.setAttrName('attrValue');
                } else if (char == '>') {
                    if (currentToken.length > 0) {
                        if (currentToken.trim() == '/') {
                            utils.closeTag();
                        } else {
                            // collect elementEntry attrName
                            // no value defined
                            utils.setAttrName('', true);
                        }
                    }
                    // register tag closed
                    state = 'text';
                } else if (char == ' ' || char == '\t' || char == '\n') {
                    // set the entryElement tagName
                    utils.setAttrName('attrName');
                } else {
                    currentToken += char;
                }
            },
            attrValue: char => {
                if (char == '"') {
                    state = 'attrValueDQ';
                } else if (char == "'") {
                    state = 'attrValueSQ'
                } else {
                    currentToken += char;
                    state = 'attrValueNQ';
                }
            },
            attrValueDQ: utils.processAttrValue('"'),
            attrValueSQ: utils.processAttrValue("'"),
            attrValueNQ: char => {
                if ([' ', '\t', '\n', '>'].includes(char)) {
                    // set the attr value to found attrName
                    utils.setAttrValue((char == '>') ? 'text' : 'attrName');
                } else {
                    currentToken += char;
                }
            },
            comment: char => {
                if (content.substring(i, i + 3) == '-->') {
                    // found comment and record it
                    utils.collectComments('text');
                    i += 2;
                } else {
                    currentToken += char;
                }
            },
            annotation: char => {
                if (char == '(') {
                    if (openParenteses) {
                        currentToken += char;
                    } else {
                        utils.openTag('annotation');
                    }
                    openParenteses++;
                } else if (char == ')') {
                    openParenteses--;
                    if (openParenteses) {
                        currentToken += char;
                    }
                } else if (char == '{') {
                    openedBraces++;
                    if (!openParenteses) {
                        utils.annotationCondition('text');
                    } else {
                        assertError(`invalid annotation on line ${helper.colors.yellow(elementEntry.line)}`);
                    }
                } else {
                    if (!openParenteses && /\w/.test(char)) {
                        assertError(`Missing opening curly brace { for ${helper.colors.yellow(elementEntry.tag)} on line ${helper.colors.yellow(elementEntry.line)}`);
                    }
                    currentToken += char == '\n' ? '' : char;
                }
            },
            templateBinding: char => {
                currentToken += char;
                if (char == '}') {
                    // parse the template value
                    state = 'text';
                }
            }
        };

        for (let i = 0; i < htmlContent.length; i++) {
            const char = htmlContent[i];
            if (char == '\n') line++;
            tokenizerStates[state](char);
        }

        if (currentToken.length && state == 'text') {
            // register text to last entryElement
            utils.addText('');
        }

        // check element closing node was 
        if (openedTag) {
            // we have element that didn't close tag
            if (!ignoreClosingTag) {
                assertError(`Failed to close tag for element ${helper.colors.white(elementEntry.tag)} at line: ${helper.colors.yellow(elementEntry.line)}`)
            } else {
                utils.closeTag();
            }
        }
    }

    static extractAnnotations(htmlContent, errorLogs) {
        const contents = htmlContent.split('\n').map(n => n.trim());
        const output = {
            annotations: [],
            content: []
        };

        let openedBraces = 0;
        let openedTag = 0;
        let pendingOpenBrace = 0;
        let entry = null;
        let elementEntry = null;
        let elementParent = null;
        let parent = null;

        const braces = {
            open: () => {
                openedBraces++;
                pendingOpenBrace--;
            },
            close: line => {
                openedBraces--;
                entry.line.end = line;
                if (!openedBraces) {
                    delete entry.parent;
                    output.annotations.push(entry);
                    output.content.push(`<annot id=${output.annotations.length - 1}></annot>`);
                    entry = null;
                } else {
                    delete entry.parent;
                    parent.contents.push(entry);
                    entry = parent;
                    parent = parent.parent;
                }
            }
        };
        for (let line = 0; line < contents.length; line++) {
            const str = contents[line];
            for (let x = 0; x < str.length; x++) {
                const node = str[x];
                // opening tag of an element
                if (node == '<' && /w/.test(str[x + 1])) {
                    openedTag++;
                    let text = '';
                    let start = true;
                    let pav = null; //pending attribute value
                    elementEntry = {
                        tag: '',
                        attrs: {},
                        children: [],
                        elementParent
                    };
                    //collect tagName
                    while (start) {
                        const nextNode = str[x++];
                        // found closing tag
                        const isClosingWithoutContent = (nextNode == '/' && str[x + 1] == '>');
                        if (isClosingWithoutContent || (nextNode == '>' && !pav)) {
                            if (isClosingWithoutContent) {
                                openedTag--;
                                str++;
                            }

                            start = false;
                            if (openedTag) {
                                delete elementEntry.elementParent;
                                elementParent.children.push(elementEntry);
                                elementEntry = elementParent;
                                elementParent = elementEntry.elementParent;
                            } else {
                                output.content.push(elementEntry);
                            }
                        }

                        if (!/\s/.test(nextNode)) {
                            // match attr
                            if (elementEntry.tag && nextNode == '=') {
                                elementEntry.attrs[text] = null;
                                pav = text;
                                text = '';
                                continue;
                            }

                            text += nextNode;
                        } else {
                            if (!elementEntry.tag) {
                                elementEntry.tag = text;
                                text = '';
                            } else if (pav) {
                                elementEntry.attrs[pav] = text;
                                text = '';
                                pav = null;
                            } else {
                                elementEntry.attrs[text] = null;
                                text = '';
                            }
                        }
                    }
                }
            }

            const match = /^@([if|for|defer|switch|case|caseDefault]+)(\s|)\(+(.*?)\)/g.exec(str)
            if (match) {
                if (entry) {
                    if (!openedBraces) {
                        errorLogs.push(`Missing opening brace { for ${helper.colors.yellow(contents[entry.line.start])} on line ${helper.colors.yellow(entry.line.start)}`);
                        break;
                    }
                    // set parent
                    parent = entry;
                }

                entry = {
                    name: match[1],
                    line: {
                        start: line,
                        end: 0
                    },
                    parent,
                    expr: match[2],
                    contents: []
                };
                pendingOpenBrace++;
            } else if (str == '{') {
                braces.open();
            } else if (str == '}') {
                braces.close(line);
            } else if (str) {
                let textContent = '';
                let curlyBraceFound = 0;
                /**
                * check for possible nodes match
                * opening and closing of function
                */
                try {
                    for (let x = 0; x < str.length; x++) {
                        const node = str[x];
                        if (node == '{') {
                            if (pendingOpenBrace)
                                braces.open();
                            else {
                                curlyBraceFound++;
                                textContent += node;
                            }
                        } else if (node == '}') {
                            if (!curlyBraceFound) {
                                if (textContent) {
                                    entry.contents.push(textContent);
                                    textContent = '';
                                }
                                braces.close(line);
                            } else {
                                curlyBraceFound--;
                                textContent += node;
                            }
                        } else {
                            textContent += node
                        }
                    }

                    if (textContent) {
                        if (openedBraces)
                            entry.contents.push(textContent);
                        else
                            output.content.push(textContent);
                    }
                } catch (e) {
                    errorLogs.push(`Parsing failed for string: ${helper.colors.yellow(str)} on line ${helper.colors.yellow(line)} previous ${helper.colors.yellow(contents[line - 1])}`)
                    errorLogs.push(helper.colors.red(e.message));
                }
            }
        }

        return output;
    }
}

module.exports = ViewParser;
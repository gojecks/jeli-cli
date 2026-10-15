// jeli component source uses call-before-class annotations (Element/Directive/...)
// that only the jeli compiler understands; when jest loads raw source directly
// these calls need to exist as no-op globals so the file doesn't throw.
globalThis.Element = function () {};
globalThis.Directive = function () {};
globalThis.Service = function () {};
globalThis.Provider = function () {};
globalThis.Pipe = function () {};
globalThis.jModule = function () {};

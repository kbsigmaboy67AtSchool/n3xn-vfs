/**
 * n3xn custom Monaco Monarch language definitions
 * Edit this file at the site root — loaded on Monaco init.
 *
 * Supported export modes:
 * - ESM import: import languages from './n3xn-lang-highlights.js'
 * - Browser <script>: window.__n3xnLangHighlights
 */

// ---------------------------------------------------------------------------
// 1. Brainfuck
// ---------------------------------------------------------------------------
const brainfuckTokens = {
  defaultToken: "",
  tokenizer: {
    root: [
      [/[+-]/, "keyword.operator"],
      [/[<>]/, "type.identifier"],
      [/[.,]/, "string"],
      [/[\[\]]/, "delimiter.bracket"],
      [/[^+\-<>.,\[\]]+/, "comment"],
    ],
  },
};

// ---------------------------------------------------------------------------
// 2. nmath (English Math)
// ---------------------------------------------------------------------------
const nmathTokens = {
  defaultToken: "",
  ignoreCase: true,
  keywords: ["let", "set", "const", "print", "show", "say", "what", "is", "equals"],
  constants: ["pi", "e", "tau", "phi", "infinity"],
  functions: [
    "sqrt", "cbrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan",
    "ln", "log10", "log", "sum", "product", "avg", "mean", "min", "max",
    "floor", "ceil", "round", "factorial", "deg", "rad"
  ],
  numberWords: [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
    "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion", "and"
  ],
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/\/\/.*$/, "comment"],
      [
        /\b(square root of|cube root of|sqrt of|to the power of|raised to|multiplied by|divided by|factorial of|absolute value of|sine of|cosine of|tangent of|arcsin of|arccos of|arctan of|natural log of|log base 10 of|log of|the sum of|sum of|product of|average of|mean of|minimum of|maximum of|percent of)\b/,
        "keyword.operator"
      ],
      [/\b(plus|minus|times|over|modulo|mod|squared|cubed|through|until|degrees?)\b/, "keyword.operator"],
      [
        /[a-zA-Z_][a-zA-Z0-9_]*/,
        {
          cases: {
            "@keywords": "keyword",
            "@constants": "constant",
            "@functions": "predefined",
            "@numberWords": "number",
            "@default": "identifier"
          }
        }
      ],
      [/\d+(\.\d+)?/, "number"],
      [/[=+\-*/%^]+/, "operator"],
      [/[()?,]/, "delimiter"],
      [/\s+/, "white"],
    ],
  },
};

// ---------------------------------------------------------------------------
// 3. nexc (N3XN Exec Script)
// ---------------------------------------------------------------------------
const nexcTokens = {
  defaultToken: "",
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/\b(run|cmd|schedule|parallel|module|import|export|when|if|else|then|end|true|false)\b/, "keyword"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/'([^'\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string_double"],
      [/'/, "string", "@string_single"],
      [/\d+(\.\d+)?/, "number"],
      [/[{}()\[\]]/, "@brackets"],
      [/[;=]/, "delimiter"],
      [/[a-zA-Z_][\w\-]*/, "identifier"],
      [/\s+/, "white"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
    string_double: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],
    string_single: [
      [/[^\\']+/, "string"],
      [/\\./, "string.escape"],
      [/'/, "string", "@pop"],
    ],
  },
};

/** @type {Array<{ id: string, extensions: string[], aliases?: string[], tokens: object, conf?: object }>} */
const languages = [
  {
    id: "brainfuck",
    extensions: [".b", ".bf"],
    aliases: ["Brainfuck", "BF"],
    tokens: brainfuckTokens,
    conf: {
      brackets: [["[", "]"]],
      autoClosingPairs: [{ open: "[", close: "]" }],
    },
  },
  {
    id: "nmath",
    extensions: [".nmath"],
    aliases: ["NMath", "English Math"],
    tokens: nmathTokens,
    conf: {
      comments: { lineComment: "#" },
      brackets: [
        ["(", ")"],
        ["[", "]"],
      ],
      autoClosingPairs: [
        { open: "(", close: ")" },
        { open: "[", close: "]" },
        { open: '"', close: '"' },
      ],
    },
  },
  {
    id: "nexc",
    extensions: [".nexc"],
    aliases: ["N3XN Exec"],
    tokens: nexcTokens,
    conf: {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    },
  },
];

// ESM Export
export default languages;
export { languages };

// Classic Script Fallback
if (typeof window !== "undefined") {
  window.__n3xnLangHighlights = languages;
}

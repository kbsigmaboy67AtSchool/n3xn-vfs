/**
 * n3xn custom Monaco Monarch language definitions
 * Edit this file at the site root — loaded on Monaco init.
 *
 * Supported export modes:
 * - ESM import: import languages, registerMinecraftColorPicker from './n3xn-lang-highlights.js'
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

// ---------------------------------------------------------------------------
// 4. MCSN (Minecraft Compact Structure Notation)
// ---------------------------------------------------------------------------
const mcsnTokens = {
  defaultToken: "",
  ignoreCase: false,
  keywords: ["B", "F", "E", "td", "int", "as", "cb", "true", "false"],
  macros: ["t", "c", "bg", "bb", "fn", "tg", "w", "h", "cmd"],
  colors: [
    "black", "dark_blue", "dark_green", "dark_aqua", "dark_red",
    "dark_purple", "gold", "gray", "dark_gray", "blue", "green",
    "aqua", "red", "light_purple", "yellow", "white"
  ],
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/\/\/.*$/, "comment"],
      [/\|/, "keyword.operator"],
      [/F\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)/, "keyword.directive"],
      [/([@+^])(-?\d*(?:\.\d+)?),(-?\d*(?:\.\d+)?),(-?\d*(?:\.\d+)?)/, "number.coordinate"],
      [/\b[BE]:/, "keyword.type"],
      [/\b(td|int|as|cb)\b/, "type.identifier"],
      [/\b(t|c|bg|bb|fn|tg|w|h|cmd):/, "keyword.macro"],
      [/\b(black|dark_blue|dark_green|dark_aqua|dark_red|dark_purple|gold|gray|dark_gray|blue|green|aqua|red|light_purple|yellow|white)\b/, "constant.color"],
      [/[a-zA-Z_][a-zA-Z0-9_:]*/, {
        cases: {
          "@keywords": "keyword",
          "@default": "identifier"
        }
      }],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/'([^'\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string_double"],
      [/'/, "string", "@string_single"],
      [/-?\d+(\.\d+)?/, "number"],
      [/[{}()\[\]]/, "@brackets"],
      [/[:=,]/, "delimiter"],
      [/\s+/, "white"]
    ],
    string_double: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"]
    ],
    string_single: [
      [/[^\\']+/, "string"],
      [/\\./, "string.escape"],
      [/'/, "string", "@pop"]
    ]
  }
};

// ---------------------------------------------------------------------------
// 5. Minecraft 1.20.6 / EaglerXcraft Command Language (.mcfunction, .minecraft)
// ---------------------------------------------------------------------------
const mcfunctionTokens = {
  defaultToken: "",
  ignoreCase: false,
  commands: [
    "advancement", "attribute", "ban", "ban-ip", "banlist", "bossbar", "clear",
    "clone", "damage", "data", "datapack", "debug", "defaultgamemode", "deop",
    "difficulty", "effect", "enchant", "execute", "experience", "fill", "fillbiome",
    "forceload", "function", "gamemode", "gamerule", "give", "help", "item", "kick",
    "kill", "list", "locate", "loot", "me", "msg", "op", "pardon", "pardon-ip",
    "particle", "place", "playsound", "recipe", "reload", "return", "ride", "say",
    "schedule", "scoreboard", "seed", "setblock", "setidletimeout", "setworldspawn",
    "spawnpoint", "spectate", "spreadplayers", "stop", "stopsound", "summon",
    "tag", "team", "teammsg", "teleport", "tell", "tellraw", "time", "title",
    "tm", "tp", "trigger", "w", "weather", "whitelist", "worldborder", "xp"
  ],
  executeKeywords: [
    "as", "at", "positioned", "rotated", "facing", "align", "anchored", "in",
    "summon", "dimension", "if", "unless", "store", "run", "entity", "block",
    "blocks", "score", "matches", "predicate", "loaded", "result", "success"
  ],
  selectors: ["@p", "@a", "@r", "@e", "@s", "@n", "@v"],
  selectorArgs: [
    "advancements", "distance", "dx", "dy", "dz", "gamemode", "level", "limit",
    "name", "nbt", "predicate", "scores", "sort", "tag", "team", "type",
    "x", "x_rotation", "y", "y_rotation", "z"
  ],
  jsonColors: [
    "black", "dark_blue", "dark_green", "dark_aqua", "dark_red", "dark_purple",
    "gold", "gray", "dark_gray", "blue", "green", "aqua", "red", "light_purple",
    "yellow", "white", "reset"
  ],
  tokenizer: {
    root: [
      // Line Comments
      [/#.*$/, "comment"],

      // Relative & Caret Coordinates (~ ~1 ~ / ^ ^ ^2)
      [/([~^])-?\d*(\.\d+)?/, "number.coordinate"],

      // Entity Selectors (@a, @p, @e[type=zombie])
      [/@[parse]/, "keyword.selector"],

      // Double-escaped newline in JSON string blocks
      [/\\\\n/, "string.escape"],

      // Target Selector Arguments inside [...]
      [/\b(type|tag|scores|team|name|distance|x|y|z|dx|dy|dz|x_rotation|y_rotation|limit|sort|gamemode|level|advancements|nbt)=/, "keyword.selector.arg"],

      // Execute Chain Modifiers
      [/\b(as|at|positioned|rotated|facing|align|anchored|in|dimension|if|unless|store|run|entity|block|blocks|score|matches|predicate|loaded|result|success)\b/, {
        cases: {
          "@executeKeywords": "keyword.directive",
          "@default": "identifier"
        }
      }],

      // Minecraft Colors in JSON/NBT
      [/\b(black|dark_blue|dark_green|dark_aqua|dark_red|dark_purple|gold|gray|dark_gray|blue|green|aqua|red|light_purple|yellow|white|reset)\b/, "constant.color"],

      // Hex Colors (#ff0000)
      [/#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})\b/, "constant.color"],

      // Main Minecraft Commands
      [/[a-zA-Z_][a-zA-Z0-9_\-.]*/, {
        cases: {
          "@commands": "keyword",
          "@default": "identifier"
        }
      }],

      // Strings
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/'([^'\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string_double"],
      [/'/, "string", "@string_single"],

      // Numbers
      [/-?\d+(\.\d+)?[fFdDbBsSlL]?/, "number"],

      // Brackets, Delimiters & Operators
      [/[{}()\[\]]/, "@brackets"],
      [/[:=,]/, "delimiter"],
      [/[!~^]/, "operator"],
      [/\s+/, "white"]
    ],
    string_double: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"]
    ],
    string_single: [
      [/[^\\']+/, "string"],
      [/\\./, "string.escape"],
      [/'/, "string", "@pop"]
    ]
  }
};

// ---------------------------------------------------------------------------
// Language Export List
// ---------------------------------------------------------------------------
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
  {
    id: "mcsn",
    extensions: [".mcsn"],
    aliases: ["MCSN", "Minecraft Compact Structure Notation"],
    tokens: mcsnTokens,
    conf: {
      comments: { lineComment: "#" },
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
  {
    id: "mcfunction",
    extensions: [".mcfunction", ".minecraft", ".mccmd"],
    aliases: ["Minecraft Command", "EaglerXcraft Command", "MCFunction"],
    tokens: mcfunctionTokens,
    conf: {
      comments: { lineComment: "#" },
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

// ---------------------------------------------------------------------------
// Monaco Native Color Picker Helper for Minecraft & Hex Colors
// ---------------------------------------------------------------------------
const MINECRAFT_COLOR_MAP = {
  black: { red: 0, green: 0, blue: 0, alpha: 1 },
  dark_blue: { red: 0, green: 0, blue: 0.66, alpha: 1 },
  dark_green: { red: 0, green: 0.66, blue: 0, alpha: 1 },
  dark_aqua: { red: 0, green: 0.66, blue: 0.66, alpha: 1 },
  dark_red: { red: 0.66, green: 0, blue: 0, alpha: 1 },
  dark_purple: { red: 0.66, green: 0, blue: 0.66, alpha: 1 },
  gold: { red: 1, green: 0.66, blue: 0, alpha: 1 },
  gray: { red: 0.66, green: 0.66, blue: 0.66, alpha: 1 },
  dark_gray: { red: 0.33, green: 0.33, blue: 0.33, alpha: 1 },
  blue: { red: 0.33, green: 0.33, blue: 1, alpha: 1 },
  green: { red: 0.33, green: 1, blue: 0.33, alpha: 1 },
  aqua: { red: 0.33, green: 1, blue: 1, alpha: 1 },
  red: { red: 1, green: 0.33, blue: 0.33, alpha: 1 },
  light_purple: { red: 1, green: 0.33, blue: 1, alpha: 1 },
  yellow: { red: 1, green: 1, blue: 0.33, alpha: 1 },
  white: { red: 1, green: 1, blue: 1, alpha: 1 },
};

/**
 * Registers native Monaco color picker for Minecraft named colors and Hex strings
 * @param {object} monaco - Global monaco instance
 * @param {string} langId - Language ID (e.g. 'mcfunction' or 'mcsn')
 */
export function registerMinecraftColorPicker(monaco, langId = "mcfunction") {
  monaco.languages.registerColorProvider(langId, {
    provideColorPresentations: (model, colorInfo) => {
      const { red, green, blue } = colorInfo.color;
      const r255 = Math.round(red * 255);
      const g255 = Math.round(green * 255);
      const b255 = Math.round(blue * 255);
      const hex = `#${((1 << 24) + (r255 << 16) + (g255 << 8) + b255).toString(16).slice(1)}`;

      // Check if matches an exact Minecraft named color
      let closestName = null;
      for (const [name, rgb] of Object.entries(MINECRAFT_COLOR_MAP)) {
        if (
          Math.abs(rgb.red - red) < 0.05 &&
          Math.abs(rgb.green - green) < 0.05 &&
          Math.abs(rgb.blue - blue) < 0.05
        ) {
          closestName = name;
          break;
        }
      }

      const presentations = [{ label: `"${hex}"` }];
      if (closestName) {
        presentations.unshift({ label: `"${closestName}"` });
      }
      return presentations;
    },
    provideDocumentColors: (model) => {
      const matches = [];
      const lines = model.getLinesContent();

      lines.forEach((lineText, lineIdx) => {
        // Search named colors
        for (const [colorName, rgb] of Object.entries(MINECRAFT_COLOR_MAP)) {
          const regex = new RegExp(`\\b${colorName}\\b`, "g");
          let match;
          while ((match = regex.exec(lineText)) !== null) {
            matches.push({
              color: rgb,
              range: {
                startLineNumber: lineIdx + 1,
                startColumn: match.index + 1,
                endLineNumber: lineIdx + 1,
                endColumn: match.index + 1 + colorName.length,
              },
            });
          }
        }
      });
      return matches;
    },
  });
}

// ESM Export
export default languages;
export { languages };

// Classic Script Fallback
if (typeof window !== "undefined") {
  window.__n3xnLangHighlights = languages;
  window.__n3xnRegisterColorPicker = registerMinecraftColorPicker;
}

/**
 * n3xn custom Monaco Monarch language definitions & IntelliSense providers
 * Version support: .minecraft (>1.20.6), .minecraft-v-1.20.6, .minecraft-v-1.16.5, .minecraft-v-1.12.2
 *
 * Supported export modes:
 * - ESM import: import languages, registerMonacoProviders from './n3xn-lang-highlights.js'
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
// 5. Minecraft Command Engine (Supports .minecraft >1.20.6, 1.20.6, 1.16.5, 1.12.2)
// ---------------------------------------------------------------------------
const createMinecraftTokenizer = (version = "1.20.6") => ({
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
  flags: ["force", "normal", "destroy", "keep", "replace", "masked", "filtered", "append", "prepend", "insert", "merge", "set"],
  tokenizer: {
    root: [
      [/#.*$/, "comment"],

      // Explicit slash command vs unslashed function command
      [/\/[a-zA-Z_][a-zA-Z0-9_\-.]*/, "keyword.command.slash"],
      [/\b(particle|execute|setblock|fill|summon|attribute|data|scoreboard|effect|give|tp|teleport)\b/, "keyword.command"],

      // Namespaced Identifiers (e.g., minecraft:dolphin, custom:particle_fx)
      [/[a-z0-9_.\-]+:[a-z0-9_.\-\/]+/, "entity.name.namespace"],

      // Tilde and Caret Coordinates (e.g. ~ ~1 ~-0.15, ^ ^ ^2, bare ~ and ^)
      [/([~^])(-?\d*\.?\d+)?/, "number.coordinate"],

      // Decimals without zero (.15, .08) and numbers (0, 10, -1.0)
      [/-?(\d+\.?\d*|\.\d+)[fFdDbBsSlL]?/, "number"],

      // Target Selectors (@p, @a, @r, @e, @s, @n, @v)
      [/@[apresnv](\[[^\]]*\])?/, "keyword.selector"],

      // Selector arguments inside brackets
      [/\b(type|tag|scores|team|name|distance|x|y|z|dx|dy|dz|x_rotation|y_rotation|limit|sort|gamemode|level|advancements|nbt)=/, "keyword.selector.arg"],

      // Execute directives
      [/\b(as|at|positioned|rotated|facing|align|anchored|in|dimension|if|unless|store|run|entity|block|blocks|score|matches|predicate|loaded|result|success)\b/, "keyword.directive"],

      // Flags and Mode Modifiers
      [/\b(force|normal|destroy|keep|replace|masked|filtered|append|prepend|insert|merge|set)\b/, "keyword.flag"],

      // Named Colors and Hex Strings
      [/\b(black|dark_blue|dark_green|dark_aqua|dark_red|dark_purple|gold|gray|dark_gray|blue|green|aqua|red|light_purple|yellow|white|reset)\b/, "constant.color"],
      [/#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})\b/, "constant.color"],

      // Double Escaped JSON Strings
      [/\\\\n/, "string.escape"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/'([^'\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string_double"],
      [/'/, "string", "@string_single"],

      [/[{}()\[\]]/, "@brackets"],
      [/[:=,]/, "delimiter"],
      [/\s+/, "white"],

      // Catch-all invalid error marker for mismatched/illegal tokens
      [/[^\s]+/, "invalid"]
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
});

// ---------------------------------------------------------------------------
// Language Export Mapping
// ---------------------------------------------------------------------------
/** @type {Array<{ id: string, extensions: string[], aliases?: string[], tokens: object, conf?: object }>} */
const languages = [
  {
    id: "brainfuck",
    extensions: [".b", ".bf"],
    aliases: ["Brainfuck", "BF"],
    tokens: brainfuckTokens,
    conf: { brackets: [["[", "]"]], autoClosingPairs: [{ open: "[", close: "]" }] }
  },
  {
    id: "nmath",
    extensions: [".nmath"],
    aliases: ["NMath", "English Math"],
    tokens: nmathTokens,
    conf: { comments: { lineComment: "#" }, brackets: [["(", ")"], ["[", "]"]], autoClosingPairs: [{ open: "(", close: ")" }, { open: "[", close: "]" }, { open: '"', close: '"' }] }
  },
  {
    id: "nexc",
    extensions: [".nexc"],
    aliases: ["N3XN Exec"],
    tokens: nexcTokens,
    conf: { comments: { lineComment: "//", blockComment: ["/*", "*/"] }, brackets: [["{", "}"], ["[", "]"], ["(", ")"]], autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: '"', close: '"' }, { open: "'", close: "'" }] }
  },
  {
    id: "mcsn",
    extensions: [".mcsn"],
    aliases: ["MCSN", "Minecraft Compact Structure Notation"],
    tokens: mcsnTokens,
    conf: { comments: { lineComment: "#" }, brackets: [["{", "}"], ["[", "]"], ["(", ")"]], autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: '"', close: '"' }, { open: "'", close: "'" }] }
  },
  {
    id: "mcfunction",
    extensions: [".mcfunction", ".minecraft", ".mccmd"],
    aliases: ["Minecraft Command (>1.20.6)", "EaglerXcraft 1.20.6 Command"],
    tokens: createMinecraftTokenizer(">1.20.6"),
    conf: { comments: { lineComment: "#" }, brackets: [["{", "}"], ["[", "]"], ["(", ")"]], autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: '"', close: '"' }, { open: "'", close: "'" }] }
  },
  {
    id: "mcfunction-1-20-6",
    extensions: [".minecraft-v-1.20.6"],
    aliases: ["Minecraft 1.20.6 Command"],
    tokens: createMinecraftTokenizer("1.20.6"),
    conf: { comments: { lineComment: "#" }, brackets: [["{", "}"], ["[", "]"]], autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }] }
  },
  {
    id: "mcfunction-1-16-5",
    extensions: [".minecraft-v-1.16.5"],
    aliases: ["Minecraft 1.16.5 Command"],
    tokens: createMinecraftTokenizer("1.16.5"),
    conf: { comments: { lineComment: "#" }, brackets: [["{", "}"], ["[", "]"]], autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }] }
  },
  {
    id: "mcfunction-1-12-2",
    extensions: [".minecraft-v-1.12.2"],
    aliases: ["Minecraft 1.12.2 Command (Legacy)"],
    tokens: createMinecraftTokenizer("1.12.2"),
    conf: { comments: { lineComment: "#" }, brackets: [["{", "}"], ["[", "]"]], autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }] }
  }
];

// ---------------------------------------------------------------------------
// Monaco Autocomplete, Hover, and Color Picker Providers
// ---------------------------------------------------------------------------
export function registerMonacoProviders(monaco) {
  const mcLangs = ["mcfunction", "mcfunction-1-20-6", "mcfunction-1-16-5", "mcfunction-1-12-2", "mcsn"];

  mcLangs.forEach(langId => {
    // 1. Contextual Autocomplete Provider ("What can be typed next")
    monaco.languages.registerCompletionItemProvider(langId, {
      provideCompletionItems: (model, position) => {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });

        const suggestions = [];

        if (textUntilPosition.trim() === "" || textUntilPosition.endsWith("/")) {
          const cmds = ["particle", "execute", "attribute", "summon", "setblock", "fill", "data", "scoreboard", "tellraw"];
          cmds.forEach(cmd => {
            suggestions.push({
              label: cmd,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: cmd,
              detail: "Minecraft Command"
            });
          });
        } else if (textUntilPosition.includes("particle ")) {
          const particles = ["minecraft:dolphin", "minecraft:scrape", "minecraft:electric_spark", "minecraft:soul_fire_flame", "minecraft:totem_of_undying", "minecraft:trial_spawner_detection_ominous"];
          particles.forEach(p => {
            suggestions.push({
              label: p,
              kind: monaco.languages.CompletionItemKind.Value,
              insertText: p,
              detail: "Particle ID"
            });
          });
        }

        return { suggestions };
      }
    });

    // 2. Hover Info Provider
    monaco.languages.registerHoverProvider(langId, {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position);
        if (!word) return;

        if (word.word === "particle") {
          return {
            contents: [
              { value: "**`/particle` Command**" },
              { value: "Syntax: `particle <name> <pos> <delta> <speed> <count> [force|normal]`" }
            ]
          };
        }
        if (word.word === "attribute") {
          return {
            contents: [
              { value: "**`/attribute` Command**" },
              { value: "Syntax: `attribute <target> <attribute> base set|get <value>`" }
            ]
          };
        }
      }
    });
  });
}

// ESM Export
export default languages;
export { languages };

// Script Tag Fallback
if (typeof window !== "undefined") {
  window.__n3xnLangHighlights = languages;
  window.__n3xnRegisterMonacoProviders = registerMonacoProviders;
}

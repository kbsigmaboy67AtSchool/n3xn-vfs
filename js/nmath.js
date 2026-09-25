/**
 * n3xn .nmath — English-first math language
 * Readable phrases + normal math; evaluates to numbers / text results.
 */

const WORD_NUM = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  million: 1e6, billion: 1e9, pi: Math.PI, e: Math.E, tau: Math.PI * 2,
};

const CONST = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2, infinity: Infinity };

function wordsToNumber(phrase) {
  const parts = phrase.toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 1 && WORD_NUM[parts[0]] != null) return WORD_NUM[parts[0]];
  let total = 0, current = 0;
  for (const w of parts) {
    if (w === "and") continue;
    const n = WORD_NUM[w];
    if (n == null) return null;
    if (n === 100) {
      current = (current || 1) * 100;
    } else if (n >= 1000) {
      total += (current || 1) * n;
      current = 0;
    } else {
      current += n;
    }
  }
  return total + current;
}

/** Replace English number words with digits in a string */
function replaceNumberWords(s) {
  return s.replace(
    /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|and)(?:[\s-]+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|and))*\b/gi,
    (m) => {
      const n = wordsToNumber(m);
      return n == null ? m : String(n);
    }
  );
}

function preprocessEnglish(src) {
  let s = String(src || "");
  // strip comments
  s = s.replace(/#.*$/gm, "").replace(/\/\/.*$/gm, "");
  // common English ops
  const reps = [
    [/\bsquare\s+root\s+of\b/gi, "sqrt "],
    [/\bcube\s+root\s+of\b/gi, "cbrt "],
    [/\bsqrt\s+of\b/gi, "sqrt "],
    [/\bto the power of\b/gi, " ** "],
    [/\braised to\b/gi, " ** "],
    [/\bmultiplied by\b/gi, " * "],
    [/\btimes\b/gi, " * "],
    [/\bdivided by\b/gi, " / "],
    [/\bover\b/gi, " / "],
    [/\bplus\b/gi, " + "],
    [/\bminus\b/gi, " - "],
    [/\bmodulo\b/gi, " % "],
    [/\bmod\b/gi, " % "],
    [/\bsquared\b/gi, " ** 2"],
    [/\bcubed\b/gi, " ** 3"],
    [/\bfactorial of\b/gi, "factorial "],
    [/\babsolute value of\b/gi, "abs "],
    [/\bsine of\b/gi, "sin "],
    [/\bcosine of\b/gi, "cos "],
    [/\btangent of\b/gi, "tan "],
    [/\barcsin of\b/gi, "asin "],
    [/\barccos of\b/gi, "acos "],
    [/\barctan of\b/gi, "atan "],
    [/\bnatural log of\b/gi, "ln "],
    [/\blog base 10 of\b/gi, "log10 "],
    [/\blog of\b/gi, "log10 "],
    [/\bthe sum of\b/gi, "sum "],
    [/\bsum of\b/gi, "sum "],
    [/\bproduct of\b/gi, "product "],
    [/\baverage of\b/gi, "avg "],
    [/\bmean of\b/gi, "avg "],
    [/\bminimum of\b/gi, "min "],
    [/\bmaximum of\b/gi, "max "],
    [/\bthrough\b/gi, " to "],
    [/\buntil\b/gi, " to "],
    [/\bequals\b/gi, " = "],
    [/\bis\b/gi, " = "],
    [/\bpercent of\b/gi, " percentof "],
    [/\b% of\b/gi, " percentof "],
  ];
  for (const [re, to] of reps) s = s.replace(re, to);
  s = replaceNumberWords(s);
  // degrees → radians helper: 90 degrees → deg(90)
  s = s.replace(/(\d+(?:\.\d+)?)\s*degrees?/gi, "deg($1)");
  return s;
}

function factorial(n) {
  n = Math.floor(Number(n));
  if (n < 0) return NaN;
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function sumRange(a, b) {
  a = Number(a);
  b = Number(b);
  if (a > b) [a, b] = [b, a];
  const n = b - a + 1;
  return (n * (a + b)) / 2;
}

function productRange(a, b) {
  a = Math.floor(Number(a));
  b = Math.floor(Number(b));
  if (a > b) [a, b] = [b, a];
  let r = 1;
  for (let i = a; i <= b; i++) r *= i;
  return r;
}

/** Safe expression evaluator after preprocess */
function evalExpr(expr, vars = {}) {
  let e = expr.trim();
  if (!e) return undefined;

  // sum 1 to 10 / product 1 to 5
  let m = e.match(/^sum\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)$/i);
  if (m) return sumRange(m[1], m[2]);
  m = e.match(/^product\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)$/i);
  if (m) return productRange(m[1], m[2]);
  m = e.match(/^avg\s+(.+)$/i);
  if (m) {
    const nums = m[1].split(/[\s,]+/).map(Number).filter((x) => !Number.isNaN(x));
    return nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
  }
  m = e.match(/^(\d+(?:\.\d+)?)\s+percentof\s+(-?[\d.]+)$/i);
  if (m) return (Number(m[1]) / 100) * Number(m[2]);

  // function calls without parens: sqrt 16 → sqrt(16)
  e = e.replace(
    /\b(sqrt|cbrt|abs|sin|cos|tan|asin|acos|atan|ln|log10|log|floor|ceil|round|factorial|deg|rad)\s+(-?[\d.]+|\([^)]+\))/gi,
    (_, fn, arg) => `${fn.toLowerCase()}(${arg})`
  );

  // allow ** 
  // Build sandbox
  const fns = {
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    abs: Math.abs,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    ln: Math.log,
    log: Math.log10,
    log10: Math.log10,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    factorial,
    deg: (d) => (Number(d) * Math.PI) / 180,
    rad: (r) => (Number(r) * 180) / Math.PI,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
    hypot: Math.hypot,
    ...CONST,
    ...vars,
  };

  // assignments handled outside
  const keys = Object.keys(fns);
  const vals = Object.values(fns);
  // only allow safe chars
  if (/[^0-9a-zA-Z_+\-*/%().,\s^]/.test(e.replace(/\*\*/g, ""))) {
    // still allow **
  }
  const cleaned = e.replace(/\^/g, "**");
  if (!/^[\d\s+\-*/%().,a-zA-Z_^]+$/.test(cleaned.replace(/\*\*/g, ""))) {
    throw new Error("Unsafe or unsupported expression: " + expr);
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict"; return (${cleaned});`);
    return fn(...vals);
  } catch (err) {
    throw new Error("Cannot evaluate: " + expr + " (" + (err.message || err) + ")");
  }
}

/**
 * Run full .nmath source — multiple lines, let x = ..., print answers
 * @returns {{ results: any[], output: string, vars: object }}
 */
export function runNmath(source, opts = {}) {
  const log = opts.log || (() => {});
  const vars = { ...(opts.vars || {}) };
  const results = [];
  const lines = String(source || "").split(/\r?\n/);
  const out = [];

  for (let raw of lines) {
    let line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    // print / show
    const printM = line.match(/^(?:print|show|say)\s+(.+)$/i);
    if (printM) {
      const v = evalExpr(preprocessEnglish(printM[1]), vars);
      results.push(v);
      out.push(String(v));
      log(String(v), "ok");
      continue;
    }

    // let x = … / x = …
    const asg = line.match(/^(?:let|set|const)?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/i);
    if (asg) {
      const name = asg[1];
      const val = evalExpr(preprocessEnglish(asg[2]), vars);
      vars[name] = val;
      results.push(val);
      out.push(`${name} = ${val}`);
      log(`${name} = ${val}`, "out");
      continue;
    }

    // what is … ?
    line = line.replace(/^what is\s+/i, "").replace(/\?+$/, "");

    const pre = preprocessEnglish(line);
    const val = evalExpr(pre, vars);
    results.push(val);
    out.push(String(val));
    log(String(val), "ok");
  }

  return { results, output: out.join("\n"), vars, last: results[results.length - 1] };
}

export async function runNmathFile(path, opts = {}) {
  const fs = await import("./fs.js");
  const f = await fs.readFile(path);
  if (!f) throw new Error("File not found: " + path);
  return runNmath(f.text(), opts);
}

export function nmathHelp() {
  return `nmath — English math
  two plus three
  square root of 16
  5 times 12
  sum 1 to 100
  let x = pi times 2
  print x
  sine of 90 degrees
  20 percent of 50
  factorial of 5
`;
}

/* global fetch */

import { stringify } from "lively.ast";

import normalizer from "./jswala.js";
import { assertionToSMT } from "./assertions.js";
import { statementToSMT, smtToValue } from "./javascript.js";
import { preamble } from "./defs-smt.js";
import { removeAssertions, preConditions } from "./visitors.js";

function functionBody(func) {
  // FunctionDeclaration -> BlockStatement
  
  // normalize function body to SSA-like language
  const replaced = removeAssertions(func),
        prog = {type: "Program", body: [replaced]},
        normalized = normalizer.normalize(prog,
          {unify_ret: true});
  // extract statements in function
  return normalized.body[0].expression.callee.body.body[1].expression.right;
}

export default class Theorem {
  constructor(func, postcondition) {
    // FunctionDeclaration, Expression -> Theorem
    this.func = func;
    this.postcondition = postcondition;
    this._result = null;
  }
  
  description() {
    // -> string
    return `${this.func.id.name}:\n${stringify(this.postcondition)}`;
  }
  
  funcBody() {
    return {
      type: "BlockStatement",
      body: functionBody(this.func).body.body
    };
  }
  
  funcBodyStr() {
    const func = functionBody(this.func);
    func.id = this.func.id;
    return stringify(func);
  }
  
  csystem() {
    // -> SMTInput
    if (this._csystem) return this._csystem;

    const parameters = this.func.params.map(p =>
            `(declare-const ${p.name} JSVal)`).join('\n'),
          requirements = preConditions(this.func).map(c =>
            `(assert (_truthy ${assertionToSMT(c, this.func)}))`).join('\n'),
          [body] = statementToSMT(this.funcBody()),
          post = `(assert (not (_truthy ${assertionToSMT(this.postcondition, this.func)})))`;
    
    return this._csystem =
`${preamble}

; parameters
${parameters}
(declare-const _res JSVal)

; requirements
${requirements}

; body
${body}

; post condition
${post}

(check-sat)
(get-value (${this.func.params.map(p => p.name).join(' ')} _res))`;
  }
  
  result() {
    return this._result;
  }
  
  async solve() {
    // -> SMTOutput
    if (this._result) return this._result;
    const req = await fetch("/nodejs/Z3server/", {
      method: "POST",
      body: this.csystem()
    });
    return this._result = await req.text();
  }
  
  isSatisfiable() {
    // -> Bool?
    const res = this.result();
    if (!res) return null;
    if (res.startsWith("unsat")) return true;
    if (res.startsWith("sat")) return false;
    throw new Error("z3 failed to solve problem");
  }
  
  getModel() {
    // -> { [string]: any }?
    if (this._model) return this._model;
    let res = this.result();
    if (!res) return null;
    if (!res.startsWith("sat")) throw new Error("no model available");
    // remove "sat"
    res = res.slice(3, res.length);
    // remove outer parens
    res = res.trim().slice(2, res.length - 4);
    const model = {};
    res.split(/\)\s+\(/m).forEach(str => {
      // these are now just pairs of varname value
      const both = str.trim().split(" ");
      if (both.length < 2) return;
      const name = both[0].trim(),
            value = both.slice(1, both.length).join(" ").trim();
      model[name] = smtToValue(value);
    });
    return this._model = model;
  }
}
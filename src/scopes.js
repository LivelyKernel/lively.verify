import { stringify } from "lively.ast";
import { funcExpr } from "lively.ast/lib/nodes.js";
import { arr } from "lively.lang";

import Theorem from "./theorems.js";
import { isAssertion, replaceFunctionResult, replaceResultFunction, findDefs } from "./visitors.js";

class VerificationScope {
  
  constructor(parent, node) {
    // VerificationScope?, Node -> VerificationScope
    if (parent) {
      parent.scopes.push(this);
      this.parent = parent;
    }
    this.scopes = []; // Array<VerificationScope>
    this.node = node;
  }
  
  requires() {
    // -> Array<Expression>
    throw new Error("not implemented");
  }
  
  assumes() {
    // -> Array<Expression>
    throw new Error("not implemented");
  }
  
  body() {
    // -> Array<Statement>
    throw new Error("not implemented");
  }
  
  toProve() {
    // -> Array<Expression>
    return this.invariants();
  }
  
  describe(post) {
    // Expression -> string
    throw new Error("not implemented");
  }
  
  describeReq() {
    // -> string
    return "assert";
  }
  
  theorems() {
    // -> Array<Theorem>
    const vars = this.surroundingVars(),
          pre = this.assumes(),
          body = this.statements(),
          theorems = this.toProve().map(pc =>
            new Theorem(vars, pre, body, pc, this.describe(pc))),
          partials = this.immediates().concat(this.subRequirements()).map(([type, pc, part]) =>
            new Theorem(vars, pre, part, pc, `${type}:\n${stringify(pc)}`));
    return theorems.concat(partials).concat(arr.flatmap(this.scopes, s => s.theorems()));
  }
  
  vars() {
    // -> Array<string>
    return findDefs(this.node).concat(this.surroundingVars());
  }
  
  surroundingVars() {
    // -> Array<string>
    return this.parent ? this.parent.vars() : [];
  }
  
  statements() {
    // -> Array<Statement>
    return this.body().filter(stmt => !isAssertion(stmt));
  }
  
  assertions() {
    // -> Array<Expression>
    return this.body().filter(isAssertion).map(stmt => stmt.expression);
  }
  
  upToExpr(expr) {
    // Expression -> Array<Statement>
    return arr.takeWhile(this.body(), stmt => stmt.expression !== expr)
              .filter(stmt => !isAssertion(stmt));
  }
  
  upToStmt(stmt) {
    // Statement -> Array<Statement>
    return arr.takeWhile(this.body(), s => s !== stmt)
              .filter(stmt => !isAssertion(stmt));
  }

  immediates() {
    // -> Array<[Expression, Array<Statement>]>
    return this.assertions()
      .filter(expr => expr.callee.name == "assert")
      .map(expr => ["assert", expr.arguments[0], this.upToExpr(expr)]);
  }
  
  subRequirements() {
    return arr.flatmap(
      this.scopes,
      scope => scope.requires().map(expr => [scope.describeReq(), expr, this.upToStmt(scope.node)]));
  }
  
  invariants() {
    // -> Array<Expression>
    const pi = this.parent ? this.parent.invariants() : [];
    return pi.concat(this.assertions()
      .filter(expr => expr.callee.name == "invariant")
      .map(expr => expr.arguments[0]));
  }
  
}

export class FunctionScope extends VerificationScope {
  
  requires() {
    // -> Array<Expression>
    return [];
  }
  
  assumes() {
    // -> Array<Expression>
    return this.preConditions().concat(this.parent.invariants());
  }

  body() {
    // -> Array<Statement>
    return this.node.body.body;
  }
  
  bodySource() {
    // -> JSSource
    const {id, params} = this.node;
    return stringify(funcExpr({id}, params, ...this.normalizedNode()));
  }
  
  toProve() {
    // -> Array<Expression>
    return super.toProve().concat(this.postConditions().map(pc => {
      return replaceFunctionResult(this.node, pc);
    }));
  }
  
  describe(post) {
    // Expression -> string
    const replaced = replaceResultFunction(this.node, post);
    return `${this.node.id.name}:\n${stringify(replaced)}`;
  }

  surroundingVars() {
    // -> Array<string>
    return super.surroundingVars().concat(this.node.params.map(p => p.name));
  }

  preConditions() {
    // -> Array<Expression>
    return this.assertions()
      .filter(expr => expr.callee.name == "requires")
      .map(expr => expr.arguments[0]);
  }
  
  postConditions() {
    // -> Array<Expression>
    return this.assertions()
      .filter(expr => expr.callee.name == "ensures")
      .map(expr => expr.arguments[0]);
  }
  
}

export class ClassScope extends VerificationScope {
}

export class LoopScope extends VerificationScope {
  
  requires() {
    // -> Array<Expression>
    return this.invariants();
  }

  assumes() {
    // -> Array<Expression>
    return this.invariants().concat([this.node.test]);
  }
  
  body() {
    // -> Array<Statement>
    return this.node.body.body;
  }
  
  describe(post) {
    // Expression -> string
    return `loop invariant:\n${stringify(post)}`;
  }
  
  describeReq() {
    // -> string
    return "loop entry";
  }

}

export class TopLevelScope extends VerificationScope {
  
  constructor(node) {
    // Program -> VerificationScope
    super(null, node);
  }
  
  requires() {
    // -> Array<Expression>
    return [];
  }

  assumes() {
    // -> Array<Expression>
    return [];
  }
  
  body() {
    // -> Array<Statement>
    return this.node.body;
  }

  describe(post) {
    // Expression -> string
    return `initially:\n${stringify(post)}`;
  }
  
}

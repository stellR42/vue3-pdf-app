/* Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import "core-js/modules/es.array.push.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import { FormatError, warn } from "../../shared/util.js";
import { Lexer, TOKEN } from "./lexer.js";
const PS_VALUE_TYPE = {
  numeric: 0,
  boolean: 1,
  unknown: 2
};
const PS_NODE = {
  program: 0,
  block: 1,
  number: 2,
  operator: 3,
  if: 4,
  ifelse: 5,
  arg: 6,
  const: 7,
  unary: 8,
  binary: 9,
  ternary: 10
};
class PsNode {
  constructor(type) {
    this.type = type;
  }
}
class PsProgram extends PsNode {
  constructor(body) {
    super(PS_NODE.program);
    this.body = body;
  }
}
class PsBlock extends PsNode {
  constructor(instructions) {
    super(PS_NODE.block);
    this.instructions = instructions;
  }
}
class PsNumber extends PsNode {
  constructor(value) {
    super(PS_NODE.number);
    this.value = value;
  }
}
class PsOperator extends PsNode {
  constructor(op) {
    super(PS_NODE.operator);
    this.op = op;
  }
}
class PsIf extends PsNode {
  constructor(then) {
    super(PS_NODE.if);
    this.then = then;
  }
}
class PsIfElse extends PsNode {
  constructor(then, otherwise) {
    super(PS_NODE.ifelse);
    this.then = then;
    this.otherwise = otherwise;
  }
}
class PsArgNode extends PsNode {
  constructor(index) {
    super(PS_NODE.arg);
    this.index = index;
    this.valueType = PS_VALUE_TYPE.numeric;
    this.depth = 0;
  }
}
class PsConstNode extends PsNode {
  constructor(value) {
    super(PS_NODE.const);
    this.value = value;
    this.valueType = typeof value === "boolean" ? PS_VALUE_TYPE.boolean : PS_VALUE_TYPE.numeric;
    this.depth = 0;
  }
}
class PsUnaryNode extends PsNode {
  constructor(op, operand, valueType = PS_VALUE_TYPE.unknown) {
    super(PS_NODE.unary);
    this.op = op;
    this.operand = operand;
    this.valueType = valueType;
    this.depth = operand.depth + 1;
  }
}
class PsBinaryNode extends PsNode {
  constructor(op, first, second, valueType = PS_VALUE_TYPE.unknown) {
    super(PS_NODE.binary);
    this.op = op;
    this.first = first;
    this.second = second;
    this.valueType = valueType;
    this.depth = Math.max(first.depth, second.depth) + 1;
  }
}
class PsTernaryNode extends PsNode {
  constructor(cond, then, otherwise, valueType = PS_VALUE_TYPE.unknown) {
    super(PS_NODE.ternary);
    this.cond = cond;
    this.then = then;
    this.otherwise = otherwise;
    this.valueType = valueType;
    this.depth = Math.max(cond.depth, then.depth, otherwise.depth) + 1;
  }
}
const MAX_NESTING_DEPTH = 1000;
class Parser {
  constructor(lexer) {
    this.lexer = lexer;
    this._token = null;
    this._depth = 0;
  }
  static _isRegularOperator(id) {
    return id >= TOKEN.true && id < TOKEN.if;
  }
  _advance() {
    this._token = this.lexer.next();
  }
  _expect(id) {
    if (this._token.id !== id) {
      throw new FormatError(`PostScript function: expected token id ${id}, got ${this._token.id}.`);
    }
    const tok = this._token;
    this._advance();
    return tok;
  }
  parse() {
    this._advance();
    this._expect(TOKEN.lbrace);
    const block = this._parseBlock();
    this._expect(TOKEN.rbrace);
    if (this._token.id !== TOKEN.eof) {
      warn("PostScript function: unexpected content after closing brace.");
    }
    return new PsProgram(block);
  }
  _parseBlock() {
    const instructions = [];
    while (true) {
      const tok = this._token;
      switch (tok.id) {
        case TOKEN.number:
          instructions.push(new PsNumber(tok.value));
          this._advance();
          break;
        case TOKEN.lbrace:
          {
            if (++this._depth > MAX_NESTING_DEPTH) {
              throw new FormatError("PostScript function: procedures are nested too deeply.");
            }
            this._advance();
            const thenBlock = this._parseBlock();
            this._expect(TOKEN.rbrace);
            if (this._token.id === TOKEN.if) {
              this._advance();
              instructions.push(new PsIf(thenBlock));
            } else if (this._token.id === TOKEN.lbrace) {
              this._advance();
              const elseBlock = this._parseBlock();
              this._expect(TOKEN.rbrace);
              this._expect(TOKEN.ifelse);
              instructions.push(new PsIfElse(thenBlock, elseBlock));
            } else {
              throw new FormatError("PostScript function: a procedure block must be followed by 'if' or '{…} ifelse'.");
            }
            this._depth--;
            break;
          }
        case TOKEN.rbrace:
        case TOKEN.eof:
          return new PsBlock(instructions);
        case TOKEN.if:
        case TOKEN.ifelse:
          throw new FormatError(`PostScript function: unexpected '${tok.value}' operator.`);
        default:
          if (Parser._isRegularOperator(tok.id)) {
            instructions.push(new PsOperator(tok.id));
            this._advance();
            break;
          }
          throw new FormatError(`PostScript function: unexpected token id ${tok.id}.`);
      }
    }
  }
}
function parsePostScriptFunction(source) {
  return new Parser(new Lexer(source)).parse();
}
function _evalBinaryConst(op, a, b) {
  switch (op) {
    case TOKEN.add:
      return a + b;
    case TOKEN.sub:
      return a - b;
    case TOKEN.mul:
      return a * b;
    case TOKEN.div:
      return b !== 0 ? a / b : 0;
    case TOKEN.idiv:
      return b !== 0 ? Math.trunc(a / b) : 0;
    case TOKEN.mod:
      return b !== 0 ? a - Math.trunc(a / b) * b : 0;
    case TOKEN.exp:
      {
        const r = a ** b;
        return Number.isFinite(r) ? r : undefined;
      }
    case TOKEN.atan:
      {
        let deg = Math.atan2(a, b) * (180 / Math.PI);
        if (deg < 0) {
          deg += 360;
        }
        return deg;
      }
    case TOKEN.eq:
      return a === b;
    case TOKEN.ne:
      return a !== b;
    case TOKEN.gt:
      return a > b;
    case TOKEN.ge:
      return a >= b;
    case TOKEN.lt:
      return a < b;
    case TOKEN.le:
      return a <= b;
    case TOKEN.and:
      return typeof a === "boolean" ? a && b : a & b | 0;
    case TOKEN.or:
      return typeof a === "boolean" ? a || b : a | b | 0;
    case TOKEN.xor:
      return typeof a === "boolean" ? a !== b : a ^ b | 0;
    case TOKEN.bitshift:
      return b >= 0 ? a << b | 0 : a >> -b | 0;
    case TOKEN.min:
      return Math.min(a, b);
    case TOKEN.max:
      return Math.max(a, b);
    default:
      return undefined;
  }
}
function _evalUnaryConst(op, v) {
  switch (op) {
    case TOKEN.abs:
      return Math.abs(v);
    case TOKEN.neg:
      return -v;
    case TOKEN.ceiling:
      return Math.ceil(v);
    case TOKEN.floor:
      return Math.floor(v);
    case TOKEN.round:
      return Math.round(v);
    case TOKEN.truncate:
      return Math.trunc(v);
    case TOKEN.sqrt:
      {
        const r = Math.sqrt(v);
        return Number.isFinite(r) ? r : undefined;
      }
    case TOKEN.sin:
      return Math.sin(v % 360 * Math.PI / 180);
    case TOKEN.cos:
      return Math.cos(v % 360 * Math.PI / 180);
    case TOKEN.ln:
      {
        const r = Math.log(v);
        return Number.isFinite(r) ? r : undefined;
      }
    case TOKEN.log:
      {
        const r = Math.log10(v);
        return Number.isFinite(r) ? r : undefined;
      }
    case TOKEN.cvi:
      return Math.trunc(v) | 0;
    case TOKEN.cvr:
      return v;
    case TOKEN.not:
      return typeof v === "boolean" ? !v : ~v;
    default:
      return undefined;
  }
}
const MAX_STACK_SIZE = 100;
const MAX_WORK = 100_000;
const MAX_FORK_DEPTH = 1000;
const MAX_TREE_DEPTH = 500;
function _unaryValueType(op, operandType) {
  return op === TOKEN.not ? operandType : PS_VALUE_TYPE.numeric;
}
function _binaryValueType(op, firstType, secondType) {
  switch (op) {
    case TOKEN.eq:
    case TOKEN.ne:
    case TOKEN.gt:
    case TOKEN.ge:
    case TOKEN.lt:
    case TOKEN.le:
      return PS_VALUE_TYPE.boolean;
    case TOKEN.and:
    case TOKEN.or:
    case TOKEN.xor:
      return firstType === secondType && firstType !== PS_VALUE_TYPE.unknown ? firstType : PS_VALUE_TYPE.unknown;
    default:
      return PS_VALUE_TYPE.numeric;
  }
}
class PSStackToTree {
  static #binaryOps = null;
  static #unaryOps = null;
  static #idempotentUnary = null;
  static #negatedComparison = null;
  static #init() {
    this.#binaryOps = new Set([TOKEN.add, TOKEN.sub, TOKEN.mul, TOKEN.div, TOKEN.idiv, TOKEN.mod, TOKEN.exp, TOKEN.atan, TOKEN.eq, TOKEN.ne, TOKEN.gt, TOKEN.ge, TOKEN.lt, TOKEN.le, TOKEN.and, TOKEN.or, TOKEN.xor, TOKEN.bitshift]);
    this.#unaryOps = new Set([TOKEN.abs, TOKEN.neg, TOKEN.ceiling, TOKEN.floor, TOKEN.round, TOKEN.truncate, TOKEN.sqrt, TOKEN.sin, TOKEN.cos, TOKEN.ln, TOKEN.log, TOKEN.cvi, TOKEN.cvr, TOKEN.not]);
    this.#idempotentUnary = new Set([TOKEN.abs, TOKEN.ceiling, TOKEN.cvi, TOKEN.cvr, TOKEN.floor, TOKEN.round, TOKEN.truncate]);
    this.#negatedComparison = new Map([[TOKEN.eq, TOKEN.ne], [TOKEN.ne, TOKEN.eq], [TOKEN.lt, TOKEN.ge], [TOKEN.le, TOKEN.gt], [TOKEN.gt, TOKEN.le], [TOKEN.ge, TOKEN.lt]]);
  }
  evaluate(program, numInputs) {
    if (!PSStackToTree.#binaryOps) {
      PSStackToTree.#init();
    }
    this._failed = false;
    this._work = 0;
    this._forkDepth = 0;
    if (numInputs > MAX_STACK_SIZE) {
      return null;
    }
    const stack = [];
    for (let i = 0; i < numInputs; i++) {
      stack.push(new PsArgNode(i));
    }
    this._evalBlock(program.body, stack);
    if (this._failed) {
      return null;
    }
    PSStackToTree.#markShared(stack);
    return stack;
  }
  static #markShared(outputs) {
    const refCount = new Map();
    const visit = node => {
      if (!node || node.type === PS_NODE.arg || node.type === PS_NODE.const) {
        return;
      }
      const prev = refCount.get(node) ?? 0;
      refCount.set(node, prev + 1);
      if (prev > 0) {
        return;
      }
      switch (node.type) {
        case PS_NODE.unary:
          visit(node.operand);
          break;
        case PS_NODE.binary:
          visit(node.first);
          visit(node.second);
          break;
        case PS_NODE.ternary:
          visit(node.cond);
          visit(node.then);
          visit(node.otherwise);
          break;
      }
    };
    for (const output of outputs) {
      visit(output);
    }
    for (const [node, count] of refCount) {
      if (count > 1) {
        node.shared = true;
        node.sharedCount = count;
      }
    }
  }
  _evalBlock(block, stack) {
    this._evalBlockFrom(block.instructions, 0, stack);
  }
  _evalBlockFrom(instructions, startIdx, stack) {
    for (let idx = startIdx; idx < instructions.length; idx++) {
      if (this._failed || !this._checkWorkLimit()) {
        break;
      }
      const instr = instructions[idx];
      switch (instr.type) {
        case PS_NODE.number:
          stack.push(new PsConstNode(instr.value));
          if (stack.length > MAX_STACK_SIZE) {
            this._failed = true;
          }
          break;
        case PS_NODE.operator:
          this._evalOp(instr.op, stack);
          break;
        case PS_NODE.if:
          {
            if (stack.length < 1) {
              this._failed = true;
              break;
            }
            const cond = stack.pop();
            const saved = stack.slice();
            this._evalBlock(instr.then, stack);
            if (this._failed) {
              break;
            }
            if (stack.length === saved.length) {
              for (let i = 0; i < stack.length; i++) {
                if (stack[i] !== saved[i]) {
                  stack[i] = this._makeTernary(cond, stack[i], saved[i]);
                }
              }
            } else if (stack.length > saved.length) {
              if (cond.type === PS_NODE.const) {
                if (!cond.value) {
                  stack.length = 0;
                  stack.push(...saved);
                }
                break;
              }
              if (this._forkDepth >= MAX_FORK_DEPTH) {
                this._failed = true;
                break;
              }
              this._forkDepth++;
              const trueStack = stack.slice();
              this._evalBlockFrom(instructions, idx + 1, trueStack);
              if (this._failed) {
                break;
              }
              const falseStack = saved;
              this._evalBlockFrom(instructions, idx + 1, falseStack);
              if (this._failed) {
                break;
              }
              this._forkDepth--;
              if (trueStack.length !== falseStack.length) {
                const zero = new PsConstNode(0);
                while (trueStack.length < falseStack.length) {
                  trueStack.push(zero);
                }
                while (falseStack.length < trueStack.length) {
                  falseStack.push(zero);
                }
              }
              stack.length = 0;
              for (let i = 0; i < trueStack.length; i++) {
                stack.push(this._makeTernary(cond, trueStack[i], falseStack[i]));
              }
              return;
            } else {
              this._failed = true;
            }
            break;
          }
        case PS_NODE.ifelse:
          {
            if (stack.length < 1) {
              this._failed = true;
              break;
            }
            const cond = stack.pop();
            const snapshot = stack.slice();
            const thenStack = snapshot.slice();
            this._evalBlock(instr.then, thenStack);
            if (this._failed) {
              break;
            }
            const elseStack = snapshot.slice();
            this._evalBlock(instr.otherwise, elseStack);
            if (this._failed) {
              break;
            }
            if (thenStack.length !== elseStack.length) {
              const zero = new PsConstNode(0);
              while (thenStack.length < elseStack.length) {
                thenStack.push(zero);
              }
              while (elseStack.length < thenStack.length) {
                elseStack.push(zero);
              }
            }
            stack.length = 0;
            for (let i = 0; i < thenStack.length; i++) {
              stack.push(this._makeTernary(cond, thenStack[i], elseStack[i]));
            }
            break;
          }
      }
    }
  }
  _evalOp(op, stack) {
    if (PSStackToTree.#binaryOps.has(op)) {
      if (stack.length < 2) {
        this._failed = true;
        return;
      }
      const first = stack.pop();
      const second = stack.pop();
      stack.push(this._makeBinary(op, first, second));
      return;
    }
    if (PSStackToTree.#unaryOps.has(op)) {
      if (stack.length < 1) {
        this._failed = true;
        return;
      }
      stack.push(this._makeUnary(op, stack.pop()));
      return;
    }
    switch (op) {
      case TOKEN.true:
        stack.push(new PsConstNode(true));
        if (stack.length > MAX_STACK_SIZE) {
          this._failed = true;
        }
        break;
      case TOKEN.false:
        stack.push(new PsConstNode(false));
        if (stack.length > MAX_STACK_SIZE) {
          this._failed = true;
        }
        break;
      case TOKEN.dup:
        if (stack.length < 1) {
          this._failed = true;
          break;
        }
        stack.push(stack.at(-1));
        if (stack.length > MAX_STACK_SIZE) {
          this._failed = true;
        }
        break;
      case TOKEN.exch:
        {
          if (stack.length < 2) {
            this._failed = true;
            break;
          }
          const a = stack.pop();
          const b = stack.pop();
          stack.push(a, b);
          break;
        }
      case TOKEN.pop:
        if (stack.length < 1) {
          this._failed = true;
          break;
        }
        stack.pop();
        break;
      case TOKEN.copy:
        {
          if (stack.length < 1) {
            this._failed = true;
            break;
          }
          const nNode = stack.pop();
          if (nNode.type === PS_NODE.const) {
            const n = nNode.value | 0;
            if (n === 0) {} else if (n < 0 || n > stack.length) {
              this._failed = true;
            } else {
              stack.push(...stack.slice(-n));
              if (stack.length > MAX_STACK_SIZE) {
                this._failed = true;
              }
            }
          } else {
            this._failed = true;
          }
          break;
        }
      case TOKEN.index:
        {
          if (stack.length < 1) {
            this._failed = true;
            break;
          }
          const nNode = stack.pop();
          if (nNode.type === PS_NODE.const) {
            const n = nNode.value | 0;
            if (n < 0 || n >= stack.length) {
              this._failed = true;
            } else {
              stack.push(stack.at(-n - 1));
            }
          } else {
            this._failed = true;
          }
          break;
        }
      case TOKEN.roll:
        {
          if (stack.length < 2) {
            this._failed = true;
            break;
          }
          const jNode = stack.pop();
          const nNode = stack.pop();
          if (nNode.type === PS_NODE.const && jNode.type === PS_NODE.const) {
            const n = nNode.value | 0;
            if (n === 0) {} else if (n < 0 || n > stack.length) {
              this._failed = true;
            } else {
              const j = ((jNode.value | 0) % n + n) % n;
              if (j > 0) {
                const slice = stack.splice(-n, n);
                stack.push(...slice.slice(n - j), ...slice.slice(0, n - j));
              }
            }
          } else {
            this._failed = true;
          }
          break;
        }
      default:
        this._failed = true;
        break;
    }
  }
  _checkWorkLimit() {
    if (++this._work > MAX_WORK) {
      this._failed = true;
      return false;
    }
    return true;
  }
  _checkDepth(node) {
    if (node.depth > MAX_TREE_DEPTH) {
      this._failed = true;
    }
    return node;
  }
  _nodesEqual(a, b) {
    if (a === b) {
      return true;
    }
    if (a.type !== b.type || !this._checkWorkLimit()) {
      return false;
    }
    switch (a.type) {
      case PS_NODE.arg:
        return a.index === b.index;
      case PS_NODE.const:
        return a.value === b.value;
      case PS_NODE.unary:
        return a.op === b.op && this._nodesEqual(a.operand, b.operand);
      case PS_NODE.binary:
        return a.op === b.op && this._nodesEqual(a.first, b.first) && this._nodesEqual(a.second, b.second);
      case PS_NODE.ternary:
        return this._nodesEqual(a.cond, b.cond) && this._nodesEqual(a.then, b.then) && this._nodesEqual(a.otherwise, b.otherwise);
      default:
        return false;
    }
  }
  _makeBinary(op, first, second) {
    if (first.type === PS_NODE.const && second.type === PS_NODE.const) {
      const v = _evalBinaryConst(op, second.value, first.value);
      if (v !== undefined) {
        return new PsConstNode(v);
      }
    }
    if (this._nodesEqual(first, second)) {
      switch (op) {
        case TOKEN.sub:
          return new PsConstNode(0);
        case TOKEN.xor:
          return new PsConstNode(first.valueType === PS_VALUE_TYPE.boolean ? false : 0);
        case TOKEN.and:
        case TOKEN.or:
          return first;
        case TOKEN.min:
        case TOKEN.max:
          return first;
        case TOKEN.eq:
        case TOKEN.ge:
        case TOKEN.le:
          return new PsConstNode(true);
        case TOKEN.ne:
        case TOKEN.gt:
        case TOKEN.lt:
          return new PsConstNode(false);
      }
    }
    if (op === TOKEN.eq || op === TOKEN.ne) {
      if (first.valueType === PS_VALUE_TYPE.unknown || second.valueType === PS_VALUE_TYPE.unknown) {
        this._failed = true;
      } else if (first.valueType !== second.valueType) {
        return new PsConstNode(op === TOKEN.ne);
      }
    }
    if (first.type === PS_NODE.const) {
      const b = first.value;
      switch (op) {
        case TOKEN.add:
          if (b === 0) {
            return second;
          }
          break;
        case TOKEN.sub:
          if (b === 0) {
            return second;
          }
          break;
        case TOKEN.mul:
          if (b === 1) {
            return second;
          }
          if (b === 0) {
            return first;
          }
          if (b === -1) {
            return this._makeUnary(TOKEN.neg, second);
          }
          break;
        case TOKEN.div:
          if (b !== 0) {
            return this._makeBinary(TOKEN.mul, new PsConstNode(1 / b), second);
          }
          break;
        case TOKEN.idiv:
          if (b === 1) {
            return second;
          }
          break;
        case TOKEN.exp:
          if (b === 1) {
            return second;
          }
          if (b === -1) {
            return this._makeBinary(TOKEN.div, second, new PsConstNode(1));
          }
          if (b === 0.5) {
            return this._makeUnary(TOKEN.sqrt, second);
          }
          if (b === 0.25) {
            const sqrtOnce = this._makeUnary(TOKEN.sqrt, second);
            return this._makeUnary(TOKEN.sqrt, sqrtOnce);
          }
          if (b === 2) {
            return this._makeBinary(TOKEN.mul, second, second);
          }
          if (b === 3) {
            return this._makeBinary(TOKEN.mul, this._makeBinary(TOKEN.mul, second, second), second);
          }
          if (b === 4) {
            const square = this._makeBinary(TOKEN.mul, second, second);
            return this._makeBinary(TOKEN.mul, square, square);
          }
          if (b === 0) {
            return new PsConstNode(1);
          }
          break;
        case TOKEN.and:
          if (b === true) {
            return second;
          }
          if (b === false) {
            return first;
          }
          break;
        case TOKEN.or:
          if (b === false) {
            return second;
          }
          if (b === true) {
            return first;
          }
          break;
        case TOKEN.min:
          if (second.type === PS_NODE.binary && second.op === TOKEN.max && second.first.type === PS_NODE.const && second.first.value >= b) {
            return first;
          }
          break;
        case TOKEN.max:
          if (second.type === PS_NODE.binary && second.op === TOKEN.min && second.first.type === PS_NODE.const && second.first.value <= b) {
            return first;
          }
          break;
      }
    }
    if (second.type === PS_NODE.const) {
      const a = second.value;
      switch (op) {
        case TOKEN.add:
          if (a === 0) {
            return first;
          }
          break;
        case TOKEN.sub:
          if (a === 0) {
            return this._makeUnary(TOKEN.neg, first);
          }
          break;
        case TOKEN.mul:
          if (a === 1) {
            return first;
          }
          if (a === 0) {
            return second;
          }
          if (a === -1) {
            return this._makeUnary(TOKEN.neg, first);
          }
          break;
        case TOKEN.and:
          if (a === true) {
            return first;
          }
          if (a === false) {
            return second;
          }
          break;
        case TOKEN.or:
          if (a === false) {
            return first;
          }
          if (a === true) {
            return second;
          }
          break;
      }
    }
    return this._checkDepth(new PsBinaryNode(op, first, second, _binaryValueType(op, first.valueType, second.valueType)));
  }
  _makeUnary(op, operand) {
    if (operand.type === PS_NODE.const) {
      const v = _evalUnaryConst(op, operand.value);
      if (v !== undefined) {
        return new PsConstNode(v);
      }
    }
    if (op === TOKEN.not && operand.type === PS_NODE.binary) {
      const negated = PSStackToTree.#negatedComparison.get(operand.op);
      if (negated !== undefined) {
        return new PsBinaryNode(negated, operand.first, operand.second, PS_VALUE_TYPE.boolean);
      }
    }
    if (op === TOKEN.neg && operand.type === PS_NODE.binary && operand.op === TOKEN.sub) {
      return this._makeBinary(TOKEN.sub, operand.second, operand.first);
    }
    if (operand.type === PS_NODE.unary) {
      if (op === TOKEN.neg && operand.op === TOKEN.neg || op === TOKEN.not && operand.op === TOKEN.not) {
        return operand.operand;
      }
      if (op === TOKEN.abs && operand.op === TOKEN.neg) {
        return this._makeUnary(TOKEN.abs, operand.operand);
      }
      if (PSStackToTree.#idempotentUnary.has(op) && op === operand.op) {
        return operand;
      }
    }
    return this._checkDepth(new PsUnaryNode(op, operand, _unaryValueType(op, operand.valueType)));
  }
  _makeTernary(cond, then, otherwise) {
    if (cond.type === PS_NODE.const) {
      return cond.value ? then : otherwise;
    }
    if (this._nodesEqual(then, otherwise)) {
      return then;
    }
    if (then.type === PS_NODE.const && otherwise.type === PS_NODE.const) {
      if (then.value === true && otherwise.value === false) {
        return cond;
      }
      if (then.value === false && otherwise.value === true) {
        return this._makeUnary(TOKEN.not, cond);
      }
    }
    if (cond.type === PS_NODE.binary) {
      const {
        op: cop,
        first: cf,
        second: cs
      } = cond;
      if (cop === TOKEN.gt || cop === TOKEN.ge) {
        if (this._nodesEqual(then, cf) && this._nodesEqual(otherwise, cs)) {
          return this._makeBinary(TOKEN.min, cf, cs);
        }
        if (this._nodesEqual(then, cs) && this._nodesEqual(otherwise, cf)) {
          return this._makeBinary(TOKEN.max, cf, cs);
        }
      } else if (cop === TOKEN.lt || cop === TOKEN.le) {
        if (this._nodesEqual(then, cf) && this._nodesEqual(otherwise, cs)) {
          return this._makeBinary(TOKEN.max, cf, cs);
        }
        if (this._nodesEqual(then, cs) && this._nodesEqual(otherwise, cf)) {
          return this._makeBinary(TOKEN.min, cf, cs);
        }
      }
    }
    return this._checkDepth(new PsTernaryNode(cond, then, otherwise, then.valueType === otherwise.valueType ? then.valueType : PS_VALUE_TYPE.unknown));
  }
}
export { parsePostScriptFunction, Parser, PS_NODE, PS_VALUE_TYPE, PsArgNode, PsBinaryNode, PsBlock, PsConstNode, PsIf, PsIfElse, PsNode, PsNumber, PsOperator, PsProgram, PSStackToTree, PsTernaryNode, PsUnaryNode };
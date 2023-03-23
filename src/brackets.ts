import * as vscode from "vscode"

const pairs = {
    "{": "}",
    "[": "]",
    "(": ")",
    "<": ">",
    "/": "/",
    "\"": "\"",
    "'": "'",
    "`": "`",
    "/*": "*/",
    "${": "}"
}

interface Brackets {
    char: "[" | "{" | "<" | "(" | "'" | '"' | "`" | "//" | "/*" | "${" | "/"
    start: number
    end?: number
}
type Mode =
    | "singleLineComment"
    | "multiLineComment"
    | "singleQuoteString"
    | "doubleQuoteString"
    | "backtickString"
    | "code"
    | "regex"
    | "tag"

const r =
    /(?:\\\/|>=|<=|=>|\\`|\\"|\\'|\\\\|\/\/|\/\*|\*\/|\$\{|\n|[(){}<>'"`\/\[\]])/g

class BracketMatcher {
    private b: Brackets[]
    constructor(b: Brackets[], private editor: vscode.TextEditor) {
        this.b = b.sort((a, b) => a.start - b.start)
    }

    getNextPeerBracket(cursor: vscode.Position, chars: Brackets["char"][]): Brackets | undefined {
        const bracket = this.getBracketEnclosingCursor(cursor, chars, true)
        if (!bracket) {
            return this.b.find(b => chars.includes(b.char) && this.editor.document.positionAt(b.start).compareTo(cursor) > 0)
        }
        const next = this.b.find(b => b.char === bracket.char && b.start > bracket.end!)
        if (!next) {
            return this.b.find(b => b.char === bracket.char && b.start > bracket.start && this.editor.document.positionAt(b.start).compareTo(cursor) > 0)
        }
        return next
    }


    getPrevPeerBracket(cursor: vscode.Position, chars: Brackets["char"][]): Brackets | undefined {
        const bracket = this.getBracketEnclosingCursor(cursor, chars, true)
        const b = this.b.slice().sort((a, b) => a.end! - b.end!)
        if (!bracket) {
            for (let i = b.length - 1; i >= 0; --i) {
                const br = b[i]
                if (chars.includes(br.char) && this.editor.document.positionAt(br.end!).compareTo(cursor) < 0) {
                    return br
                }
            }
            return undefined
        }

        for (let i = b.length - 1; i >= 0; --i) {
            const br = b[i]
            if (br.char === bracket.char && br.end! < bracket.start) {
                return br
            }
        }
        for (let i = b.length - 1; i >= 0; --i) {
            const br = b[i]
            if (br.char === bracket.char && br.start > bracket.start && this.editor.document.positionAt(br.start).compareTo(cursor) < 0) {
                return br
            }
        }
        return undefined
    }

    getBracketEnclosingCursor(
        cursor: vscode.Position,
        openingChars: Brackets["char"][],
        mustBeInside: boolean,
        mustBeImmediate: boolean = false
    ): Brackets | undefined {
        const text = this.editor.document.lineAt(cursor).text
        const closingChars = openingChars.map(ch => pairs[ch as keyof typeof pairs])
        const char = text.charAt(cursor.character) as Brackets["char"]
        const nextContains = [...openingChars, ...closingChars].includes(char)
        const prevContains = !nextContains && cursor.character > 0 && closingChars.includes(text.charAt(cursor.character - 1))
        const offset = this.editor.document.offsetAt(cursor) + (!mustBeInside && (prevContains ? -1 : openingChars.includes(char) ? 1 : 0) || 0)
        const b = this.b.filter(v => v.start < offset && v.end! > offset)

        if (mustBeImmediate) {
            const bracket = b.at(-1)
            if (!openingChars.includes(bracket?.char as any)) {
                return undefined
            }
            return bracket
        }

        while (b.length > 0) {
            const bracket = b.pop()!
            if (openingChars.includes(bracket.char)) {
                return bracket
            }
        }
        return undefined
    }
}

export function parseBrackets(string: string, editor: vscode.TextEditor): BracketMatcher {
    const stack: Brackets[] = []
    const ret: Brackets[] = []
    let m: ReturnType<RegExp["exec"]>
    let mode: Mode = "code"
    while ((m = r.exec(string))) {
        if (mode === "regex") {
            if (m[0] === "/") {
                const com = stack.pop()!

                com.end = r.lastIndex
                ret.push(com)
                mode = "code"
            }
        } else if (mode === "singleLineComment") {
            if (m[0] === "\n") {
                const com = stack.pop()!

                com.end = r.lastIndex
                ret.push(com)
                mode = "code"
            }
        } else if (mode === "multiLineComment") {
            if (m[0] === "*/") {
                const com = stack.pop()!

                com.end = r.lastIndex
                ret.push(com)
                mode = "code"
            }
        } else if (mode === "singleQuoteString") {
            if (m[0] === "'") {
                const str = stack.pop()!

                str.end = r.lastIndex
                ret.push(str)
                mode = "code"
            }
        } else if (mode === "doubleQuoteString") {
            if (m[0] === '"') {
                const str = stack.pop()!

                str.end = r.lastIndex
                ret.push(str)
                mode = "code"
            }
        } else if (mode === "backtickString") {
            if (m[0] === "`") {
                const str = stack.pop()!

                str.end = r.lastIndex
                ret.push(str)
                mode = "code"
            } else if (m[0] === "${") {
                const b: Brackets = {
                    start: r.lastIndex - 2,
                    char: "${",
                }
                stack.push(b)
                mode = "code"
            }
        } else {

            if (m[0] === "}") {
                const b = stack.pop()
                if (b && (b.char === "{" || b?.char === "${")) {
                    b.end = r.lastIndex
                    ret.push(b)
                    if (stack.length > 0 && stack[stack.length - 1].char === "`") {
                        mode = "backtickString"
                    }
                } else if (b) {
                    stack.push(b)
                }

            } else if (m[0] === "{") {
                stack.push({
                    start: r.lastIndex - 1,
                    char: "{"
                })
            } else if (m[0] === "//") {
                stack.push({
                    start: r.lastIndex - 2,
                    char: "//",
                })
                mode = "singleLineComment"
            } else if (m[0] === "/*") {
                stack.push({
                    start: r.lastIndex - 2,
                    char: "/*",
                })
                mode = "multiLineComment"
            } else if (m[0] === "'") {
                stack.push({
                    start: r.lastIndex - 1,
                    char: "'",
                })
                mode = "singleQuoteString"
            } else if (m[0] === '"') {
                stack.push({
                    start: r.lastIndex - 1,
                    char: '"',
                })
                mode = "doubleQuoteString"
            } else if (m[0] === "`") {
                stack.push({
                    start: r.lastIndex - 1,
                    char: "`",
                })
                mode = "backtickString"
            } else if (m[0] === "/" && !(/\s/.test(string.charAt(r.lastIndex)))) {
                stack.push({
                    start: r.lastIndex - 1,
                    char: "/",
                })
                mode = "regex"
            } else if (m[0] === "[") {
                stack.push({
                    start: r.lastIndex - 1,
                    char: "[",
                })
            } else if (m[0] === "]") {
                const b = stack.pop()
                if (b && b.char === "[") {
                    b.end = r.lastIndex
                    ret.push(b)
                } else if (b) {
                    stack.push(b)
                }
            } else if (m[0] === "(") {
                stack.push({
                    start: r.lastIndex - 1,
                    char: "(",
                })
            } else if (m[0] === ")") {
                const b = stack.pop()
                if (b && b.char === "(") {
                    b.end = r.lastIndex
                    ret.push(b)
                } else if (b) {
                    stack.push(b)
                }
            } else if (
                m[0] === "<" &&
                /[a-zA-Z$_{\["]/.test(string.charAt(r.lastIndex))
            ) {
                stack.push({
                    start: r.lastIndex - 1,
                    char: "<",
                })
            } else if (m[0] === ">") {
                const b = stack.pop()
                if (b && b.char === "<") {
                    b.end = r.lastIndex
                    ret.push(b)
                } else if (b) {
                    stack.push(b)
                }
            }
        }
    }
    return new BracketMatcher(ret, editor)
}

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
    closeTagName?: string
    openTagName?: string
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
    /(?:\/=|\\\/|>=|<=|=>|<\/|\/>|\\`|\\"|\\'|\\\\|\/\/|\/\*|\*\/|\$\{|\n|[(){}<>'"`\/\[\]])/g

export class BracketMatcher {
    private b: Brackets[]
    private bb: Brackets[] | undefined
    constructor(b: Brackets[], private editor: vscode.TextEditor) {
        this.b = b.sort((a, b) => a.start - b.start)
    }

    getNextPeerBracket(cursor: vscode.Position, chars: Brackets["char"][]): Brackets | undefined {
        const offset = this.editor.document.offsetAt(cursor)
        return this.b.find(b => b.start > offset && chars.includes(b.char))
    }


    getPrevPeerBracket(cursor: vscode.Position, chars: Brackets["char"][]): Brackets | undefined {
        const offset = this.editor.document.offsetAt(cursor)
        if (!this.bb) {
            this.bb = this.b.slice().sort((a, b) => a.end! - b.end!)
        }
        const b = this.bb
        for (let i = b.length - 1; i >= 0; --i) {
            const br = b[i]
            if (br.end! <= offset && chars.includes(br.char)) {
                return br
            }
        }
    }

    getTagEnclosingCursor(cursor: vscode.Position, tagName?: string): [Brackets, Brackets] | undefined {
        const offset = this.editor.document.offsetAt(cursor)
        if (!this.bb) {
            this.bb = this.b.slice().sort((a, b) => a.end! - b.end!)
        }
        const b = this.bb
        let openingTag: Brackets | undefined
        for (let i = b.length - 1; i >= 0; --i) {
            const br = b[i]
            if (br.start < offset && br.openTagName !== undefined) {
                openingTag = br
                break
            }
        }
        if (!openingTag) {
            return undefined
        }
        const closingTag = this.b.find(b => b.end! > offset && b.closeTagName === openingTag!.openTagName)
        if (openingTag && closingTag) {
            return [openingTag, closingTag]
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

let dirty = false
let matcher: BracketMatcher | null = null
export function initializeBrackets() {
    vscode.window.onDidChangeActiveTextEditor(() => {
        dirty = true
    })
    vscode.workspace.onDidChangeTextDocument(() => {
        dirty = true
    })
}

export function parseBrackets(string: string, editor: vscode.TextEditor): BracketMatcher {
    if (dirty) {
        dirty = false
        matcher = null
    }
    if (matcher) {
        return matcher
    }
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
            } else if (m[0] === "</") {
                const closeTagName = string.slice(r.lastIndex, string.indexOf(">", r.lastIndex))
                stack.push({
                    start: r.lastIndex - 2,
                    char: "<",
                    closeTagName
                })
            } else if (m[0] === "/>") {
                const b = stack.pop()
                if (b && b.char === "<") {
                    b.end = r.lastIndex
                    ret.push(b)
                } else if (b) {
                    stack.push(b)
                }
            } else if (
                m[0] === "<" &&
                /[a-zA-Z$_{\[">]/.test(string.charAt(r.lastIndex))
            ) {
                stack.push({
                    start: r.lastIndex - 1,
                    char: "<",
                })
            } else if (m[0] === ">") {
                const matches = /[a-zA-Z$_}\]"<\/]/.test(string.charAt(r.lastIndex - 2))
                if (!matches) {
                    const pos = editor.document.positionAt(r.lastIndex - 1)
                    const line = editor.document.lineAt(pos.line)
                    if (line.firstNonWhitespaceCharacterIndex !== pos.character) {
                        continue
                    }
                }
                const b = stack.pop()
                if (b && b.char === "<") {
                    b.end = r.lastIndex
                    const regex = /^<([a-zA-Z$_0-9]+)/
                    const match = regex.exec(string.slice(b.start, b.end!))
                    if (match) {
                        b.openTagName = match[1]
                    }
                    ret.push(b)
                } else if (b) {
                    stack.push(b)
                }
            }
        }
    }
    matcher = new BracketMatcher(ret, editor)
    return matcher
}

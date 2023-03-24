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
        if (!this.bb) {
            this.bb = this.b.slice().sort((a, b) => a.end! - b.end!)
        }
        const b = this.bb
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

    getTagEnclosingCursor(cursor: vscode.Position, tagName?: string): [Brackets, Brackets] | undefined {
        const offset = this.editor.document.offsetAt(cursor)
        const closingTag = this.b.find(b => b.start >= offset && b.closeTagName !== undefined && (tagName !== undefined ? b.closeTagName === tagName : true))
        if (!closingTag) {
            return undefined
        }
        if (!this.bb) {
            this.bb = this.b.slice().sort((a, b) => a.end! - b.end!)
        }
        const b = this.bb
        let openingTag: Brackets | undefined
        for (let i = b.length - 1; i >= 0; --i) {
            const br = b[i]
            if (br.end! <= offset && br.char === "<") {
                const start = this.editor.document.positionAt(br.start + 1)
                const end = this.editor.document.positionAt(br.end!)
                const text = this.editor.document.getText(new vscode.Range(start, end))
                if (text.startsWith(closingTag.closeTagName!)) {
                    openingTag = br
                    break
                }
            }
        }
        if (openingTag) {
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

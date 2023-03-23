import * as vscode from "vscode";
import { BracketMatcher, parseBrackets } from "./brackets";

interface BracketLocation {
    regex: RegExp
    index: number
}

const pairs = {
    "}": "{",
    "]": "[",
    ">": "<",
    ")": "("
}

class Brackets {
    private constructor(private editor: vscode.TextEditor, private lineNumber: number, private locations: BracketLocation[], private cursor: vscode.Position) { }

    static create(editor: vscode.TextEditor, cursor: vscode.Position, match: Exclude<ReturnType<RegExp["exec"]>, null>) {
        const line = match[1] ? cursor.line + parseInt(match[1] + match[2], 10) : parseInt(match[2], 10) - 1
        const rloc = /([rtgbs])(\d*)/g
        const locations: BracketLocation[] = []
        let m
        const txt = match[3]
        while (m = rloc.exec(txt)) {
            const ch = m[1]
            const index = m[2] ? parseInt(m[2], 10) - 1 : 0
            switch (ch) {
                case "r":
                    locations.push({
                        regex: /[()]/g,
                        index
                    })
                    break
                case "t":
                    locations.push({
                        regex: /[\[\]]/g,
                        index
                    })
                    break
                case "g":
                    locations.push({
                        regex: /[<>]/g,
                        index
                    })
                    break
                case "b":
                    locations.push({
                        regex: /[{}]/g,
                        index
                    })
                case "s":
                    locations.push({
                        regex: /["'`]/g,

                        index
                    })

            }
        }
        return new Brackets(editor, line, locations, cursor)
    }

    private getRanges(matcher: BracketMatcher): vscode.Range[] {
        const text = this.editor.document.lineAt(this.lineNumber).text
        const ret: vscode.Range[] = []
        for (const loc of this.locations) {
            const m = [...text.matchAll(loc.regex)]
            if (m && m[loc.index]) {
                const ch = m[loc.index][0]
                let bracket: string = ch
                let addToCharacter = 1
                if (/[\])}>]/.test(ch)) {
                    bracket = pairs[ch as keyof typeof pairs]
                    addToCharacter = 0
                }
                const character = m[loc.index].index! + addToCharacter
                const pos = new vscode.Position(this.lineNumber, character)
                const enclosingBracket = matcher.getBracketEnclosingCursor(pos, [bracket as any], true, true)
                if (enclosingBracket) {
                    const range = new vscode.Range(this.editor.document.positionAt(enclosingBracket.start), this.editor.document.positionAt(enclosingBracket.end!))
                    ret.push(range)
                }
            }
        }
        return ret
    }

    paste(matcher: BracketMatcher, eb: vscode.TextEditorEdit) {
        const ranges = this.getRanges(matcher)
        if (ranges.length > 0) {
            return [this.cursor, ranges.map(v => this.editor.document.getText(v)).join(" ")] as [vscode.Position, string]
        }
    }

    delete(matcher: BracketMatcher, eb: vscode.TextEditorEdit) {
        const ranges = this.getRanges(matcher)
        if (ranges.length > 0) {
            return ranges
        }
    }
}

export function initializeTypedExpressionCommands() {
    const rBrackets = /([-+]?)(\d+)((?:[rtgbs]\d*)+)$/
    //const rLines = /([-+]?)(\d+)([-+]?)(\d+)$/
    //const rParagraphs = /([-+]?)(\d+)p$/

    vscode.commands.registerTextEditorCommand("extension.multiCommand.execExpressionCommand", (editor, eb, args) => {
        const toDelete: vscode.Range[] = []
        const toInsert: [vscode.Position, string][] = []
        editor.selections.forEach(sel => {
            if (sel.active.compareTo(sel.anchor) !== 0) {
                return
            }
            const cursor = sel.active
            const text = editor.document.lineAt(cursor.line).text.slice(0, cursor.character)
            const bracketMatch = rBrackets.exec(text)
            if (bracketMatch) {
                const brackets = Brackets.create(editor, cursor, bracketMatch)
                const action = args?.action ?? "paste"
                const matcher = parseBrackets(editor.document.getText(), editor)
                switch (action) {
                    case "paste": {
                        const r = brackets.paste(matcher, eb)
                        if (r) {
                            toInsert.push(r)
                            toDelete.push(new vscode.Range(cursor.line, cursor.character - bracketMatch[0].length, cursor.line, cursor.character))
                        }
                        break
                    }
                    case "delete": {
                        const r = brackets.delete(matcher, eb)
                        if (r) {
                            toDelete.push(...r)
                            toDelete.push(new vscode.Range(cursor.line, cursor.character - bracketMatch[0].length, cursor.line, cursor.character))
                        }
                        break
                    }
                }
                return
            }
        })
        toDelete.forEach(d => eb.delete(d))
        toInsert.forEach(d => eb.insert(d[0], d[1]))
    })
}

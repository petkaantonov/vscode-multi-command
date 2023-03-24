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
    private constructor(private editor: vscode.TextEditor, private lineNumber: number, private locations: BracketLocation[], private cursor: vscode.Position, private unwrap: boolean) { }

    static create(editor: vscode.TextEditor, cursor: vscode.Position, match: Exclude<ReturnType<RegExp["exec"]>, null>) {
        const line = match[1] ? cursor.line + parseInt(match[1] + match[2], 10) : parseInt(match[2], 10) - 1
        const rloc = /([rtgbs])(\d*)/g
        const locations: BracketLocation[] = []
        let m
        const txt = match[3]
        const unwrap = match[4] === "u"
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
        return new Brackets(editor, line, locations, cursor, unwrap)
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
                    const range = new vscode.Range(this.editor.document.positionAt(enclosingBracket.start + (this.unwrap ? 1 : 0)), this.editor.document.positionAt(enclosingBracket.end! - (this.unwrap ? 1 : 0)))
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

class Lines {
    private constructor(private editor: vscode.TextEditor, private lineNumbers: [number, number], private cursor: vscode.Position) {

    }

    static create(editor: vscode.TextEditor, cursor: vscode.Position, match: Exclude<ReturnType<RegExp["exec"]>, null>) {
        const line = match[1] ? cursor.line + parseInt(match[1] + match[2], 10) : parseInt(match[2], 10) - 1
        const toLine = match[3] === "-" ? parseInt(match[4], 10) - 1 : match[3] === "+" ? line + parseInt(match[4], 10) : line
        return new Lines(editor, [line, toLine], cursor)
    }

    paste( eb: vscode.TextEditorEdit) {
        let firstLine = this.lineNumbers[0],
            firstCharacter =  this.editor.document.lineAt(firstLine).firstNonWhitespaceCharacterIndex,
            lastLine = this.lineNumbers[1]
        
        const range = new vscode.Range(firstLine, firstCharacter, lastLine, this.editor.document.lineAt(lastLine).range.end.character)
        return [this.cursor, this.editor.document.getText(range)] as [vscode.Position, string]
    }


}

export function initializeTypedExpressionCommands() {
    const rBrackets = /([-+]?)(\d+)((?:[rtgbs]\d*)+)(u?)$/
    const rLines = /([-+]?)(\d+)([-+]?)(\d*)$/
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
            } else {
                const linesMatch = rLines.exec(text)
                if (linesMatch) {
                    const lines = Lines.create(editor, cursor, linesMatch)
                    const action = args?.action ?? "paste"
                    if (action === "paste") {
                        const l = lines.paste(eb)
                        if (l) {
                            toInsert.push(l)
                            toDelete.push(new vscode.Range(cursor.line, cursor.character - linesMatch[0].length, cursor.line, cursor.character))
                        }
                    }
                }
            }
        })

        const uniq = Object.fromEntries(toDelete.map(r => [`${r.start.line}-${r.start.character}-${r.end.line}-${r.end.character}`, r]))
        Object.values(uniq).forEach(d => eb.delete(d))
        toInsert.forEach(d => eb.insert(d[0], d[1]))
    })
}

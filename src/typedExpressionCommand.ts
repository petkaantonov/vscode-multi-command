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

    paste(matcher: BracketMatcher) {
        const ranges = this.getRanges(matcher)
        if (ranges.length > 0) {
            return [this.cursor, ranges.map(v => this.editor.document.getText(v)).join(" ")] as [vscode.Position, string]
        }
    }

    delete(matcher: BracketMatcher) {
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

    paste() {
        let firstLine = this.lineNumbers[0],
            firstCharacter = this.editor.document.lineAt(firstLine).firstNonWhitespaceCharacterIndex,
            lastLine = this.lineNumbers[1]

        const range = new vscode.Range(firstLine, firstCharacter, lastLine, this.editor.document.lineAt(lastLine).range.end.character)
        return [this.cursor, this.editor.document.getText(range)] as [vscode.Position, string]
    }


}

class Tags {
    constructor(private editor: vscode.TextEditor, private cursor: vscode.Position, private line: number, private unwrap: boolean) { }

    paste(matcher: BracketMatcher): [vscode.Position, string] | undefined {
        const line = this.editor.document.lineAt(this.line)

        const tags = matcher.getTagEnclosingCursor(line.range.end)
        if (tags) {
            const start = this.unwrap ? this.editor.document.positionAt(tags[0].end!) : this.editor.document.positionAt(tags[0].start)
            const end = this.unwrap ? this.editor.document.positionAt(tags[1].start) : this.editor.document.positionAt(tags[1].end!)
            return [this.cursor, this.editor.document.getText(new vscode.Range(start, end))]
        }
    }
    static create(editor: vscode.TextEditor, cursor: vscode.Position, match: Exclude<ReturnType<RegExp["exec"]>, null>) {
        const line = match[1] ? cursor.line + parseInt(match[1] + match[2], 10) : parseInt(match[2], 10) - 1
        const unwrap = match[3] === "u"
        return new Tags(editor, cursor, line, unwrap)
    }
}

class Paragraphs {
    constructor(private editor: vscode.TextEditor, private cursor: vscode.Position, private line: number, private indentationBased: boolean) { }

    static create(editor: vscode.TextEditor, cursor: vscode.Position, match: Exclude<ReturnType<RegExp["exec"]>, null>) {
        const line = match[1] ? cursor.line + parseInt(match[1] + match[2], 10) : parseInt(match[2], 10) - 1
        const indentationBased = match[3] === "i"
        return new Paragraphs(editor, cursor, line, indentationBased)
    }

    paste(): [vscode.Position, string] | undefined {
        let startLine = this.line
        const nonWsIndex = this.editor.document.lineAt(startLine).firstNonWhitespaceCharacterIndex
        let docLine: vscode.TextLine
        while ((docLine = this.editor.document.lineAt(startLine)) &&
            (this.indentationBased ? docLine.firstNonWhitespaceCharacterIndex === nonWsIndex : docLine.isEmptyOrWhitespace) &&
            startLine > 0) {
            startLine--
        }
        let endLine = this.line
        while ((docLine = this.editor.document.lineAt(endLine)) &&
            (this.indentationBased ? docLine.firstNonWhitespaceCharacterIndex === nonWsIndex : docLine.isEmptyOrWhitespace) &&
            endLine < this.editor.document.lineCount) {
            endLine++
        }
        if (startLine === endLine) {
            return undefined
        }
        startLine++
        endLine--
        return [this.cursor, this.editor.document.getText(new vscode.Range(startLine, 0, endLine, this.editor.document.lineAt(endLine).range.end.character))]

    }
}

export function initializeTypedExpressionCommands() {
    const rBrackets = /([-+]?)(\d+)((?:[rtgbs]\d*)+)(u?)$/
    const rLines = /([-+]?)(\d+)([-+]?)(\d*)$/
    const rTags = /([-+]?)(\d+)h(u?)$/
    const rParagraphs = /([-+]?)(\d+)p(i?)$/

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
                        const r = brackets.paste(matcher)
                        if (r) {
                            toInsert.push(r)
                            toDelete.push(new vscode.Range(cursor.line, cursor.character - bracketMatch[0].length, cursor.line, cursor.character))
                        }
                        break
                    }
                    case "delete": {
                        const r = brackets.delete(matcher)
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
                        const l = lines.paste()
                        if (l) {
                            toInsert.push(l)
                            toDelete.push(new vscode.Range(cursor.line, cursor.character - linesMatch[0].length, cursor.line, cursor.character))
                        }
                    }
                } else {
                    const tagMatch = rTags.exec(text)
                    if (tagMatch) {
                        const tags = Tags.create(editor, cursor, tagMatch)
                        const action = args?.action ?? "paste"
                        const matcher = parseBrackets(editor.document.getText(), editor)
                        if (action === "paste") {
                            const t = tags.paste(matcher)
                            if (t) {
                                toInsert.push(t)
                                toDelete.push(new vscode.Range(cursor.line, cursor.character - tagMatch[0].length, cursor.line, cursor.character))
                            }
                        }
                    } else {
                        const paragraphMatch = rParagraphs.exec(text)
                        if (paragraphMatch) {
                            const paragraphs = Paragraphs.create(editor, cursor, paragraphMatch)
                            const action = args?.action ?? "paste"
                            if (action === "paste") {
                                const p = paragraphs.paste()
                                if (p) {
                                    toInsert.push(p)
                                    toDelete.push(new vscode.Range(cursor.line, cursor.character - paragraphMatch[0].length, cursor.line, cursor.character))
                                }
                            }
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

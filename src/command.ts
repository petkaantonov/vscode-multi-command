import * as vscode from "vscode";

const vscodeVariables = require('vscode-variables');
function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

interface Opts {
    exe: string
    args: object | undefined
    repeat: number
    onSuccess: Array<Command> | undefined
    onFail: Array<Command> | undefined
    variableSubstitution: boolean
    delayBefore: number | undefined
    delayAfter: number | undefined
    textSlotRegex: RegExp | undefined
    captureTextSlotRegex: RegExp | undefined
    skipIfTextSlotEmpty: boolean
    skipIfLastExecuted: number | undefined
    saveTextSlot: number | undefined
    escapeTextSlot: boolean
    reveal: boolean
    saveCursorSlot: number | undefined
}

export function trimSelection(sel: vscode.Selection, editor: vscode.TextEditor): vscode.Selection {
    const notWs = /\S/

    const [start, end] = sel.active.compareTo(sel.anchor) >= 0 ? [sel.anchor, sel.active] : [sel.active, sel.anchor]
    let startLine = -1
    let startCharacter = -1
    let endLine = -1
    let endCharacter = -1
    for (let i = start.line; i <= end.line; ++i) {
        const line = editor.document.lineAt(i)
        const sliceStart = i === start.line ? start.character : 0
        const sliceEnd = i === end.line ? end.character : undefined
        const text = line.text.slice(sliceStart, sliceEnd)
        const indexOffset = i === start.line ? start.character : 0
        if (notWs.test(text)) {
            startLine = i
            startCharacter = text.match(notWs)!.index! + indexOffset
            break
        }
    }
    for (let j = end.line; j >= start.line; --j) {
        const line = editor.document.lineAt(j)
        const sliceStart = j === start.line ? start.character : 0
        const sliceEnd = j === end.line ? end.character : undefined
        const text = line.text.slice(sliceStart, sliceEnd)
        const indexOffset = j === start.line ? start.character : 0
        if (notWs.test(text)) {
            endLine = j
            const match = text.match(/\s*$/)
            if (!match) {
                endCharacter = line.range.end.character
            } else {
                endCharacter = match.index! + indexOffset
            }
            break
        }
    }
    if (startLine !== -1 && endLine !== -1) {
        if (sel.active.compareTo(sel.anchor) >= 0) {
            return new vscode.Selection(startLine, startCharacter, endLine, endCharacter)
        } else {
            return new vscode.Selection(endLine, endCharacter, startLine, startCharacter)
        }
    } else {
        return sel
    }

}

export class Command {

    private captureTextSlotRegex: RegExp | undefined
    private exe: string
    private args: object | undefined
    private repeat: number
    private onSuccess: Array<Command> | undefined
    private onFail: Array<Command> | undefined
    private variableSubstitution: boolean
    readonly delayBefore: number | undefined
    readonly delayAfter: number | undefined
    private textSlotRegex: RegExp | undefined
    private skipIfTextSlotEmpty: boolean
    private skipIfLastExecuted: number | undefined
    private saveTextSlot: number | undefined
    private context: any
    private escapeTextSlot: boolean
    private reveal: boolean
    private saveCursorSlot: number | undefined

    constructor(opts: Opts, context: any) {
        this.captureTextSlotRegex = opts.captureTextSlotRegex
        this.exe = opts.exe
        this.args = opts.args
        this.repeat = opts.repeat
        this.onSuccess = opts.onSuccess
        this.onFail = opts.onFail
        this.variableSubstitution = opts.variableSubstitution
        this.delayBefore = opts.delayBefore
        this.delayAfter = opts.delayAfter
        this.textSlotRegex = opts.textSlotRegex
        this.skipIfTextSlotEmpty = opts.skipIfTextSlotEmpty
        this.skipIfLastExecuted = opts.skipIfLastExecuted
        this.saveTextSlot = opts.saveTextSlot
        this.context = context
        this.escapeTextSlot = opts.escapeTextSlot
        this.reveal = opts.reveal
        this.saveCursorSlot = opts.saveCursorSlot
    }

    private async exec(cmd: string, args?: any) {
        if (cmd === "workbench.action.files.revert" && this.context.wasDirty) {
            return
        }
        if (cmd.startsWith("#")) {
            const editor = vscode.window.activeTextEditor
            if (!editor) {
                throw new Error("no editor")
            }
            const document = editor.document

            if (cmd === "#goto" && args) {
                let line: number, character: number

                if (args.slot) {
                    const selections = (this.context[`savedCursorSlot${args.slot}`] || []).map((v: { line: number, character: number }) => new vscode.Selection(new vscode.Position(v.line, v.character), new vscode.Position(v.line, v.character)))
                    if (args.reveal && selections.length > 0) {
                        editor.revealRange(selections[0], vscode.TextEditorRevealType.InCenterIfOutsideViewport)
                    }
                    editor.selections = selections
                } else {
                    const num = parseInt(args.line, 10) - 1
                    let end = args.end ? document.lineAt(num).range.end.character : 0
                    end = args.match ? document.lineAt(num).text.indexOf(args.match) : end
                    end = args.match && end >= 0 && args.afterMatch ? end + args.match.length : end
                    line = num
                    character = end
                    let target = new vscode.Position(line, character)
                    target = document.validatePosition(target);
                    if (args.reveal) {
                        editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                    }
                    editor.selection = new vscode.Selection(target, target);
                }
            } else if (cmd === "#saveLinesTextSlot" && args.slot !== undefined) {
                let start = parseInt(args.from, 10) - 1
                let end = parseInt(args.to || 0, 10) - 1
                if (args.relativeAdd && +args.relativeAdd) {
                    end = start + args.relativeAdd
                }
                if (!args.to && !args.relativeAdd) {
                    end = start
                }
                let text = []
                if (end < start) {
                    end = start
                }

                if (args.noLeadingWhitespace) {
                    text.push(document.lineAt(start).text.trimStart())
                    start++
                }

                if (start <= end) {
                    do {
                        text.push(document.lineAt(start).text)
                        start++
                    } while (start <= end)
                }
                this.context[`savedSlot${args.slot}`] = text.join("\n")
            } else if (cmd === "#insert" && args.text !== undefined) {
                await editor.edit(eb => {
                    if (args.atLine) {
                        const pos = document.validatePosition(new vscode.Position(parseInt(args.atLine, 10) - 1, 0))
                        const range = new vscode.Range(pos, pos)
                        eb.replace(range, args.text)
                    } else {
                        editor.selections.forEach(sel => {
                            const range = sel.isEmpty ? document.getWordRangeAtPosition(sel.start) || sel : sel;
                            eb.replace(range, args.text)
                        })
                    }
                })
            } else if (cmd === "#selectLines" || cmd === "#emptyLines") {
                const count = (args.count && parseInt(args.count, 10)) || (args.to - args.from)
                const newSelections: vscode.Selection[] = []
                const callbacks: (() => Promise<boolean>)[] = []
                editor.selections.forEach(selection => {
                    const endLine = selection.active.line
                    const endChar = editor.document.lineAt(endLine).range.end.character
                    const endPos = document.validatePosition(new vscode.Position(endLine, endChar))

                    const startLine = endLine - count
                    const startChar = args.noLeadingWhitespace ? editor.document.lineAt(startLine).firstNonWhitespaceCharacterIndex : 0
                    const startPos = document.validatePosition(new vscode.Position(startLine, startChar))

                    if (cmd === "#selectLines") {
                        newSelections.push(new vscode.Selection(startPos, endPos));
                    } else {
                        callbacks.push(async () =>
                            editor.edit(eb => {
                                for (let i = startLine; i <= endLine; ++i) {
                                    if (args.keepWhiteSpace) {
                                        const line = editor.document.lineAt(i)
                                        const range = new vscode.Range(i, line.firstNonWhitespaceCharacterIndex, i, line.range.end.character)
                                        eb.delete(range)
                                    } else {
                                        eb.delete(editor.document.lineAt(i).range)
                                    }
                                }
                            })
                        )
                    }
                })
                if (newSelections.length > 0) {
                    editor.selections = newSelections
                }
                if (callbacks.length > 0) {
                    for (const cb of callbacks) {
                        await cb()
                    }
                }
            } else if (cmd === "#emptyLinesAbsolute") {
                let start = parseInt(args.from, 10) - 1
                let end = parseInt(args.to || 0, 10) - 1
                if (args.relativeAdd && +args.relativeAdd) {
                    end = start + args.relativeAdd
                }
                if (!args.to && !args.relativeAdd) {
                    end = start
                }
                if (end < start) {
                    end = start
                }

                await editor.edit(eb => {
                    for (let i = start; i <= end; ++i) {
                        eb.delete(editor.document.lineAt(i).range)
                    }
                })
            } else if (cmd === "#saveSelectSlot" || cmd === "#saveDeleteSlot") {
                const text = editor.selections.map(v => {
                    return editor.document.getText(v)
                }).join("\n")
                if (cmd === "#saveSelectSlot") {
                    this.context.saveSelectSlot(text)
                } else {
                    this.context.saveDeleteSlot(text)
                }
            } else if (cmd === "#trimSelection") {
                const newSelections = editor.selections.map(v => trimSelection(v, editor))
                const text = newSelections.map(v => {
                    return editor.document.getText(v)
                }).join("\n")
                this.context.saveSelectSlot(text)
                editor.selections = newSelections
            } else if (cmd === "#deleteLeft") {
                const rangesToDelete = editor.selections.map(sel => {
                    const [start, end] = sel.active.compareTo(sel.anchor) >= 0 ? [sel.anchor, sel.active] : [sel.active, sel.anchor]
                    const line = editor.document.lineAt(start.line)
                    return new vscode.Range(start.line, line.firstNonWhitespaceCharacterIndex, end.line, end.character)
                })

                const text = rangesToDelete.map(v => editor.document.getText(v)).join("\n")
                this.context.saveDeleteSlot(text)
                await editor.edit(eb => {
                    rangesToDelete.forEach(r => eb.delete(r))
                })
            } else if (cmd === "#deleteRigth") {
                const rangesToDelete = editor.selections.map(sel => {
                    const [start, end] = sel.active.compareTo(sel.anchor) >= 0 ? [sel.anchor, sel.active] : [sel.active, sel.anchor]
                    const line = editor.document.lineAt(start.line)
                    return new vscode.Range(start.line, start.character, end.line, line.range.end.character)
                })

                const text = rangesToDelete.map(v => editor.document.getText(v)).join("\n")
                this.context.saveDeleteSlot(text)
                await editor.edit(eb => {
                    rangesToDelete.forEach(r => eb.delete(r))
                })
            }
        } else {
            if (!cmd.includes("executePrevious")) {
                this.context.previousCommand = { cmd, args }
            }
            await vscode.commands.executeCommand(cmd, args)
        }
    }

    public async execute() {
        if (this.skipIfLastExecuted !== undefined && this.context.lastExecuted !== undefined && Date.now() - this.context.lastExecuted < this.skipIfLastExecuted) {
            return;
        }

        try {

            if (this.args) {
                let args;
                if (this.variableSubstitution) {
                    args = this.substituteVariables(this.args);
                } else {
                    args = this.args;
                }
                const ref = { skip: false }
                args = this.replaceLoadSlots(args, ref)
                if (ref.skip) {
                    return
                }

                for (let i = 0; i < this.repeat; i++) {
                    (await this.exec(this.exe, args)) as any
                }
            } else {
                for (let i = 0; i < this.repeat; i++) {
                    (await this.exec(this.exe)) as any
                }
            }
            const editor = vscode.window.activeTextEditor!
            if (this.saveTextSlot !== undefined) {
                this.context[`savedSlot${this.saveTextSlot}`] = editor.document.getText(
                    new vscode.Range(editor.selections[0].start,
                        editor.selections[0].end)
                )

            }
            if (this.saveCursorSlot) {
                this.context[`savedCursorSlot${this.saveCursorSlot}`] = editor.selections.map(v => ({ line: v.active.line, character: v.active.character }))
            }
            if (this.onSuccess) {
                for (let command of this.onSuccess) {
                    await command.execute();
                }
            }
            if (this.reveal) {
                editor.revealRange(new vscode.Range(editor.selection.active, editor.selection.anchor), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
            }
        } catch (e) {
            if (this.onFail) {
                for (let command of this.onFail) {
                    await command.execute();
                }
            } else {
                console.log((e as any).stack)
                throw (e);
            }
        }
    }

    private replaceLoadSlots(args: any, ref: { skip: boolean }): any {
        if (typeof args === 'string') {
            args = args.replace(/!loadTextSlot\(([\d]+)(:\d+)?\)/g, (_m, m1, m2) => {
                const slot = this.context[`savedSlot${m1}`] || ""
                const ret = this.textSlotRegex ? slot.replace(this.textSlotRegex, "") : slot
                if (this.skipIfTextSlotEmpty && !ret) {
                    ref.skip = true
                }
                if (m2 && this.captureTextSlotRegex) {
                    const group = parseInt(m2.replace(":", ""), 10)
                    const m = this.captureTextSlotRegex.exec(slot)
                    if (m && m[group]) {
                        return this.escapeTextSlot ? escapeRegExp(m[group]) : m[group]
                    } else {
                        if (this.skipIfTextSlotEmpty) {
                            ref.skip = true
                        }
                        return ""
                    }
                }
                return this.escapeTextSlot ? escapeRegExp(ret) : ret
            })
            if (/^[0-9]+$/.test(args)) {
                return parseInt(args, 10)
            }
            return args
        } else if (typeof args === 'object') {
            let rt: any = {};
            for (const key of Object.keys(args)) {
                rt[key] = this.replaceLoadSlots(args[key], ref);
            }
            return rt;
        } else {
            return args;
        }
    }

    private substituteVariables(args: any): any {
        if (typeof args === 'string') {
            args = args.replace(/\${userHome}/g, process.env['HOME'] || '');
            return vscodeVariables(args);
        } else if (typeof args === 'object') {
            let rt: any = {};
            for (const key of Object.keys(args)) {
                rt[key] = this.substituteVariables(args[key]);
            }
            return rt;
        } else {
            return args;
        }
    }

}

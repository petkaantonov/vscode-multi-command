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
        console.log("exec", cmd, args)
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
                    void ({ line, character } = this.context[`savedCursorSlot${args.slot}`]) || { line: 0, character: 0 }
                } else {
                    const num = parseInt(args.line, 10) - 1
                    let end = args.end ? document.lineAt(num).range.end.character : 0
                    end = args.match ? document.lineAt(num).text.indexOf(args.match) : end
                    end = args.match && end >= 0 && args.afterMatch ? end + args.match.length : end
                    line = num
                    character = end
                }
                let target = new vscode.Position(line, character)
                target = document.validatePosition(target);
                if (args.reveal) {
                    editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                }
                editor.selection = new vscode.Selection(target, target);
            } else if (cmd === "#saveLinesTextSlot" && args.slot !== undefined) {
                let start = parseInt(args.from, 10) - 1
                let end =  parseInt(args.to || 0, 10) - 1
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
                do {
                    text.push(document.lineAt(start).text)
                    start++
                } while (start <= end)
                this.context[`savedSlot${args.slot}`] = text.join("\n")
            } else if (cmd === "#insert" && args.text !== undefined) {
                await editor.edit(eb => {
                    editor.selections.forEach(sel => {
                        const range = sel.isEmpty ? document.getWordRangeAtPosition(sel.start) || sel : sel;
                        eb.replace(range, args.text)
                    })
                })
            } else if (cmd === "#selectLines") {
                const count = (args.count && parseInt(args.count, 10)) || (args.to - args.from)
                const endLine = editor.selection.active.line
                const endChar = editor.document.lineAt(endLine).range.end.character
                const endPos = document.validatePosition(new vscode.Position(endLine, endChar))

                const startLine = endLine - count
                const startPos = document.validatePosition(new vscode.Position(startLine, 0))

                editor.selection = new vscode.Selection(startPos, endPos);
            }
        } else {
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
                    await this.exec(this.exe, args)
                }
            } else {
                for (let i = 0; i < this.repeat; i++) {
                    await this.exec(this.exe)
                }
            }
            const editor = vscode.window.activeTextEditor!
            if (this.saveTextSlot !== undefined) {
                this.context[`savedSlot${this.saveTextSlot}`] = editor.document.getText(
                    new vscode.Range(editor.selection.start,
                        editor.selection.end)
                )

            }
            if (this.saveCursorSlot) {
                this.context[`savedCursorSlot${this.saveCursorSlot}`] = {
                    line: editor.selection.active.line,
                    character: editor.selection.active.character
                }
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

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below


import * as vscode from "vscode";
import { parseBrackets } from "./brackets";
import { Command, trimSelection } from "./command";
import { initializeCursorHistory } from "./cursorHistory";
import { MultiCommand } from "./multiCommand";
import { initializeTypedExpressionCommands } from "./typedExpressionCommand";

type CommandSequence = Array<string | ComplexCommand>;

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

let timer: any;
function debounce(func: any, timeout = 100) {
    return function () {
        clearTimeout(timer);
        //@ts-ignore
        timer = setTimeout(func, timeout);
    };
}

interface CommandSettings {
    label: string;
    description: string;
    interval: number;
    sequence: CommandSequence;
    languages: Array<string>;
}

interface CommandSettingsWithKey extends CommandSettings {
    command: string;
}

interface CommandMap {
    [key: string]: CommandSettings;
}

interface ComplexCommand {
    command: string;
    args: object;
    repeat: number;
    delayBefore: number | undefined
    delayAfter: number | undefined
    onSuccess: CommandSequence | undefined;
    onFail: CommandSequence | undefined;
    variableSubstitution: boolean;
    textSlotRegex: string | undefined
    captureTextSlotRegex: string | undefined
    skipIfTextSlotEmpty: boolean | undefined
    skipIfLastExecuted: number | undefined
    saveTextSlot: number | undefined
    saveCursorSlot: number | undefined
    reveal: boolean | undefined
    escapeTextSlot: boolean | undefined
}

function implementsCommandMap(arg: any): arg is CommandSettings {
    return arg !== null && typeof arg === "object";
}

function createMultiCommand(
    id: string,
    settings: CommandSettings,
    context: any
): MultiCommand {
    const label = settings.label;
    const description = settings.description;
    const interval = settings.interval;
    const languages = settings.languages;

    function createCommand(command: string | ComplexCommand): Command {
        let exe: string;
        let args: object | undefined;
        let repeat: number = 1;
        let variableSubstitution: boolean;
        let textSlotRegex: RegExp | undefined
        let delayBefore: number | undefined;
        let delayAfter: number | undefined;
        let onSuccess: Array<Command> | undefined;
        let onFail: Array<Command> | undefined;
        let skipIfLastExecuted: number | undefined;
        let saveTextSlot: number | undefined;
        let skipIfTextSlotEmpty = false;
        let escapeTextSlot = false;
        let saveCursorSlot: number | undefined;
        let reveal = false
        let captureTextSlotRegex: RegExp | undefined

        if (typeof command === "string") {
            let conditionedCommands = command.split(" || ")
            if (conditionedCommands.length > 1) {
                conditionedCommands = conditionedCommands.map((s) => s.trim());
                exe = conditionedCommands.shift()!;
                onFail = [createCommand(conditionedCommands.join(" || "))];
            } else {
                exe = command;
            }
            variableSubstitution = false;
        } else {
            reveal = !!command.reveal
            captureTextSlotRegex = command.captureTextSlotRegex ? new RegExp(command.captureTextSlotRegex) : undefined
            saveCursorSlot = command.saveCursorSlot
            escapeTextSlot = !!command.escapeTextSlot
            skipIfLastExecuted = command.skipIfLastExecuted ?? undefined
            saveTextSlot = command.saveTextSlot ?? undefined
            textSlotRegex = command.textSlotRegex ? new RegExp(command.textSlotRegex, "g") : undefined
            skipIfTextSlotEmpty = !!command.skipIfTextSlotEmpty
            delayBefore = command.delayBefore ? parseInt((command as any).delayBefore, 10) : undefined;
            delayAfter = command.delayAfter ? parseInt((command as any).delayAfter, 10) : undefined;
            exe = command.command;
            args = command.args;
            repeat = command.repeat ?? 1;
            variableSubstitution = command.variableSubstitution ?? false;
            onSuccess = command.onSuccess?.map((c) => createCommand(c));
            onFail = command.onFail?.map((c) => createCommand(c));
        }
        return new Command({ reveal, saveCursorSlot, captureTextSlotRegex, escapeTextSlot, skipIfLastExecuted, saveTextSlot, exe, args, repeat, onSuccess, onFail, variableSubstitution, delayBefore, delayAfter, textSlotRegex, skipIfTextSlotEmpty: skipIfTextSlotEmpty }, context);
    }

    const sequence = settings.sequence.map((command) => {
        return createCommand(command);
    });

    return new MultiCommand(id, label, description, interval, sequence, languages);
}

let multiCommands: Array<MultiCommand>;

function refreshUserCommands(context: vscode.ExtensionContext, varContext: any) {
    let configuration = vscode.workspace.getConfiguration("multiCommand");

    let commands = new Map<string, CommandSettings>();

    let commandList =
        configuration.get<Array<CommandSettingsWithKey> | CommandMap>(
            "commands"
        ) || [];

    // Dispose current settings.
    for (let element of context.subscriptions) {
        element.dispose();
    }

    if (Array.isArray(commandList)) {
        for (let commandSettingsWithKey of commandList) {
            commands.set(
                commandSettingsWithKey.command,
                commandSettingsWithKey
            );
        }
    } else if (implementsCommandMap(commandList)) {
        let commandObject = commandList as CommandMap;
        Object.keys(commandObject).forEach((key: string) => {
            commands.set(key, commandObject[key]);
        });
    }
    multiCommands = [];

    commands.forEach((value: CommandSettings, key: string) => {
        const multiCommand = createMultiCommand(key, value, varContext);
        multiCommands.push(multiCommand);

        context.subscriptions.push(
            vscode.commands.registerCommand(key, async () => {
                await multiCommand.execute(varContext);
            })
        );
    });
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    const varContext: any = {
        saveSelectSlot(text: string) {
            selectRegister.unshift(text)
            if (selectRegister.length > 4) {
                selectRegister.pop()
            }
        },
        saveDeleteSlot(text: string) {
            deleteRegister.unshift(text)
            if (deleteRegister.length > 4) {
                deleteRegister.pop()
            }
        }
    }
    refreshUserCommands(context, varContext);
    initializeCursorHistory()
    initializeTypedExpressionCommands()

    let registration: ReturnType<typeof vscode.window.onDidChangeTextEditorVisibleRanges> | undefined = undefined
    let decorations: { dec: ReturnType<typeof vscode.window.createTextEditorDecorationType>, line: number }[] = []
    function updateLineNumberDecorations(editor: Exclude<typeof vscode.window.activeTextEditor, undefined>, args: vscode.DecorationRenderOptions["after"]) {
        const start = Math.max(0, editor.visibleRanges[0].start.line - 15)
        const end = Math.min(editor.document.lineCount - 1, editor.visibleRanges.at(-1)!.end.line + 15)

        decorations = decorations.filter(v => {
            if (start <= v.line && v.line <= end) {
                return true
            }
            v.dec.dispose()
            return false
        })
        args = args || {}
        const exists = new Set(decorations.map(v => v.line))
        const spaces = " ".repeat((args as any).spaces || 2)
        for (let i = start; i <= end; ++i) {
            if (exists.has(i)) {
                continue
            }
            const dec = vscode.window.createTextEditorDecorationType(
                { opacity: "0.5", after: { ...args, contentText: `${spaces}${i + 1}` } },
            )
            decorations.push({ dec, line: i })
            const pos = new vscode.Position(i, editor.document.lineAt(i).range.end.character)
            editor.setDecorations(dec, [new vscode.Range(pos, pos)])
        }
    }

    let decoratedTokens = vscode.workspace.getConfiguration("multiCommand")?.get<string[]>("decoratedTokens") || ["(", ")", "{", "}", "<", ">", "[", "]"]
    let decoratedTokenRegExp = new RegExp(`[${escapeRegExp(decoratedTokens.join(""))}]`, "g")
    let decoratedTokenStyles: Record<string, vscode.DecorationRenderOptions> = vscode.workspace.getConfiguration("multiCommand")?.get<any>("decoratedTokenStyles") || {}
    const prev: { start: number, end: number, name: string } = { start: 0, end: 0, name: "" }
    let tokensToDecorations: Record<string, vscode.TextEditorDecorationType> = {}

    function refreshTokensToDecorations() {
        for (const d of Object.values(tokensToDecorations)) {
            d.dispose()
        }
        for (const s of decoratedTokens) {
            tokensToDecorations[s] = vscode.window.createTextEditorDecorationType(decoratedTokenStyles[s] || {})
        }
    }
    refreshTokensToDecorations()

    function updateTokenDecorations(editor: vscode.TextEditor, changedText: boolean = true) {
        const visibleStart = editor.visibleRanges[0].start.line
        const visibleEnd = editor.visibleRanges.at(-1)!.end.line
        const start = Math.max(0, visibleStart - 60)
        const end = Math.min(editor.document.lineCount - 1, visibleEnd + 60)

        if (!changedText && visibleStart >= prev.start && visibleEnd <= prev.end && editor.document.fileName === prev.name) {
            return
        }

        const tokensToRanges: Record<string, vscode.Range[]> = {}

        for (let line = start; line <= end; ++line) {
            const text = editor.document.lineAt(line).text
            for (const m of text.matchAll(decoratedTokenRegExp)) {
                const index = m.index
                if (index === undefined) {
                    continue
                }
                const token = m[0]
                let ranges = tokensToRanges[token]
                if (!ranges) {
                    ranges = []
                    tokensToRanges[token] = ranges
                }
                ranges.push(new vscode.Range(line, index, line, index + 1))
            }
        }
        for (const token of Object.keys(tokensToDecorations)) {
            const ranges = tokensToRanges[token] || []
            const styles = tokensToDecorations[token]
            editor.setDecorations(styles, ranges)
        }
        prev.start = start
        prev.end = end
        prev.name = editor.document.fileName
    }

    vscode.commands.registerTextEditorCommand("extension.multiCommand.gotoEmptyLine", (editor, eb, args) => {
        const op = args.op ?? "jump"
        const direction = args.direction === "backward" ? "backward" : "forward"
        const newSelections: vscode.Selection[] = []
        const savedDeleteText: string[] = []
        editor.selections.forEach(sel => {
            const line = sel.active.line
            let targetLine = -1
            if (direction === "backward") {
                for (let i = line - 1; i >= 0; --i) {
                    if (editor.document.lineAt(i).isEmptyOrWhitespace) {
                        targetLine = i
                        break
                    }
                }
            } else {
                for (let i = line + 1; i < editor.document.lineCount; ++i) {
                    if (editor.document.lineAt(i).isEmptyOrWhitespace) {
                        targetLine = i
                        break
                    }
                }
            }
            if (targetLine >= 0 && targetLine < editor.document.lineCount) {
                if (op === "jump") {
                    newSelections.push(new vscode.Selection(targetLine, 0, targetLine, 0))
                } else if (op === "delete") {
                    const range = trimSelection(new vscode.Selection(sel.start.line, sel.start.character, targetLine, 0), editor)
                    savedDeleteText.push(editor.document.getText(range))
                    eb.delete(range)
                } else {
                    if ((direction === "backward" && sel.active.compareTo(sel.anchor) <= 0) || (direction === "forward" && sel.active.compareTo(sel.anchor) >= 0)) {
                        newSelections.push(new vscode.Selection(sel.anchor, new vscode.Position(targetLine, 0)))
                    } else {
                        newSelections.push(new vscode.Selection(sel.active, new vscode.Position(targetLine, 0)))
                    }
                }
            }
        })
        if (savedDeleteText.length > 0) {
            varContext.saveDeleteSlot(savedDeleteText.join("\n"))
        }
        if (op === "select") {
            const text = newSelections.map(v => editor.document.getText(v)).join("\n")
            varContext.saveSelectSlot(text)
        }
        if (newSelections.length > 0) {
            editor.selections = newSelections
            editor.revealRange(newSelections[0], vscode.TextEditorRevealType.InCenterIfOutsideViewport)
        }

    })

    vscode.commands.registerTextEditorCommand("extension.multiCommand.selectBrackets", (editor, eb, args) => {
        const includeBrackets = !!args.includeBrackets
        const chars = args?.chars || "{[(<".split("")
        const b = parseBrackets(editor.document.getText(), editor)
        const newSelections: vscode.Selection[] = []

        editor.selections.forEach(sel => {
            const bracket = b.getBracketEnclosingCursor(sel.active, chars, false)
            if (bracket) {
                const start = editor.document.positionAt(bracket.start + (includeBrackets ? 0 : 1))
                const end = editor.document.positionAt(bracket.end! - (includeBrackets ? 0 : 1))
                const s = new vscode.Selection(start.line, start.character, end.line, end.character)
                newSelections.push(includeBrackets ? s : trimSelection(s, editor))
            }
        })
        const text = newSelections.map(v => editor.document.getText(v)).join("\n")
        if (text) {
            varContext.saveSelectSlot(text)
        }
        if (newSelections.length > 0) {
            editor.selections = newSelections
        }
    })

    vscode.commands.registerTextEditorCommand("extension.multiCommand.deleteBrackets", (editor, eb, args) => {
        const includeBrackets = !!args.includeBrackets
        const chars = args?.chars || "{[(<".split("")
        const b = parseBrackets(editor.document.getText(), editor)
        const newSelections: vscode.Selection[] = []
        editor.selections.forEach(sel => {
            const bracket = b.getBracketEnclosingCursor(sel.active, chars, false)
            if (bracket) {
                const start = editor.document.positionAt(bracket.start + (includeBrackets ? 0 : 1))
                const end = editor.document.positionAt(bracket.end! - (includeBrackets ? 0 : 1))
                const s = new vscode.Selection(start.line, start.character, end.line, end.character)
                newSelections.push(includeBrackets ? s : trimSelection(s, editor))
            }
        })
        const text = newSelections.map(v => editor.document.getText(v)).join("\n")
        if (text) {
            varContext.saveDeleteSlot(text)
        }
        newSelections.forEach(s => eb.delete(s))
    })

    vscode.commands.registerTextEditorCommand("extension.multiCommand.gotoPeerBracket", (editor, eb, args) => {
        const direction = args?.direction === "prev" ? "prev" : "next"
        const chars = args?.chars || ["{"]
        if (editor.selections.length !== 1) {
            return
        }
        const b = parseBrackets(editor.document.getText(), editor)
        const bracket = direction === "prev" ? b.getPrevPeerBracket(editor.selection.active, chars) : b.getNextPeerBracket(editor.selection.active, chars)
        if (bracket) {
            const start = editor.document.positionAt(bracket.start + 1)
            editor.selection = new vscode.Selection(start.line, start.character, start.line, start.character)
            editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
        }
    })

    

    vscode.commands.registerTextEditorCommand("extension.multiCommand.jumpOutOfBrackets", (editor, eb, args) => {
        const b = parseBrackets(editor.document.getText(), editor)
        const chars = args?.chars || ["(", "{", "[", "<"]
        const direction = args?.direction === "above" ? "above" : "below"
        if (editor.selections.length !== 1) {
            return
        }
        const bracket = b.getBracketEnclosingCursor(editor.selection.active, chars, true)
        if (bracket) {

            const start = editor.document.positionAt(bracket.start)
            const end = editor.document.positionAt(bracket.end!)
            if (direction === "above") {
                const char = editor.document.lineAt(start.line).firstNonWhitespaceCharacterIndex
                editor.selection = new vscode.Selection(start.line, char, start.line, char)
            } else {
                const char = editor.document.lineAt(start.line).range.end.character
                editor.selection = new vscode.Selection(end.line, char, end.line, char)
            }
            editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
        }
    })

    let lnArgs: any = {}
    vscode.workspace.onDidChangeConfiguration(() => {
        refreshUserCommands(context, varContext);
        if (registration) {
            registration.dispose()
            decorations.forEach(d => d.dec.dispose())
            decorations = []
        }
        lnArgs = vscode.workspace.getConfiguration('multiCommand')?.get<any>('lineNumberStyle') || {}
        rWillBeJumping = new RegExp(vscode.workspace.getConfiguration("multiCommand")?.get<string>("willBeJumpingRegex") || "[1-9][a-zA-Z0-9\\-_$]*$")
        decoratedTokens = vscode.workspace.getConfiguration("multiCommand")?.get<string[]>("decoratedTokens") || decoratedTokens
        decoratedTokenRegExp = new RegExp(`[${escapeRegExp(decoratedTokens.join(""))}]`, "g")
        decoratedTokenStyles = vscode.workspace.getConfiguration("multiCommand")?.get<any>("decoratedTokenStyles") || {}
        refreshTokensToDecorations()
        if (vscode.window.activeTextEditor) {
            updateTokenDecorations(vscode.window.activeTextEditor)
        }
    });
    lnArgs = vscode.workspace.getConfiguration('multiCommand')?.get<any>('lineNumberStyle') || {}
    let rWillBeJumping = new RegExp(vscode.workspace.getConfiguration("multiCommand")?.get<string>("willBeJumpingRegex") || "[1-9][a-zA-Z0-9\\-_$]*$")

    let lastSelections: vscode.Selection[]
    vscode.window.onDidChangeTextEditorSelection(a => {
        vscode.commands.executeCommand("workbench.action.closeSidebar");
        if (a.selections && a.selections.length === 1 && a.selections[0].active.compareTo(a.selections[0].anchor) === 0) {
            const selection = a.selections[0].active
            const editor = vscode.window.activeTextEditor
            if (editor) {
                const line = editor.document.lineAt(selection.line)
                if (line.range.end.character === selection.character && rWillBeJumping.test(line.text)) {
                    enableLineNumbers()
                } else {
                    disableLineNumbers()
                }
            }
        } else {
            disableLineNumbers()
        }

        if ((a.kind === vscode.TextEditorSelectionChangeKind.Keyboard || a.kind === vscode.TextEditorSelectionChangeKind.Mouse) && a.selections.some(s => s.active.compareTo(s.anchor) !== 0)) {

            const text = a.selections.map(v => a.textEditor.document.getText(v)).join("\n")
            varContext.saveSelectSlot(text)
            lastSelections = a.selections
        }
    })
    vscode.window.onDidChangeTextEditorVisibleRanges(a => {
        updateTokenDecorations(a.textEditor, false)
    })
    vscode.window.onDidChangeActiveTextEditor(a => {
        if (a) updateTokenDecorations(a, false)
    })

    function checkFlushFromSelections(selections: vscode.Selection[]) {

        if (selections.length !== insertStartedAtSelections.length) {
            flushInsertBuffer(selections)
        } else {
            for (let i = 0; i < selections.length; ++i) {
                if (selections[i].anchor.compareTo(selections[i].active) !== 0) {
                    flushInsertBuffer(selections)
                    return
                }
                const buffer = insertBufferRanges[i]
                if (buffer && selections[i].anchor.line !== buffer.start.line) {
                    flushInsertBuffer(selections)
                    return
                }
                if (selections[i].active.line !== insertStartedAtSelections[i].active.line) {
                    flushInsertBuffer(selections)
                    return
                }
            }
        }

    }



    vscode.window.onDidChangeTextEditorSelection(a => {
        checkFlushFromSelections(a.selections)
    })


    let insertBufferRanges: (vscode.Range | undefined)[] = []
    let insertStartedAtSelections: vscode.Selection[] = []
    let prevLineCount: number = 0
    vscode.workspace.onDidChangeTextDocument((a) => {
        isDirty = true

        if (inserting || a.contentChanges.length === 0 || a.reason !== undefined) {
            return
        }
        if (lastSelections && lastSelections.length === a.contentChanges.length && lastSelections.every((sel, index) => {
            const [start, end] = sel.active.compareTo(sel.anchor) >= 0 ? [sel.anchor, sel.active] : [sel.active, sel.anchor]
            return start.compareTo(a.contentChanges[index].range.start) === 0 && end.compareTo(a.contentChanges[index].range.end) === 0
        }) && selectRegister[0]?.trim()) {
            varContext.saveDeleteSlot(selectRegister[0])
        }
        if (a.contentChanges.length !== insertStartedAtSelections.length) {
            flushInsertBuffer(vscode.window.activeTextEditor!.selections)
        }
        if (a.contentChanges.length !== insertStartedAtSelections.length) {
            return
        }

        for (let i = 0; i < a.contentChanges.length; ++i) {
            const c = a.contentChanges[i]
            const sel = insertStartedAtSelections[i].active
            if (c.range.start.line === sel.line) {
                if (c.text.includes("\n")) {
                    flushInsertBuffer(vscode.window.activeTextEditor!.selections)
                } else if (c.range.start.character < sel.character) {
                    insertStartedAtSelections[i] = new vscode.Selection(sel.line, c.range.start.character, sel.line, c.range.start.character)
                }
            }
        }

        if (a.document.lineCount !== prevLineCount) {
            const op = a.document.lineCount - prevLineCount
            for (let i = 0; i < insertStartedAtSelections.length; ++i) {
                let val = insertBufferRanges[i]
                if (val) {
                    insertBufferRanges[i] = new vscode.Range(val.start.line + op, val.start.character, val.end.line + op, val.end.character)
                }
                val = insertStartedAtSelections[i]
                insertStartedAtSelections[i] = new vscode.Selection(val.start.line + op, val.start.character, val.end.line + op, val.start.character)
            }
            for (let i = 0; i < insertStartedAtSelections.length; ++i) {
                insertStartedAtSelections[i]
            }
            prevLineCount = a.document.lineCount
        }

        for (let i = 0; i < a.contentChanges.length; ++i) {
            const c = a.contentChanges[i]
            let buffer = insertBufferRanges[i]
            if (!buffer) {
                insertStartedAtSelections[i] = (vscode.window.activeTextEditor!.selections[i])
            }
            if ((!buffer || c.range.start.line === buffer.start.line)) {
                insertBufferRanges[i] = new vscode.Range(c.range.start.line, c.range.start.character, c.range.start.line, c.range.start.character + c.text.length)
            } else {
                a.document.lineCount
            }
        }
    })



    let insertRegister: string[] = []
    let deleteRegister: string[] = []
    let selectRegister: string[] = []
    const flushInsertBuffer = function (selections: vscode.Selection[]) {
        const result = insertBufferRanges.map((v, index) => {
            const selStarted = insertStartedAtSelections[index]
            return vscode.window.activeTextEditor!.document.getText(new vscode.Range(selStarted.active, v!.end))
        }).join("\n")

        if (!inserting && result.trim()) {
            console.log(`Storing value ${result.slice(0, 30)} ... in insert register`)
            insertRegister.unshift(result)
            if (insertRegister.length > 4) {
                insertRegister.pop()
            }
        }

        for (let i = 0; i < insertBufferRanges.length; ++i) {
            insertBufferRanges[i] = undefined
        }
        prevLineCount = vscode.window.activeTextEditor!.document.lineCount
        insertBufferRanges.length = 0
        if (selections.length !== 1 || selections[0].anchor.compareTo(selections[0].active) !== 0) {
            insertStartedAtSelections = []
            return
        }
        insertStartedAtSelections = selections
    }
    let isDirty = false
    setInterval(() => {
        if (isDirty) {
            isDirty = false
            if (vscode.window.activeTextEditor) {
                updateTokenDecorations(vscode.window.activeTextEditor, true)
            }
        }
    }, 33)



    const disableLineNumbers = debounce(function disableLineNumbers() {
        if (registration) {
            registration.dispose()
            decorations.forEach(d => d.dec.dispose())
            decorations = []
            registration = undefined
        }
    })
    const enableLineNumbers = debounce(function enable() {
        const editor = vscode.window.activeTextEditor
        if (!registration && editor) {
            registration = vscode.window.onDidChangeTextEditorVisibleRanges(a => {
                updateLineNumberDecorations(editor, lnArgs)
            })
            context.subscriptions.push(registration)
            updateLineNumberDecorations(editor, lnArgs)
        }
    })

    let inserting = false
    vscode.commands.registerCommand("extension.multiCommand.pasteInsertRegister", async (args: any) => {
        const editor = vscode.window.activeTextEditor
        if (!editor) {
            return
        }
        const index = args?.slot ?? 0
        const value = insertRegister[index]
        if (!value) {
            return
        }

        try {
            inserting = true
            await editor.edit(eb => {
                editor.selections.forEach(sel => {
                    eb.replace(sel, value)
                })
            })
        } finally {
            inserting = false
        }
    })

    function goToPrevDiagnostic(diag: vscode.Diagnostic[], start: vscode.Position, editor: vscode.TextEditor) {
        let gotot: vscode.Diagnostic | undefined
        for (let i = diag.length - 1; i >= 0; --i) {
            const d = diag[i]
            if (d.range.start.compareTo(start) < 0) {
                gotot = d
                break
            }
        }
        gotot = gotot || diag.at(-1)
        if (gotot) {

            editor.selection = new vscode.Selection(gotot.range.start, gotot.range.start)
            editor.revealRange(gotot.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
            return true

        }
        return false
    }

    function goToNextDiagnostic(diag: vscode.Diagnostic[], start: vscode.Position, editor: vscode.TextEditor) {
        let gotot: vscode.Diagnostic | undefined
        for (let i = 0; i < diag.length; ++i) {
            const d = diag[i]
            if (d.range.start.compareTo(start) > 0) {
                gotot = d
                break
            }
        }
        gotot = gotot || diag.at(0)
        if (gotot) {

            editor.selection = new vscode.Selection(gotot.range.start, gotot.range.start)
            editor.revealRange(gotot.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
            return true

        }
        return true
    }

    vscode.commands.registerTextEditorCommand("extension.multiCommand.replaceConstants", async (a, b, c) => {
        const r = /^\s*const\s*([^\s]+)\s*=\s*("[^"]+"|'[^']+'|`[^`]+`|[\d.\-e_]+)\s*$/gm
        const constants = await vscode.env.clipboard.readText()
        let m: ReturnType<RegExp["exec"]> | null | undefined = null
        const constantNamesByConstant: Record<string, string> = {}
        while (m = r.exec(constants || "")) {
            constantNamesByConstant[m[2].trim()] = m[1].trim()
        }
        const regex = new RegExp(`(?:${Object.keys(constantNamesByConstant).map(escapeRegExp).join("|")})`, "g")
        await a.edit(eb => {
            a.selections.forEach(sel => {
                const text = a.document.getText(sel).replace(regex, m => constantNamesByConstant[m])
                const [start, end] = sel.active.compareTo(sel.anchor) >= 0 ? [sel.anchor, sel.active] : [sel.active, sel.anchor]
                eb.replace(new vscode.Range(start, end), text)
            })
        })
    })

    vscode.commands.registerTextEditorCommand("extension.multiCommand.uncomment", async (editor, eb, c) => {
        const b = parseBrackets(editor.document.getText(), editor)
        editor.selections.forEach(sel => {
            const bracket = b.getBracketEnclosingCursor(editor.selection.active, ["/*"], true, true)
            if (bracket) {
                const start = editor.document.positionAt(bracket.start)
                const end = editor.document.positionAt(bracket.end! - 2)
                eb.delete(new vscode.Range(start, new vscode.Position(start.line, start.character + 2)))
                eb.delete(new vscode.Range(end, new vscode.Position(end.line, end.character + 2)))
            }
        })
    })


    vscode.commands.registerTextEditorCommand("extension.multiCommand.deleteComment", async (editor, eb, c) => {
        const b = parseBrackets(editor.document.getText(), editor)
        const ranges: vscode.Selection[] = []
        editor.selections.forEach(sel => {
            const bracket = b.getBracketEnclosingCursor(editor.selection.active, ["/*"], true, true)
            if (bracket) {
                const start = editor.document.positionAt(bracket.start)
                const end = editor.document.positionAt(bracket.end!)
                const sel = new vscode.Selection(start, end)
                ranges.push(sel)
            }
        })
        if (ranges.length > 0) {
            const text = ranges.map(v => editor.document.getText(v)).join("\n")
            varContext.saveDeleteSlot(text)
            ranges.forEach(v => eb.delete(v))
        }
    })

    vscode.commands.registerTextEditorCommand("extension.multiCommand.selectComment", async (editor, eb, c) => {
        const b = parseBrackets(editor.document.getText(), editor)
        const ranges: vscode.Selection[] = []
        editor.selections.forEach(sel => {
            const bracket = b.getBracketEnclosingCursor(editor.selection.active, ["/*"], true, true)
            if (bracket) {
                const start = editor.document.positionAt(bracket.start + 2)
                const end = editor.document.positionAt(bracket.end! - 2)
                const sel = trimSelection(new vscode.Selection(start, end), editor)
                ranges.push(sel)
            }
        })
        if (ranges.length > 0) {
            const text = ranges.map(v => editor.document.getText(v)).join("\n")
            varContext.saveSelectSlot(text)
            editor.selections = ranges
        }

    })

    vscode.commands.registerTextEditorCommand("extension.multiCommand.justGoToNextProblem", async (a, b, c) => {
        const diagnostics = vscode.languages.getDiagnostics(a.document.uri)
        if (a.selections.length !== 1) {
            return
        }
        const sel = a.selections[0]
        const start = sel.active.compareTo(sel.anchor) >= 0 ? sel.anchor : sel.active
        const errors = diagnostics.filter(v => v.severity === vscode.DiagnosticSeverity.Error)

        if (errors.length > 0 && goToNextDiagnostic(errors, start, a)) {
            return
        }
        const warnings = diagnostics.filter(v => v.severity === vscode.DiagnosticSeverity.Warning)
        goToNextDiagnostic(warnings, start, a)
    })

    vscode.commands.registerTextEditorCommand("extension.multiCommand.justGoToPreviousProblem", async (a, b, c) => {
        const diagnostics = vscode.languages.getDiagnostics(a.document.uri)
        if (a.selections.length !== 1) {
            return
        }
        const sel = a.selections[0]
        const start = sel.active.compareTo(sel.anchor) >= 0 ? sel.anchor : sel.active
        const errors = diagnostics.filter(v => v.severity === vscode.DiagnosticSeverity.Error)

        if (errors.length > 0 && goToPrevDiagnostic(errors, start, a)) {
            return
        }
        const warnings = diagnostics.filter(v => v.severity === vscode.DiagnosticSeverity.Warning)
        goToPrevDiagnostic(warnings, start, a)

    })

    vscode.commands.registerCommand("extension.multiCommand.pasteSelectRegister", async (args: any) => {
        const editor = vscode.window.activeTextEditor
        if (!editor) {
            return
        }
        const index = args?.slot ?? 0
        const value = selectRegister[index]
        if (!value) {
            return
        }

        try {
            inserting = true
            await editor.edit(eb => {
                editor.selections.forEach(sel => {
                    eb.replace(sel, value)
                })
            })
        } finally {
            inserting = false
        }
    })

    vscode.commands.registerCommand("extension.multiCommand.executePrevious", async () => {
        if (varContext.previousCommand) {
            const { cmd, args } = varContext.previousCommand
            await vscode.commands.executeCommand(cmd, args)
        }
    })

    vscode.commands.registerCommand("extension.multiCommand.pasteDeleteRegister", async (args: any) => {
        const editor = vscode.window.activeTextEditor
        if (!editor) {
            return
        }
        const index = args?.slot ?? 0
        const value = deleteRegister[index]
        if (!value) {
            return
        }

        try {
            inserting = true
            await editor.edit(eb => {
                editor.selections.forEach(sel => {
                    eb.replace(sel, value)
                })
            })
        } finally {
            inserting = false
        }
    })

    vscode.commands.registerCommand("extension.multiCommand.toggleLineNumbers", () => {
        const editor = vscode.window.activeTextEditor
        if (!editor) {
            return
        }

        if (registration) {
            disableLineNumbers()
        } else {
            enableLineNumbers()
        }
    })

    vscode.commands.registerCommand(
        "extension.multiCommand.execute",
        async (args = {}) => {
            varContext.wasDirty = vscode.window.activeTextEditor?.document.isDirty
            try {
                if (args.command) {
                    await vscode.commands.executeCommand(args.command);
                } else if (args.sequence) {
                    const multiCommand = createMultiCommand("", args, varContext);
                    await multiCommand.execute(varContext);
                } else {
                    await pickMultiCommand(varContext);
                }
            } catch (e) {
                vscode.window.showErrorMessage(`${(e as Error).message}`);
            }
        }
    );
}

// this method is called when your extension is deactivated
export function deactivate() { }

export async function pickMultiCommand(varContext: any) {
    let languageId = vscode.window.activeTextEditor?.document.languageId;

    const picks = multiCommands.filter((multiCommand) => {
        if (languageId) {
            return (multiCommand.languages?.indexOf(languageId) ?? 1) >= 0;
        } else {
            return true;
        }
    }).map((multiCommand) => {
        return {
            label: multiCommand.label || multiCommand.id,
            description: multiCommand.description || "",
            multiCommand: multiCommand,
        };
    });

    const item = await vscode.window.showQuickPick(picks, {
        placeHolder: `Select one of the multi commands...`,
    });

    if (!item) {
        return;
    }
    await item.multiCommand.execute(varContext);
}

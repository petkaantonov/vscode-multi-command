// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below


import * as vscode from "vscode";
import { Command } from "./command";
import { MultiCommand } from "./multiCommand";

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
    const varContext: any = {}
    refreshUserCommands(context, varContext);

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

    vscode.window.onDidChangeTextEditorSelection(a => {
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
        for (let i = 0; i < selections.length; ++i) {
            if (selections[i].anchor.compareTo(selections[i].active) !== 0) {
                insertStartedAtSelections = []
                return
            }
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

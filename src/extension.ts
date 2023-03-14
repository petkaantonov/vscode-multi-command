// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { Command } from "./command";
import { MultiCommand } from "./multiCommand";

type CommandSequence = Array<string | ComplexCommand>;

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
        let saveCursorSlot: number | undefined;
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
        return new Command({reveal, saveCursorSlot, captureTextSlotRegex, escapeTextSlot, skipIfLastExecuted, saveTextSlot, exe, args, repeat, onSuccess, onFail, variableSubstitution, delayBefore, delayAfter, textSlotRegex, skipIfTextSlotEmpty: skipIfTextSlotEmpty }, context);
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

    vscode.workspace.onDidChangeConfiguration(() => {
        refreshUserCommands(context, varContext);
    });

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

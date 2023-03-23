import * as vscode from "vscode"

export function initializeCursorHistory() {
    function defaultData(fileName: string) {
        const ret = fileMap[fileName]
        if (!ret) {
            fileMap[fileName] = {
                lastUpdate: 0,
                available: [4, 5, 6, 7, 8, 9],
                lastEdited: 0,
                undoStack: [],
                redoStack: []
            }
            return fileMap[fileName]
        }
        return ret
    }

    async function undo(fileName: string) {
        const data = defaultData(fileName)
        const { undoStack, redoStack } = data
        if (undoStack.length > 0) {
            const bm = undoStack.pop()!
            redoStack.push(bm)
            data.lastUpdate = Date.now()
            const sel = vscode.window.activeTextEditor!.selection
            await vscode.commands.executeCommand("numberedBookmarks.jumpToBookmark" + bm)
            if (vscode.window.activeTextEditor!.selection.isEqual(sel)) {
                undo(fileName)
            }
        }
    }
    async function redo(fileName: string) {
        const data = defaultData(fileName)
        const { undoStack, redoStack } = data
        if (redoStack.length > 0) {
            const bm = redoStack.pop()!
            undoStack.push(bm)
            data.lastUpdate = Date.now()
            const sel = vscode.window.activeTextEditor!.selection
            await vscode.commands.executeCommand("numberedBookmarks.jumpToBookmark" + bm)
            if (vscode.window.activeTextEditor!.selection.isEqual(sel)) {
                redo(fileName)
            }

        }
    }
    function save(fileName: string) {
        const data = defaultData(fileName)
        const { undoStack, redoStack, available } = data
        let bm: number
        if (available.length > 0) {
            bm = available.pop()!
        } else if (redoStack.length > 0) {
            bm = redoStack.shift()!
        } else {
            bm = undoStack.shift()!
        }
        undoStack.push(bm)
        if (data.redoStack.length > 0) {
            available.push(...data.redoStack)
            data.redoStack.splice(0, data.redoStack.length)
        }
        vscode.commands.executeCommand("numberedBookmarks.toggleBookmark" + bm)
    }
    const fileMap: Record<string, { lastEdited: number, available: number[], undoStack: number[], redoStack: number[], lastUpdate: number, previousSelection?: vscode.Selection }> = {}

    vscode.workspace.onDidChangeTextDocument(event => {
        const uri = event.document.uri
        const data = defaultData(uri.toString())
        data.lastEdited = Date.now()
    })

    vscode.workspace.onDidRenameFiles(event => {
        for (const file of event.files) {
            if (fileMap[file.oldUri.toString()]) {
                const tmp = fileMap[file.oldUri.toString()]
                delete fileMap[file.oldUri.toString()]
                fileMap[file.newUri.toString()] = tmp
            }
        }
    })

    vscode.workspace.onDidCloseTextDocument(event => {
        const uri = event.uri.toString()
        if (fileMap[uri]) {
            delete fileMap[uri]
        }
    })

    vscode.window.onDidChangeTextEditorSelection(event => {
        const now = Date.now()
        if (event.selections.length !== 1) {
            return
        }
        const sel = event.selections[0]
        const normalizedSelection = new vscode.Selection(sel.active, sel.active)
        const data = defaultData(event.textEditor.document.uri.toString())
        if ((now - data.lastEdited) > 300 && (now - data.lastUpdate) > 100 && (!data.previousSelection || data.previousSelection.active.compareTo(normalizedSelection.active) !== 0)) {
            data.previousSelection = normalizedSelection
            data.lastUpdate = now
            save(event.textEditor.document.uri.toString())
        }
    })

    vscode.commands.registerTextEditorCommand("extension.multiCommand.justCursorUndo", (editor) => {
        undo(editor.document.uri.toString())
    })

    vscode.commands.registerTextEditorCommand("extension.multiCommand.justCursorRedo", editor => {
        redo(editor.document.uri.toString())
    })

}
















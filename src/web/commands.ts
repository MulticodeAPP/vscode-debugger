import LZString = require('lz-string');
import * as vscode from 'vscode';
import { getCodeRunOutput, runCode } from './api';
import { FRONTEND_BASE_URL } from './constants';
import { MulticodeTreeProvider } from './providers';
import { CodeRunId, CodeRunOutput, Insights } from './types';
import { parseInsights, printToOutput } from './utils';

const output = vscode.window.createOutputChannel('Multicode.app')
let debugEditorUri: vscode.Uri | undefined = undefined

const currentHighlight = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(100, 150, 255, 0.5)' })
const currentHighlightPrefix = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(100, 150, 255, 0.2)' })
const previousHighlight = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(120, 200, 75, 0.3)' })
const previousHighlightPrefix = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(120, 200, 75, 0.1)' })

function getDebugState(context: vscode.ExtensionContext) {
    const output = context.workspaceState.get<CodeRunOutput>('debugOutput')
    const pointer = context.workspaceState.get<number>('debugPointer')
    return { output, pointer }
}

function render(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    const { output, pointer } = getDebugState(context)
    const container = parseInsights(output, pointer)

    const int = output?.result?.insights
    if (!container || !int) return

    const insights = [...container.insights]
    const current: Insights | undefined = insights.pop()
    const previous: Insights | undefined = insights.pop()

    const currentDecorations: Array<vscode.Range> = []
    const currentPrefixDecorations: Array<vscode.Range> = []
    const previousDecorations: Array<vscode.Range> = []
    const previousPrefixDecorations: Array<vscode.Range> = []

    if (current) {
        if (previous) {
            if (previous.path.startColumn > 0) {
                previousPrefixDecorations.push(new vscode.Range(previous.path.startRow, 0, previous.path.startRow, previous.path.startColumn))
            }

            const inside = previous.path.startRow <= current.path.startRow
                && previous.path.endRow >= current.path.endRow
                && (previous.path.startRow != current.path.startRow || previous.path.startColumn <= current.path.startColumn)
                && (previous.path.endRow != current.path.endRow || previous.path.endColumn >= current.path.endColumn)


            if (inside) {
                previousPrefixDecorations.push(new vscode.Range(previous.path.startRow, previous.path.startColumn, current.path.startRow, current.path.startColumn))
                previousPrefixDecorations.push(new vscode.Range(current.path.endRow, current.path.endColumn, previous.path.endRow, previous.path.endColumn))
            } else {
                previousDecorations.push(new vscode.Range(previous.path.startRow, previous.path.startColumn, previous.path.endRow, previous.path.endColumn))
            }
        }
        if (current.path.startColumn > 0) {
            currentPrefixDecorations.push(new vscode.Range(current.path.startRow, 0, current.path.startRow, current.path.startColumn))
        }
        currentDecorations.push(new vscode.Range(current.path.startRow, current.path.startColumn, current.path.endRow, current.path.endColumn))
    }

    if (debugEditorUri) {
        vscode.window.showTextDocument(debugEditorUri).then(editor => {
            editor.setDecorations(previousHighlightPrefix, previousPrefixDecorations)
            editor.setDecorations(previousHighlight, previousDecorations)
            editor.setDecorations(currentHighlightPrefix, currentPrefixDecorations)
            editor.setDecorations(currentHighlight, currentDecorations)
        })
    }

    providers.forEach(it => it.refresh(int, container))
}

async function debugRunCode(): Promise<CodeRunId> {
    const editor = vscode.window.visibleTextEditors.find(it => it.document.languageId !== 'Log')
    if (editor) {
        debugEditorUri = editor.document.uri
        return await runCode({
            language: editor.document.languageId,
            code: editor.document.getText()
        })
    } else {
        return Promise.reject('No open text editor found to run code from.')
    }
}

export async function debugStartOpenExternal() {
    await debugRunCode()
        .then(res => vscode.env.openExternal(vscode.Uri.parse(`${FRONTEND_BASE_URL}/ide/l/${res.idShortened || res.id}`)))
        .catch(message => vscode.window.showErrorMessage(message))
}

export async function debugStart(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    vscode.commands.executeCommand('setContext', 'multicode-app-debugger.debugging', true)
    vscode.commands.executeCommand('multicode-app-debugger.insights.focus')
    output.clear()

    await debugRunCode()
        .then(res => {
            vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, cancellable: true }, async (progress, cancel) => {
                return new Promise((resolve) => {
                    progress.report({ message: "Your code is currently in the queue...", increment: 0 })

                    const time = Date.now()
                    const id = setInterval(async () => {
                        if (cancel.isCancellationRequested || time < Date.now() - 2 * 60 * 1000) {
                            debugStop(context, providers)
                            resolve(undefined)
                            clearInterval(id)
                            return
                        }

                        await getCodeRunOutput(res.id)
                            .then(res => {
                                if (res.status.error) {
                                    vscode.window.showErrorMessage('Server ran into an unexpected error...')
                                    debugStop(context, providers)
                                    resolve(undefined)
                                    clearInterval(id)
                                    return
                                }

                                if (res.status.running) {
                                    progress.report({ message: "Your code is now running..." })
                                }

                                if (res.result !== null) {
                                    if (res.result.errors.content.length > 0) {
                                        printToOutput(output, '[error]:', res.result.errors)
                                        output.appendLine('')
                                    }

                                    if (res.result.output.content.length > 0) {
                                        printToOutput(output, '[output]:', res.result.output)
                                    }

                                    let out = res
                                    if (res.result.insights !== null) {
                                        const encoding = LZString.decompressFromBase64(res.result.insights.encoding)
                                        if (encoding) {
                                            out = {
                                                ...res,
                                                result: {
                                                    ...res.result,
                                                    insights: {
                                                        ...res.result.insights,
                                                        encoding: encoding
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        vscode.commands.executeCommand('setContext', 'multicode-app-debugger.error', true)
                                    }

                                    context.workspaceState.update('debugOutput', out)
                                    context.workspaceState.update('debugPointer', 0)

                                    render(context, providers)

                                    resolve(undefined)
                                    clearInterval(id)
                                    return
                                }
                            })
                    }, 1.5 * 1000)
                })
            })
        })
        .catch(message => vscode.window.showErrorMessage(message))
}

export async function debugStop(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    vscode.commands.executeCommand('setContext', 'multicode-app-debugger.debugging', false)
    vscode.commands.executeCommand('setContext', 'multicode-app-debugger.error', false)
    context.workspaceState.update('debugOutput', undefined)
    context.workspaceState.update('debugPointer', undefined)

    if (debugEditorUri) {
        const editor = vscode.window.visibleTextEditors.find(it => it.document.uri === debugEditorUri)
        if (editor) {
            editor.setDecorations(previousHighlightPrefix, [])
            editor.setDecorations(previousHighlight, [])
            editor.setDecorations(currentHighlightPrefix, [])
            editor.setDecorations(currentHighlight, [])
        }
    }
    providers.forEach(it => it.refresh(undefined, undefined))
}

export function debugStepForwards(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    moveDebugPointer(context, providers, (pointer, _) => pointer + 1)
}

export function debugStepBackwards(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    moveDebugPointer(context, providers, (pointer, _) => pointer - 1)
}

export function debugJumpToStart(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    moveDebugPointer(context, providers, () => 0)
}

export function debugJumpToEnd(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    moveDebugPointer(context, providers, (_, end) => end)
}

function moveDebugPointer(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>,
    action: (pointer: number, end: number) => number
) {
    const { output, pointer } = getDebugState(context)

    if (!output || pointer === undefined) {
        return
    }

    let end = 0
    if (output && output.result && output.result.insights) {
        end = output.result.insights.encoding.split('|').length - 1
    }

    let newPointer = action(pointer, end)
    if (newPointer < 0) {
        newPointer = 0
    } else if (newPointer > end) {
        newPointer = end
    }

    if (pointer !== newPointer) {
        context.workspaceState.update('debugPointer', newPointer)
        render(context, providers)
    }
}
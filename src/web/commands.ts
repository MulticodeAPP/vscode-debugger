import LZString = require('lz-string');
import * as vscode from 'vscode';
import { getCodeRunOutput, runCode } from './api';
import { FRONTEND_BASE_URL } from './constants';
import { MulticodeTreeProvider } from './providers';
import { CodePathReference, CodeRunId, CodeRunOutput, IDEFrozenData, IDEFrozenDataEntry } from './types';
import { fixFrozenCodeRunOutput, parseInsights, parseInsightsDepth, printToOutput, searchInsightsForRowColumnDepth } from './utils';

const output = vscode.window.createOutputChannel('Multicode.app')
let debugEditorUri: vscode.Uri | undefined = undefined
let debugCode: string = ""

const currentHighlight = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(100, 150, 255, 0.5)' })
const currentHighlightPrefix = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(100, 150, 255, 0.2)' })
const currentHighlightFrozen = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(150, 150, 165, 0.5)' })
const currentHighlightPrefixFrozen = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(150, 150, 165, 0.2)' })

const previousHighlight = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(120, 200, 75, 0.3)' })
const previousHighlightPrefix = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(120, 200, 75, 0.1)' })
const previousHighlightFrozen = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(120, 200, 75, 0.1)' })
const previousHighlightPrefixFrozen = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(150, 165, 150, 0.3)' })

function getDebugState(context: vscode.ExtensionContext) {
    const output = context.workspaceState.get<CodeRunOutput>('debugOutput')
    const pointer = context.workspaceState.get<number>('debugPointer')
    const frozen = context.workspaceState.get<IDEFrozenData>('debugFrozen')
    return { output, pointer, frozen }
}

function render(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    const { output, pointer, frozen } = getDebugState(context)
    const container = parseInsights(output, pointer)

    const int = output?.result?.insights
    if (!container || !int) return

    if (frozen) {
        const paths = frozen.entries.map(it => toCodePathReference(frozen.code, it))
        decorate(paths, true)
    } else {
        const paths = container.insights.map(it => it.path)
        decorate(paths, false)
    }

    providers.forEach(it => it.refresh(int, container))
}

function decorate(paths: Array<CodePathReference>, frozen: boolean) {
    const mutablePaths = [...paths]
    const current: CodePathReference | undefined = mutablePaths.pop()
    const previous: CodePathReference | undefined = mutablePaths.pop()

    const currentDecorations: Array<vscode.Range> = []
    const currentPrefixDecorations: Array<vscode.Range> = []
    const previousDecorations: Array<vscode.Range> = []
    const previousPrefixDecorations: Array<vscode.Range> = []

    if (current) {
        if (previous) {
            if (previous.inline) {
                previousPrefixDecorations.push(new vscode.Range(previous.startRow, 0, previous.startRow, previous.startColumn))
            }

            const inside = previous.startRow <= current.startRow
                && previous.endRow >= current.endRow
                && (previous.startRow != current.startRow || previous.startColumn <= current.startColumn)
                && (previous.endRow != current.endRow || previous.endColumn >= current.endColumn)


            if (inside) {
                previousPrefixDecorations.push(new vscode.Range(previous.startRow, previous.inline ? previous.startColumn : 0, current.startRow, current.startColumn))
                previousPrefixDecorations.push(new vscode.Range(current.endRow, current.endColumn, previous.endRow, previous.endColumn))
            } else {
                previousDecorations.push(new vscode.Range(previous.startRow, previous.inline ? previous.startColumn : 0, previous.endRow, previous.endColumn))
            }
        }
        if (current.inline) {
            currentPrefixDecorations.push(new vscode.Range(current.startRow, 0, current.startRow, current.startColumn))
        }
        currentDecorations.push(new vscode.Range(current.startRow, current.inline ? current.startColumn : 0, current.endRow, current.endColumn))
    }

    if (debugEditorUri) {
        vscode.window.showTextDocument(debugEditorUri).then(editor => {
            editor.setDecorations(previousHighlightPrefix, frozen ? [] : previousPrefixDecorations)
            editor.setDecorations(previousHighlight, frozen ? [] : previousDecorations)
            editor.setDecorations(previousHighlightPrefixFrozen, frozen ? previousPrefixDecorations : [])
            editor.setDecorations(previousHighlightFrozen, frozen ? previousDecorations : [])

            editor.setDecorations(currentHighlightPrefix, frozen ? [] : currentPrefixDecorations)
            editor.setDecorations(currentHighlight, frozen ? [] : currentDecorations)
            editor.setDecorations(currentHighlightPrefixFrozen, frozen ? currentPrefixDecorations : [])
            editor.setDecorations(currentHighlightFrozen, frozen ? currentDecorations : [])
        })
    }
}

async function debugRunCode(): Promise<CodeRunId> {
    const editor = vscode.window.visibleTextEditors.find(it => it.document.languageId !== 'Log')
    if (editor) {
        debugEditorUri = editor.document.uri
        debugCode = editor.document.getText()
        return await runCode({
            language: editor.document.languageId,
            code: debugCode
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
    vscode.commands.executeCommand('setContext', 'multicode-app-debugger.frozen', false)
    vscode.commands.executeCommand('setContext', 'multicode-app-debugger.error', false)
    vscode.commands.executeCommand('multicode-app-debugger.insights.focus')
    output.clear()

    await debugRunLoop(context, providers)
}

export async function debugSync(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    vscode.commands.executeCommand('multicode-app-debugger.insights.focus')

    const { output: oldOutput, frozen } = getDebugState(context)
    if (oldOutput && frozen) {
        await debugRunLoop(
            context,
            providers,
            (newOutput) => fixFrozenCodeRunOutput(oldOutput, newOutput),
            (output) => {
                if (!output.status.done || (output.result !== null && output.result.errors.content.length > 0)) {
                    return
                }

                let set = false

                const reversed = frozen.entries.map(entry => ({ entry, path: toCodePathReference(frozen.code, entry) })).reverse()
                for (let it of reversed) {
                    const index = searchInsightsForRowColumnDepth(output, it.path.startRow, it.path.startColumn, it.entry.depth)
                    if (index !== undefined) {
                        context.workspaceState.update('debugPointer', index)
                        set = true
                        break
                    }
                }

                if (!set) context.workspaceState.update('debugPointer', 0)
            })
    }
}

async function debugRunLoop(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>,
    fixOutput?: (output: CodeRunOutput) => CodeRunOutput,
    preRender?: (output: CodeRunOutput) => void
) {
    await debugRunCode()
        .then(res => {
            vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, cancellable: true }, async (progress, cancel) => {
                return new Promise((resolve) => {
                    progress.report({ message: "Your code is currently in the queue...", increment: 0 })

                    const time = Date.now()

                    const timeoutStep = 500
                    const timeoutMax = 2_000

                    let timeout = timeoutStep
                    let running = true

                    const callback = () => setTimeout(async () => {
                        await requestOutput(
                            res,
                            time,
                            context,
                            providers,
                            progress,
                            cancel,
                            () => resolve(undefined),
                            () => { running = false },
                            fixOutput || ((output) => output),
                            preRender || (() => { })
                        )

                        timeout += timeoutStep
                        if (timeout > timeoutMax) timeout = timeoutMax

                        if (running) callback()
                    }, timeout)

                    callback()
                })
            })
        })
        .catch(message => vscode.window.showErrorMessage(message))
}

async function requestOutput(
    res: CodeRunId,
    time: number,
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>,
    progress: vscode.Progress<{ message: string }>,
    cancel: vscode.CancellationToken,
    resolve: () => void,
    teardown: () => void,
    fixOutput: (output: CodeRunOutput) => CodeRunOutput,
    preRender: (output: CodeRunOutput) => void
) {
    if (cancel.isCancellationRequested || time < Date.now() - 2 * 60 * 1000) {
        debugStop(context, providers)
        resolve()
        teardown()
        return
    }

    await getCodeRunOutput(res.id)
        .then(res => {
            if (res.status.error) {
                vscode.window.showErrorMessage('Server ran into an unexpected error...')
                debugStop(context, providers)
                resolve()
                teardown()
                return
            }

            if (res.status.running) {
                progress.report({ message: "Your code is now running..." })
            }

            let out = res
            if (res.result && res.result.insights !== null) {
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
            out = fixOutput(out)

            if (out.result !== null) {
                output.clear()
                if (out.result && out.result.errors.content.length > 0) {
                    printToOutput(output, '[error]:', out.result.errors)
                    output.appendLine('')
                }

                if (out.result && out.result.output.content.length > 0) {
                    printToOutput(output, '[output]:', out.result.output)
                }

                context.workspaceState.update('debugOutput', out)
                context.workspaceState.update('debugPointer', 0)
                context.workspaceState.update('debugFrozen', undefined)
                vscode.commands.executeCommand('setContext', 'multicode-app-debugger.frozen', false)

                preRender(out)
                render(context, providers)

                resolve()
                teardown()
                return
            }
        })
}

export function debugFreeze(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    const { output, pointer } = getDebugState(context)
    if (output && output.result) {
        setFrozen(context, initFrozenData(output, pointer))
        render(context, providers)
    }
}

export async function debugStop(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>
) {
    vscode.commands.executeCommand('setContext', 'multicode-app-debugger.debugging', false)
    vscode.commands.executeCommand('setContext', 'multicode-app-debugger.frozen', false)
    vscode.commands.executeCommand('setContext', 'multicode-app-debugger.error', false)
    context.workspaceState.update('debugOutput', undefined)
    context.workspaceState.update('debugPointer', undefined)
    context.workspaceState.update('debugFrozen', undefined)

    if (debugEditorUri) {
        const editor = vscode.window.visibleTextEditors.find(it => it.document.uri === debugEditorUri)
        if (editor) {
            editor.setDecorations(previousHighlightPrefix, [])
            editor.setDecorations(previousHighlight, [])
            editor.setDecorations(previousHighlightPrefixFrozen, [])
            editor.setDecorations(previousHighlightFrozen, [])

            editor.setDecorations(currentHighlightPrefix, [])
            editor.setDecorations(currentHighlight, [])
            editor.setDecorations(currentHighlightPrefixFrozen, [])
            editor.setDecorations(currentHighlightFrozen, [])
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

function initFrozenData(
    output: CodeRunOutput,
    pointer: number | undefined
): IDEFrozenData {
    const code = debugCode
    const container = parseInsights(output, pointer)
    if (container !== undefined) {
        const list = code.split("\n")
        const indexed = list.map((value, index) => ({ value, index }))

        const getIndex = (row: number, column: number) => indexed.reduce((acc, curr) => {
            if (curr.index < row) {
                return acc + curr.value.length + 1
            } else if (curr.index === row) {
                return acc + column
            } else {
                return acc
            }
        }, 0)

        return {
            code: code,
            entries: container.insights.map(it => {
                const startIndex = getIndex(it.path.startRow, it.path.startColumn)
                const endIndex = getIndex(it.path.endRow, it.path.endColumn)
                const depth = parseInsightsDepth(output, pointer, it.path)
                return {
                    offset: startIndex,
                    length: endIndex - startIndex,
                    depth: depth || 0
                }
            })
        }
    } else {
        return { code: code, entries: [] }
    }
}

function setFrozen(
    context: vscode.ExtensionContext,
    frozen: IDEFrozenData
) {
    vscode.commands.executeCommand('setContext', 'multicode-app-debugger.frozen', true)
    context.workspaceState.update('debugFrozen', frozen)
}

export function debugOnEdit(
    context: vscode.ExtensionContext,
    providers: Array<MulticodeTreeProvider>,
    uri: vscode.Uri,
    changes: ReadonlyArray<vscode.TextDocumentContentChangeEvent>
) {
    if (debugEditorUri !== uri) {
        return
    }

    const { output, pointer, frozen } = getDebugState(context)
    if (output && output.result) {
        let newFrozen = frozen || initFrozenData(output, pointer)

        changes.forEach(change => {
            const offset = change.rangeOffset
            const length = change.rangeLength

            const diff = change.text.length - length
            const newEntries = newFrozen.entries.map(it => {
                let newOffset = it.offset
                let newLength = it.length
                if (offset < it.offset + it.length) {
                    if (offset > it.offset) {
                        newLength += diff
                    } else {
                        newOffset += diff
                    }
                }
                return { ...it, offset: newOffset, length: newLength }
            })

            newFrozen = {
                code: newFrozen.code.substring(0, offset) + change.text + newFrozen.code.substring(offset + length),
                entries: newEntries
            }
        })

        setFrozen(context, newFrozen)
        render(context, providers)
    }
}

function toCodePathReference(code: string, entry: IDEFrozenDataEntry): CodePathReference {
    const start = code.substring(0, entry.offset)
    const startSplit = start.split("\n")

    const end = code.substring(0, entry.offset + entry.length)
    const endSplit = end.split("\n")

    return {
        node: null,
        startRow: startSplit.length - 1,
        startColumn: startSplit[startSplit.length - 1].length,
        endRow: endSplit.length - 1,
        endColumn: endSplit[endSplit.length - 1].length,
        inline: true
    }
}
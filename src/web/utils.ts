import * as vscode from 'vscode';
import { CodePathReference, CodeRunOutput, FileContent, Insights, InsightsContainer, Scope } from './types';

export function printToOutput(output: vscode.OutputChannel, header: string, file: FileContent) {
    output.show()
    output.appendLine(header)
    file.content.forEach(line => output.appendLine(line))
    if (file.exceededFileSize) {
        output.appendLine('... (exceeded size)')
    }
}

function fromHex(item: string) {
    return parseInt(item, 16)
}

export function fixFrozenCodeRunOutput(
    oldOutput: CodeRunOutput,
    newOutput: CodeRunOutput
): CodeRunOutput {
    if (
        oldOutput.result !== null
        && (!newOutput.status.done || (newOutput.result !== null && newOutput.result.errors.content.length > 0))
    ) {
        return { ...newOutput, result: { ...oldOutput.result, errors: newOutput.result ? newOutput.result.errors : oldOutput.result.errors } }
    } else {
        return newOutput
    }
}

export function parseInsights(
    output: CodeRunOutput | undefined,
    pointer: number | undefined
): InsightsContainer | undefined {
    if (output && output.result && output.result.insights && pointer !== undefined) {
        const insights = output.result.insights

        if (insights.error || insights.encoding.length === 0) {
            return undefined
        }

        let encoding: string | undefined = insights.encoding.split('|')[pointer]
        if (encoding !== undefined) {
            // gets only definition
            let toDefinition = (item: string | undefined) => {
                if (item === undefined) {
                    return []
                }
                const list = []
                while (item.length > 0) {
                    const definition = fromHex(item.substring(0, 3))
                    item = item.substring(3)
                    list.push(definition)
                }
                return list
            }

            // gets reference and definition for a given item
            let toReferenceAndDefinition = (item: string | undefined) => {
                if (item === undefined) {
                    return []
                }
                const list = []
                while (item.length > 0) {
                    const reference = fromHex(item.substring(0, 3))
                    const definition = fromHex(item.substring(3, 6))
                    item = item.substring(6)
                    list.push({
                        reference: reference,
                        definition: definition
                    })
                }
                return list
            }

            // gets scope: classes, functions and variables for a given item
            let getScope = (item: string) => {
                const split = item.split("/")
                const c = split[0]
                const f = split[1]
                const v = split[2]
                const fn = split[3]

                const classes = toDefinition(c)
                const functions = toReferenceAndDefinition(f)
                const variables = toReferenceAndDefinition(v)
                const functionName = fn ? fromHex(fn) : null

                return {
                    classes: classes,
                    functions: functions,
                    variables: variables,
                    functionName: functionName
                }
            }

            const moduleIndex: number = fromHex(encoding.substring(0, 3))
            encoding = encoding.substring(3)

            // use the decoding to get the path and scope
            const res: Array<Insights> = encoding.split(".").map((item) => {
                const path: number = fromHex(item.substring(0, 3))
                const pathReference = insights.pathReferences[path]
                const scope: Scope = getScope(item.substring(3))

                return {
                    path: pathReference,
                    scope: scope
                }
            })

            return {
                moduleIndex: moduleIndex,
                insights: res
            }
        }
    } else {
        return undefined
    }
}

export function parseInsightsDepth(
    output: CodeRunOutput | undefined,
    pointer: number | undefined,
    path: CodePathReference
): number | undefined {
    // if there are insights
    if (output && output.result && output.result.insights && pointer !== undefined) {
        const insights = output.result.insights

        if (insights.error || insights.encoding.length === 0) {
            return undefined
        }

        let encodings = insights.encoding.split("|")
        let depth = -1

        for (let encodingIndex = pointer; encodingIndex >= 0; encodingIndex--) {
            let encoding = encodings[encodingIndex]
            let items = encoding.substring(3).split(".")
            let lastPath = fromHex(items[items.length - 1].substring(0, 3))
            let lastPathReference = insights.pathReferences[lastPath]
            if (lastPathReference.startRow === path.startRow && lastPathReference.startColumn === path.startColumn) {
                depth++
            }
        }
        return depth
    }

    return undefined
}

export function searchInsightsForRowColumnDepth(
    output: CodeRunOutput | undefined,
    row: number,
    column: number,
    depth: number
): number | undefined {
    // if there are insights
    if (output && output.result && output.result.insights) {
        const insights = output.result.insights

        if (insights.error || insights.encoding.length === 0) {
            return undefined
        }

        let currentDepth = 0
        let lastIndex: number | undefined = undefined

        let encodings = insights.encoding.split("|")
        for (let index = 0; index < encodings.length; index++) {
            let encoding = encodings[index]
            let items = encoding.substring(3).split(".")
            let lastPath = fromHex(items[items.length - 1].substring(0, 3))
            let lastPathReference = insights.pathReferences[lastPath]
            if (lastPathReference.startRow === row && lastPathReference.startColumn === column) {
                if (currentDepth >= depth) {
                    return index
                } else {
                    currentDepth++
                    lastIndex = index
                }
            }
        }
        return lastIndex
    }

    return undefined
}
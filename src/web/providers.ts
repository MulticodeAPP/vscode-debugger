import * as vscode from 'vscode';
import { CodeClassFunctionDefinition, CodeClassFunctionParameter, CodeFunctionParameter, InsightsContainer, InsightsOutput, ObjectReference } from './types';

export type MulticodeTreeItem =
    { kind: 'classes' }
    | { kind: 'class', functions: Array<CodeClassFunctionDefinition> } & Element
    | { kind: 'class_function', parameters: Array<CodeClassFunctionParameter> } & Element
    | { kind: 'functions' }
    | { kind: 'function', parameters: Array<CodeFunctionParameter> } & Element
    | { kind: 'variables' }
    | { kind: 'raw', children: Array<MulticodeTreeItem> } & Element
    | { kind: 'string' } & Element

type Element = {
    value: string
    description: string | undefined
    icon: string | undefined
}

function addDetails(item: vscode.TreeItem, element: Element) {
    item.description = element.description
    item.iconPath = element.icon ? new vscode.ThemeIcon(element.icon) : undefined
    return item
}

function parseToString(value: any): string {
    return typeof value === 'string' ? `"${value}"` : value.toString()
}

function parseValue(name: string | undefined, description: string | undefined, value: any): MulticodeTreeItem {
    try {
        const json = typeof value === 'string' ? JSON.parse(value) : value
        if (json instanceof Array) {
            return {
                kind: 'raw',
                value: name || '[]',
                description: description,
                icon: 'symbol-variable',
                children: json.map(it => parseValue(undefined, undefined, typeof it === 'string' ? parseToString(it) : it))
            }
        } else if (json instanceof Object) {
            return {
                kind: 'raw',
                value: name || '{}',
                description: description,
                icon: 'symbol-variable',
                children: Object.keys(json).map(it => parseValue(it, undefined, typeof json[it] === 'string' ? parseToString(json[it]) : json[it]))
            }
        }
    } catch {
        // ignore, fallback to a simple string
    }

    const parsed = typeof value === 'string' ? value : parseToString(value)

    if (name === undefined) {
        return {
            kind: 'string',
            value: parsed,
            description: description,
            icon: 'symbol-variable'
        }
    }

    return {
        kind: 'string',
        value: `${name}: ${parsed}`,
        description: description,
        icon: 'symbol-variable'
    }
}

export abstract class MulticodeTreeProvider implements vscode.TreeDataProvider<MulticodeTreeItem> {

    private _onDidChangeTreeData = new vscode.EventEmitter<MulticodeTreeItem | undefined>()
    onDidChangeTreeData: vscode.Event<MulticodeTreeItem | void | MulticodeTreeItem[] | null | undefined> = this._onDidChangeTreeData.event

    protected _output: InsightsOutput | undefined = undefined
    protected _container: InsightsContainer | undefined = undefined

    refresh(
        output: InsightsOutput | undefined,
        container: InsightsContainer | undefined
    ) {
        this._onDidChangeTreeData.fire(undefined)
        this._output = output
        this._container = container
    }

    abstract getTreeItem(element: MulticodeTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem>
    abstract getChildren(element?: MulticodeTreeItem | undefined): vscode.ProviderResult<MulticodeTreeItem[]>
}

export class InsightsProvider extends MulticodeTreeProvider {
    getTreeItem(element: MulticodeTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        switch (element.kind) {
            case 'classes': return new vscode.TreeItem('Classes', vscode.TreeItemCollapsibleState.Expanded)
            case 'functions': return new vscode.TreeItem('Functions', vscode.TreeItemCollapsibleState.Expanded)
            case 'variables': return new vscode.TreeItem('Variables', vscode.TreeItemCollapsibleState.Expanded)

            case 'class': return addDetails(new vscode.TreeItem(
                element.value,
                element.functions.length === 0
                    ? vscode.TreeItemCollapsibleState.None
                    : vscode.TreeItemCollapsibleState.Expanded
            ), element)

            case 'class_function':
            case 'function': return addDetails(new vscode.TreeItem(
                element.value,
                element.parameters.length === 0
                    ? vscode.TreeItemCollapsibleState.None
                    : vscode.TreeItemCollapsibleState.Expanded
            ), element)

            case 'raw': return addDetails(new vscode.TreeItem(element.value, vscode.TreeItemCollapsibleState.Expanded), element)
            case 'string': return addDetails(new vscode.TreeItem(element.value), element)

            default: return new vscode.TreeItem('')
        }
    }

    getChildren(element?: MulticodeTreeItem): vscode.ProviderResult<MulticodeTreeItem[]> {
        const output = this._output
        if (!output || !this._container) return []

        const classes: Array<number> = []
        const functions: Array<ObjectReference> = []
        const variables: Array<ObjectReference> = []

        const insights = [...this._container.insights]
        let stop = false
        while (insights.length > 0 && !stop) {
            const insight = insights.pop()!!
            stop = insight.scope.functionName !== null
            classes.splice(0, 0, ...insight.scope.classes)
            functions.splice(0, 0, ...insight.scope.functions)
            variables.splice(0, 0, ...insight.scope.variables)
        }

        const current = this._container.insights[this._container.insights.length - 1]
        if (!current) return []

        switch (element?.kind) {
            case undefined:
                const tabs: Array<MulticodeTreeItem> = []
                if (classes.length > 0) tabs.push({ kind: 'classes' })
                if (functions.length > 0) tabs.push({ kind: 'functions' })
                if (variables.length > 0) tabs.push({ kind: 'variables' })
                return tabs

            case 'classes':
                return classes.map(it => {
                    const clazz = output.classes[it]
                    const name = output.names[clazz.name] || ''
                    return {
                        kind: 'class',
                        value: name,
                        description: undefined,
                        icon: 'symbol-class',
                        functions: clazz.functions
                    }
                })

            case 'class':
                return element.functions.map(it => {
                    const name = output.names[it.name] || ''
                    const returnType = it.returnType !== null ? output.types[it.returnType] : null

                    return {
                        kind: 'class_function',
                        value: name,
                        description: returnType ? returnType : undefined,
                        icon: 'symbol-method',
                        parameters: it.parameters
                    }
                })

            case 'functions':
                return functions.map(it => {
                    const name = output.names[it.reference] || ''
                    const definition = output.functions[it.definition]
                    const type = definition.type !== null ? output.types[definition.type] : null

                    return {
                        kind: 'function',
                        value: `${name}: ${definition.value || ''}`,
                        description: type ? type : undefined,
                        icon: 'symbol-method',
                        parameters: definition.parameters
                    }
                })

            case 'function':
            case 'class_function':
                return element.parameters.map(it => {
                    const name = output.names[it.name] || ''
                    const type = it.type !== null ? output.types[it.type] : null

                    return {
                        kind: 'string',
                        value: name,
                        description: type ? type : undefined,
                        icon: 'symbol-variable'
                    }
                })

            case 'variables':
                return variables.map(it => {
                    const name = output.names[it.reference] || ''
                    const definition = output.variables[it.definition]
                    const type = definition.type !== null ? output.types[definition.type] : null

                    const value = definition.value || ''

                    return parseValue(name, type ? type : undefined, value)
                })

            case 'raw': return element.children

            default:
                return []
        }
    }
}

export class StackFramesProvider extends MulticodeTreeProvider {
    getTreeItem(element: MulticodeTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        if (element.kind === 'string') {
            return addDetails(new vscode.TreeItem(element.value), element)
        } else {
            return new vscode.TreeItem('')
        }
    }

    getChildren(element?: MulticodeTreeItem): vscode.ProviderResult<MulticodeTreeItem[]> {
        const output = this._output
        if (element || !output || !this._container) return []

        let previousFunctionNumber: number | null = null
        const out: Array<{ functionName: string, row: number }> = []
        this._container.insights.forEach(it => {
            let functionNumber = it.scope.functionName || previousFunctionNumber
            previousFunctionNumber = functionNumber

            let functionName = '<initial>'
            if (functionNumber !== null) {
                const name = output.names[functionNumber]
                if (name) functionName = name
            }

            if (out.length > 0 && out[out.length - 1].functionName === functionName) {
                out.pop()
            }

            out.push({
                functionName: functionName,
                row: it.path.startRow + 1
            })
        })

        return out.map<MulticodeTreeItem>(it => ({ kind: 'string', value: `${it.functionName}:${it.row}`, description: undefined, icon: undefined })).reverse()
    }
}
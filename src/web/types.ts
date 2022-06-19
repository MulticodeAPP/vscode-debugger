export type CodeRunInput = {
    language: string
    code: string
}

export type CodeRunId = {
    id: string
    idShortened: string | null
}

export type CodeRunOutput = {
    status: CodeRunOutputStatus
    result: CodeOutput | null
}

export type CodeRunOutputStatus = {
    running: boolean
    error: boolean
    done: boolean
}

export type CodeOutput = {
    output: FileContent
    errors: FileContent
    insights: InsightsOutput | null
    nodes: Array<CodeNodeSimple> | null
    timing: CodeTimingOutput
}

export type FileContent = {
    content: Array<string>
    exceededFileSize: boolean
}

export type InsightsOutput = {
    pathReferences: Array<CodePathReference>
    names: Array<string | null>
    types: Array<string | null>
    classes: Array<CodeClassDefinition>,
    functions: Array<CodeFunctionDefinition>,
    variables: Array<CodeVariableDefinition>,
    exceededInsightsSize: boolean
    encoding: string
    error: boolean
}

type CodeTimingOutput = {
    queue: number
    execute: CodeTimingExecuteOutput
    stdio: number
    insights: EncodingCompressOutput
    module: EncodingCompressOutput
    testGroups: number
    total: number
}

type CodeTimingExecuteOutput = {
    standard: ProcessCodeTiming
    insights: ProcessCodeTiming
    total: number
}

type ProcessCodeTiming = {
    compile: number | null
    run: number | null
    timeout: boolean
}

type EncodingCompressOutput = {
    time: number
    compress: number | null
    total: number
}

export type CodePathReference = {
    node: CodeNodeSimple | null
    startRow: number
    startColumn: number
    endRow: number
    endColumn: number
}

type CodeClassDefinition = {
    name: number
    functions: Array<CodeClassFunctionDefinition>
}

export type CodeClassFunctionDefinition = {
    name: number
    returnType: number | null
    parameters: Array<CodeClassFunctionParameter>
}

export type CodeClassFunctionParameter = {
    name: number
    type: number | null
}

type CodeFunctionDefinition = {
    type: number | null
    value: string | null
    returnType: number | null
    parameters: Array<CodeFunctionParameter>
}

export type CodeFunctionParameter = {
    name: number
    type: number | null
}

type CodeVariableDefinition = {
    type: number | null
    value: string | null
}

export type InsightsContainer = {
    moduleIndex: number
    insights: Array<Insights>
}

export type Insights = {
    path: CodePathReference
    scope: Scope
}

export type Scope = {
    classes: Array<number>
    functions: Array<ObjectReference>
    variables: Array<ObjectReference>
    functionName: number | null
}

export type ObjectReference = {
    reference: number
    definition: number
}

export type CodeNodeSimple = {
    text: string
    indent: number
    variables: Array<string>
    identifiers: Array<string>
    miscIdentifiers: Array<string>
}
import * as vscode from 'vscode';
import { API_BASE_URL } from './constants';
import { CodeRunId, CodeRunInput, CodeRunOutput } from "./types"

export async function runCode(
    input: CodeRunInput
): Promise<CodeRunId> {
    return await fetch(`${API_BASE_URL}/code/run`, {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
    }).then(async res => {
        const json = await res.json()
        if (res.ok) {
            return json
        } else {
            throw Error(json.message)
        }
    }).catch(e => vscode.window.showErrorMessage(e.message || "Something went wrong"))
}

export async function getCodeRunOutput(
    id: string
): Promise<CodeRunOutput> {
    return await fetch(`${API_BASE_URL}/code/output?id=${id}&includeInsights=true`)
        .then(async res => {
            const json = await res.json()
            if (res.ok) {
                return json
            } else {
                throw Error(json.message)
            }
        }).catch(e => vscode.window.showErrorMessage(e.message || "Something went wrong"))
}
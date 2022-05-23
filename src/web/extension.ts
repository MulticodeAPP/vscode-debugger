// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.commands.registerCommand('multicode-app-debugger.runCodeOpenExternal', async () => {
		const editor = vscode.window.activeTextEditor
		if (editor) {
			await fetch('https://api.multicode.app/code/run', {
				method: 'POST',
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					language: editor.document.languageId,
					code: editor.document.getText()
				})
			}).then(async res => {
				const r = await res.json()
				if (res.ok) {
					const { id, idShortened } = r
					vscode.env.openExternal(vscode.Uri.parse(`https://multicode.app/ide/l/${idShortened || id}`))
				} else {
					throw Error(r.message)
				}
			}).catch(e => vscode.window.showErrorMessage(e.message || "Something went wrong"))
		} else {
			vscode.window.showErrorMessage("No active text editor to run code from.")
		}
	}))
}

// this method is called when your extension is deactivated
export function deactivate() { }

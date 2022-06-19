import * as vscode from 'vscode';
import { debugJumpToEnd, debugJumpToStart, debugStart, debugStartOpenExternal, debugStepBackwards, debugStepForwards, debugStop } from './commands';
import { InsightsProvider, StackFramesProvider } from './providers';

export function activate(context: vscode.ExtensionContext) {
	const insightsProvider = new InsightsProvider()
	const stackFramesProvider = new StackFramesProvider()
	const providers = [insightsProvider, stackFramesProvider]

	vscode.window.createTreeView('multicode-app-debugger.insights', { treeDataProvider: insightsProvider })
	vscode.window.createTreeView('multicode-app-debugger.stack-frames', { treeDataProvider: stackFramesProvider })

	context.subscriptions.push(vscode.commands.registerCommand('multicode-app-debugger.debugStartOpenExternal', debugStartOpenExternal))
	context.subscriptions.push(vscode.commands.registerCommand('multicode-app-debugger.debugStart', () => debugStart(context, providers)))
	context.subscriptions.push(vscode.commands.registerCommand('multicode-app-debugger.debugStop', () => debugStop(context, providers)))
	context.subscriptions.push(vscode.commands.registerCommand('multicode-app-debugger.debugStepForwards', () => debugStepForwards(context, providers)))
	context.subscriptions.push(vscode.commands.registerCommand('multicode-app-debugger.debugStepBackwards', () => debugStepBackwards(context, providers)))
	context.subscriptions.push(vscode.commands.registerCommand('multicode-app-debugger.debugJumpToStart', () => debugJumpToStart(context, providers)))
	context.subscriptions.push(vscode.commands.registerCommand('multicode-app-debugger.debugJumpToEnd', () => debugJumpToEnd(context, providers)))
}

// this method is called when your extension is deactivated
export function deactivate() { }

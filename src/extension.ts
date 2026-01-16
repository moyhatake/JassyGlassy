import * as vscode from 'vscode';
import * as cp from 'child_process';

const MAX_OPACITY = 0xFFFFFFFF;

let outputChannel: vscode.OutputChannel;
let debugEnabled = false;

// Logging helpers
function log(message: string) {
    if (debugEnabled) {
        outputChannel.appendLine(message);
    }
}

function logError(message: string, error?: unknown) {
    outputChannel.appendLine(
        error ? `[Error] ${message}: ${String(error)}` : `[Error] ${message}`
    );
}

// Extension lifecycle
export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration("jassyglassy");
    debugEnabled = config.get<boolean>("debug", false);

    outputChannel = vscode.window.createOutputChannel("JassyGlassy");

    if (debugEnabled) {
        outputChannel.show(true);
        log("Debug logging enabled");
    }

    log("JassyGlassy activating...");

    // Helpers
    const getPreferredOpacity = (): number => {
        const target = config.get<number>('targetOpacity', 85) / 100;
        return context.globalState.get<number>('preferredOpacity', target);
    };

    const execShell = (cmd: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            cp.exec(cmd, (err, stdout) => {
                if (err) {
                    logError("Shell command failed", err.message);
                    return reject(err);
                }
                resolve(stdout.trim());
            });
        });
    };

    const getActiveWindowId = async (): Promise<string> => {
        try {
            const output = await execShell('xprop -root _NET_ACTIVE_WINDOW');
            const match = output.match(/window id # (0x[0-9a-fA-F]+)/);
            if (!match) {
                log(`Active window regex failed: ${output}`);
                return '';
            }
            return match[1];
        } catch (e) {
            logError("Failed to get active window ID", e);
            return '';
        }
    };

    const getOpacity = async (windowId: string): Promise<number> => {
        try {
            const output = await execShell(`xprop -id ${windowId} _NET_WM_WINDOW_OPACITY`);
            if (output.includes('not found')) return 1.0;
            const match = output.match(/=\s(\d+)/);
            return match ? parseInt(match[1], 10) / MAX_OPACITY : 1.0;
        } catch {
            return 1.0;
        }
    };

    const setOpacity = async (windowId: string, opacity: number): Promise<number> => {
        const minOpacity = (config.get<number>('minimum', 25)) / 100;
        const clamped = Math.max(minOpacity, Math.min(1.0, opacity));
        const val = Math.floor(clamped * MAX_OPACITY);

        log(`Setting ${windowId} opacity → ${Math.round(clamped * 100)}%`);

        try {
            await execShell(
                `xprop -id ${windowId} -f _NET_WM_WINDOW_OPACITY 32c -set _NET_WM_WINDOW_OPACITY ${val}`
            );
        } catch (e) {
            logError("Failed to set window opacity", e);
        }

        return clamped;
    };

    const changeOpacity = async (direction: number) => {
        const step = (config.get<number>('step', 5)) / 100;
        const winId = await getActiveWindowId();
        if (!winId) return;

        const current = await getOpacity(winId);
        const newOpacity = await setOpacity(winId, current + (step * direction));

        if (newOpacity < 0.99) {
            await context.globalState.update('preferredOpacity', newOpacity);
            log(`Preferred opacity saved: ${Math.round(newOpacity * 100)}%`);
        }
    };

    const toggleOpacity = async () => {
        const winId = await getActiveWindowId();
        if (!winId) return;

        const current = await getOpacity(winId);
        if (current >= 0.98) {
            const preferred = getPreferredOpacity();
            log(`Toggle ON → ${Math.round(preferred * 100)}%`);
            await setOpacity(winId, preferred);
        } else {
            log("Toggle OFF → 100%");
            await setOpacity(winId, 1.0);
        }
    };

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('jassyglassy.increase', () => changeOpacity(1)),
        vscode.commands.registerCommand('jassyglassy.decrease', () => changeOpacity(-1)),
        vscode.commands.registerCommand('jassyglassy.toggle', toggleOpacity)
    );

    // Startup behavior
    setTimeout(async () => {
        log("Applying startup opacity");
        const winId = await getActiveWindowId();
        if (winId) {
            await setOpacity(winId, getPreferredOpacity());
        }
    }, 1500);
}

export function deactivate() {
    outputChannel?.dispose();
}

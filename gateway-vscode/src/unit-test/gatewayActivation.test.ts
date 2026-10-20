import './vscodeStub';

import * as assert from 'assert';
import type * as vscode from 'vscode';

import { shouldAutoStart } from '../extension/autoStart';
import { updateGatewayStatusBar } from '../extension/statusBar';

type FakeStatusBarItem = {
    text: string;
    tooltip: string | undefined;
    backgroundColor: unknown;
    shown: boolean;
};

function createStatusBarItem(): FakeStatusBarItem & vscode.StatusBarItem {
    const item = {
        text: '',
        tooltip: undefined as string | undefined,
        backgroundColor: undefined as unknown,
        shown: false,
        show() {
            item.shown = true;
        }
    };
    return item as FakeStatusBarItem & vscode.StatusBarItem;
}

suite('Extension activation surface', () => {
    test('never auto-starts unless the setting is on and a workspace is open', () => {
        assert.strictEqual(shouldAutoStart(undefined, true), false);
        assert.strictEqual(shouldAutoStart(false, true), false);
        assert.strictEqual(shouldAutoStart('true', true), false);
        assert.strictEqual(shouldAutoStart(true, false), false);
        assert.strictEqual(shouldAutoStart(true, true), true);
    });

    test('shows a connected suffix only while a browser session is live', () => {
        const online = createStatusBarItem();
        updateGatewayStatusBar(online, true, 34568);
        const connected = createStatusBarItem();
        updateGatewayStatusBar(connected, true, 34568, false, true);

        assert.ok(online.text.includes('34568'), online.text);
        assert.ok(!online.text.includes('·'), 'the plain online state must not claim a connection');
        assert.ok(connected.text.includes('34568'), connected.text);
        assert.ok(connected.text.includes('·'), connected.text);
        assert.notStrictEqual(connected.text, online.text);
        assert.notStrictEqual(connected.tooltip, online.tooltip);
        assert.strictEqual(connected.shown, true);

        const offline = createStatusBarItem();
        updateGatewayStatusBar(offline, false, undefined, false, true);
        assert.ok(!offline.text.includes('·'), 'an offline gateway must not show the connected suffix');
    });
});

import './vscodeStub';

import * as assert from 'assert';

import {
    CONNECT_URI_AUTHORITY,
    CONNECT_URI_PATH,
    isAllowedSiteId,
    parseGatewayConnectUri,
    type VscodeUriLike
} from '../extension/uriHandler';

const CONFIGURED_SITES = ['chatgpt', 'deepseek'];

function link(overrides: Partial<VscodeUriLike> = {}): VscodeUriLike {
    return {
        scheme: 'vscode',
        authority: CONNECT_URI_AUTHORITY,
        path: `/${CONNECT_URI_PATH}`,
        query: '',
        ...overrides
    };
}

suite('Extension deep link', () => {
    test('accepts only the connect action of this extension', () => {
        assert.deepStrictEqual(parseGatewayConnectUri(link()), {});
        assert.deepStrictEqual(parseGatewayConnectUri(link({ path: `/${CONNECT_URI_PATH}/` })), {});
        assert.deepStrictEqual(
            parseGatewayConnectUri(link({ scheme: 'VSCODE', authority: CONNECT_URI_AUTHORITY.toUpperCase() })),
            {}
        );
    });

    test('refuses start-like or unknown actions', () => {
        assert.strictEqual(parseGatewayConnectUri(link({ path: '/start' })), null);
        assert.strictEqual(parseGatewayConnectUri(link({ path: `/${CONNECT_URI_PATH}/start` })), null);
        assert.strictEqual(parseGatewayConnectUri(link({ path: '/' })), null);
        assert.strictEqual(parseGatewayConnectUri(link({ path: '' })), null);
        // An action query parameter cannot smuggle a second action in.
        assert.deepStrictEqual(parseGatewayConnectUri(link({ query: 'action=start' })), {});
    });

    test('refuses other schemes and authorities', () => {
        assert.strictEqual(parseGatewayConnectUri(link({ scheme: 'https' })), null);
        assert.strictEqual(parseGatewayConnectUri(link({ scheme: 'http' })), null);
        assert.strictEqual(parseGatewayConnectUri(link({ authority: 'three-water666.other-extension' })), null);
        assert.strictEqual(parseGatewayConnectUri(link({ authority: '' })), null);
    });

    test('keeps the site parameter advisory and decodes it', () => {
        assert.deepStrictEqual(parseGatewayConnectUri(link({ query: 'site=chatgpt' })), { siteId: 'chatgpt' });
        assert.deepStrictEqual(parseGatewayConnectUri(link({ query: 'site=chat%67pt' })), { siteId: 'chatgpt' });
        assert.deepStrictEqual(parseGatewayConnectUri(link({ query: 'site=%20chatgpt%20' })), { siteId: 'chatgpt' });
        assert.deepStrictEqual(parseGatewayConnectUri(link({ query: 'site=' })), {});
        assert.deepStrictEqual(parseGatewayConnectUri(link({ query: 'site=%20%20' })), {});
    });

    test('allows only configured site ids', () => {
        assert.strictEqual(isAllowedSiteId('chatgpt', CONFIGURED_SITES), true);
        assert.strictEqual(isAllowedSiteId('deepseek', CONFIGURED_SITES), true);
        assert.strictEqual(isAllowedSiteId('unknown-site', CONFIGURED_SITES), false);
        assert.strictEqual(isAllowedSiteId('chatgpt', []), false);
    });
});

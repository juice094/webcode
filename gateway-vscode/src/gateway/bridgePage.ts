import {
    BRANDING,
    BRIDGE_PORT_RANGE_END,
    BRIDGE_PORT_RANGE_START,
    BRIDGE_PROTOCOL_VERSION
} from '@webcode/shared';

export type BridgePageOptions = {
    vscodeExtensionVersion: string;
    releaseUrl: string;
    storeUrl: string;
};

export function renderBridgePage({
    vscodeExtensionVersion,
    releaseUrl,
    storeUrl
}: BridgePageOptions): string {
    return `
                <!DOCTYPE html>
                <html>
                ${renderBridgeHead()}
                <body>
                    ${renderMainCard()}

                    ${renderBridgeData(vscodeExtensionVersion)}

                    ${renderInstallGuide({ releaseUrl, storeUrl })}

                    ${renderPortWarning()}

                    ${renderBridgeScript()}
                </body>
                </html>
            `;
}

export function renderInvalidBridgePage(): string {
    return `<!DOCTYPE html>
                <html>
                ${renderBridgeHead()}
                <body>
                    <div class="card" id="main-card">
                        <h2 id="bridge-title">Invalid bridge target</h2>
                        <p id="bridge-status">This bridge link is no longer valid. Launch codes are single-use and short-lived; the link may have been used or expired.</p>
                        <p class="warn">Go back to VS Code, click ${escapeHtmlText(BRANDING.productName)} in the status bar, and connect again.</p>
                        <hr style="border: none; border-top: 1px solid #333; margin: 18px 0;">
                        <h2 style="font-size: 1.1em; color: #3498db;">链接无效</h2>
                        <p>此连接链接已失效（启动码为一次性且短时有效，可能已被使用或过期）。请回到 VS Code，点击状态栏中的 ${escapeHtmlText(BRANDING.productName)} 重新发起连接。</p>
                    </div>
                </body>
                </html>`;
}

function renderBridgeData(vscodeExtensionVersion: string): string {
    const legacyVersionMismatch = `bridge-protocol-${BRIDGE_PROTOCOL_VERSION}:${vscodeExtensionVersion}`;
    return `<script id="mcp-data" type="application/json">${escapeHtmlText(JSON.stringify({
        // 旧 bridge loader 会先读取这些字段，再检查版本。这里提供非敏感占位值，
        // 让它显示版本不一致，而不是在协议切换期间误报“链接参数无效”。
        token: 'bridge-upgrade-required',
        siteId: 'bridge-upgrade-required',
        target: 'http://127.0.0.1/',
        vscodeExtensionVersion: legacyVersionMismatch,
        currentVscodeExtensionVersion: vscodeExtensionVersion,
        bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION
    }))}</script>`;
}

function renderBridgeHead(): string {
    return `<head>
                    <title>${BRANDING.bridgeName}</title>
                    <style>
                        body { font-family: 'Segoe UI', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #1e1e1e; color: #fff; text-align: center; }
                        .loader { border: 3px solid #333; border-top: 3px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px; }
                        .card { background: #252526; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); max-width: 400px; }
                        h2 { margin-top: 0; color: #3498db; }
                        p { color: #cccccc; }
                        .warn { color: #e67e22; font-size: 0.9em; margin-top: 10px; }
                        button { background: #3498db; border: none; padding: 10px 20px; color: white; border-radius: 4px; cursor: pointer; margin-top: 15px; }
                        button:hover { background: #2980b9; }
                        .download-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
                        .download-link { display:inline-block; color:white; padding:10px 16px; text-decoration:none; border-radius:4px; font-weight:bold; }
                        .download-link.store { background:#2ea043; }
                        .download-link.store:hover { background:#238636; }
                        .download-link.github { background:#e74c3c; }
                        .download-link.github:hover { background:#c0392b; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                </head>`;
}

function renderMainCard(): string {
    return `<div class="card" id="main-card">
                        <div class="loader" id="loader"></div>
                        <h2 id="bridge-title">Connecting to ${BRANDING.productName}...</h2>
                        <p id="bridge-status">Synchronizing with VS Code...</p>
                    </div>`;
}

function renderInstallGuide({ releaseUrl, storeUrl }: Pick<BridgePageOptions, 'releaseUrl' | 'storeUrl'>): string {
    return `<div class="card" id="install-guide" style="display:none; border: 1px solid #e74c3c; box-shadow: 0 4px 15px rgba(231, 76, 60, 0.2);">
                        <h2 id="install-title" style="color:#e74c3c; margin-bottom:10px">⚠️ Extension Required</h2>
                        <p id="install-desc" style="margin-bottom:20px">To enable auto-connection, you need the companion browser extension:</p>
                        <div style="background:#333; padding:10px; border-radius:6px; margin-bottom:20px; font-weight:bold; color:#fff">
                            🧩 ${BRANDING.bridgeName}
                        </div>
                        <div class="download-actions">
                            <a id="install-store-button" class="download-link store" href="${escapeHtmlAttr(storeUrl)}" target="_blank" rel="noopener noreferrer">
                                Chrome Web Store
                            </a>
                            <a id="install-github-button" class="download-link github" href="${escapeHtmlAttr(releaseUrl)}" target="_blank" rel="noopener noreferrer">
                                GitHub Releases
                            </a>
                        </div>
                        <p id="install-warn" class="warn" style="margin-top:15px; font-size:12px">Already installed? Try reloading this page.</p>
                    </div>`;
}

function renderPortWarning(): string {
    return `<div class="card" id="port-warning" style="display:none; border: 1px solid #e67e22; box-shadow: 0 4px 15px rgba(230, 126, 34, 0.2);">
                        <h2 id="port-warning-title" style="color:#e67e22; margin-bottom:10px">⚠️ Port Out of Supported Range</h2>
                        <p id="port-warning-desc" style="margin-bottom:20px"></p>
                        <button onclick="window.location.reload()">Reload</button>
                    </div>`;
}

function renderBridgeScript(): string {
    return `<script>
                        ${renderI18nBootstrapScript()}
                        ${renderInstallDetectionScript()}
                    </script>`;
}

function renderI18nBootstrapScript(): string {
    return `
                        const productName = ${toSafeScriptJson(BRANDING.productName)};
                        const isZh = navigator.language.toLowerCase().startsWith('zh');
                        const bridgeI18n = isZh ? {
                            connectingTitle: '正在连接 ' + productName + '...',
                            connectingStatus: '正在与 VS Code 同步...',
                            installTitle: '需要浏览器扩展',
                            installDesc: '要启用自动连接，您需要先安装配套的浏览器扩展：',
                            storeButton: '去插件商店下载',
                            githubButton: '去 GitHub 下载',
                            installWarn: '如果已经安装，请尝试刷新当前页面。',
                            portOutOfRangeTitle: '⚠️ 端口超出支持范围',
                            portOutOfRangeDesc: '当前页面端口为 {port}，浏览器扩展仅支持网关端口 34567–34576。请在 VS Code 设置中将 webcodeGateway.port 调整到该范围内，然后刷新本页。',
                            handshakeStalledTitle: '⚠️ 扩展已注入但连接未完成',
                            handshakeStalledDesc: '已检测到浏览器扩展，但握手未完成。请确认网关端口在 34567–34576 范围内，然后刷新本页重试。',
                            reloadButton: '刷新页面'
                        } : {
                            connectingTitle: 'Connecting to ' + productName + '...',
                            connectingStatus: 'Synchronizing with VS Code...',
                            installTitle: 'Browser Extension Required',
                            installDesc: 'To enable auto-connection, you need the companion browser extension:',
                            storeButton: 'Download from Store',
                            githubButton: 'Download from GitHub',
                            installWarn: 'Already installed? Try reloading this page.',
                            portOutOfRangeTitle: '⚠️ Port Out of Supported Range',
                            portOutOfRangeDesc: 'This page is served on port {port}, but the browser bridge only supports gateway ports 34567–34576. Set webcodeGateway.port in VS Code to a port inside that range, then reload this page.',
                            handshakeStalledTitle: '⚠️ Extension Detected, Connection Incomplete',
                            handshakeStalledDesc: 'The browser extension injected but did not complete the handshake. Make sure the gateway port is within 34567–34576, then reload this page.',
                            reloadButton: 'Reload'
                        };
                        window.__bridgeI18n = bridgeI18n;
                        document.getElementById('bridge-title').textContent = bridgeI18n.connectingTitle;
                        document.getElementById('bridge-status').textContent = bridgeI18n.connectingStatus;
                        document.getElementById('install-title').textContent = bridgeI18n.installTitle;
                        document.getElementById('install-desc').textContent = bridgeI18n.installDesc;
                        document.getElementById('install-store-button').textContent = bridgeI18n.storeButton;
                        document.getElementById('install-github-button').textContent = bridgeI18n.githubButton;
                        document.getElementById('install-warn').textContent = bridgeI18n.installWarn;
                        const portWarningButton = document.querySelector('#port-warning button');
                        if (portWarningButton) {
                            portWarningButton.textContent = bridgeI18n.reloadButton;
                        }
    `;
}

function renderInstallDetectionScript(): string {
    return `
                        const bridgePortRangeStart = ${BRIDGE_PORT_RANGE_START};
                        const bridgePortRangeEnd = ${BRIDGE_PORT_RANGE_END};
                        const installDetectionTimeoutMs = 10000;
                        const installDetectionPollMs = 100;
                        const bridgeSignalEventName = 'webcode-bridge-extension-installed';
                        let installDetectionSettled = false;
                        let installDetectionTimer = null;
                        let installDetectionPollTimer = null;
                        let installDetectionObserver = null;

                        ${renderInstallDetectionHelpers()}

                        function checkBridgeExtensionSignal() {
                            if (installDetectionSettled) {
                                return;
                            }

                            if (!currentPortInSupportedRange()) {
                                showPortWarning(bridgeI18n.portOutOfRangeTitle, bridgeI18n.portOutOfRangeDesc);
                                return;
                            }

                            if (hasTerminalBridgeState()) {
                                stopInstallDetection();
                            }
                        }

                        function settleInstallDetection() {
                            if (hasTerminalBridgeState()) {
                                stopInstallDetection();
                                return;
                            }

                            if (!currentPortInSupportedRange()) {
                                showPortWarning(bridgeI18n.portOutOfRangeTitle, bridgeI18n.portOutOfRangeDesc);
                                return;
                            }

                            if (hasExtensionMarker()) {
                                showPortWarning(bridgeI18n.handshakeStalledTitle, bridgeI18n.handshakeStalledDesc);
                                return;
                            }

                            stopInstallDetection();
                            document.getElementById('main-card').style.display = 'none';
                            document.getElementById('install-guide').style.display = 'block';
                        }

                        window.addEventListener(bridgeSignalEventName, checkBridgeExtensionSignal);
                        installDetectionObserver = new MutationObserver(checkBridgeExtensionSignal);
                        installDetectionObserver.observe(document.documentElement, {
                            attributes: true,
                            attributeFilter: ['data-extension-installed']
                        });
                        installDetectionObserver.observe(document.body, {
                            attributes: true,
                            attributeFilter: ['data-bridge-state']
                        });
                        installDetectionPollTimer = window.setInterval(checkBridgeExtensionSignal, installDetectionPollMs);
                        installDetectionTimer = window.setTimeout(settleInstallDetection, installDetectionTimeoutMs);
                        checkBridgeExtensionSignal();
    `;
}

function renderInstallDetectionHelpers(): string {
    return `
                        function currentPortInSupportedRange() {
                            const port = Number(window.location.port);
                            return Number.isInteger(port)
                                && port >= bridgePortRangeStart
                                && port <= bridgePortRangeEnd;
                        }

                        function hasExtensionMarker() {
                            return document.documentElement.getAttribute('data-extension-installed') === 'true';
                        }

                        function hasTerminalBridgeState() {
                            const bridgeState = document.body.dataset.bridgeState;
                            return bridgeState === 'conflict'
                                || bridgeState === 'switching'
                                || bridgeState === 'connected'
                                || bridgeState === 'error';
                        }

                        function stopInstallDetection() {
                            if (installDetectionSettled) {
                                return;
                            }

                            installDetectionSettled = true;
                            if (installDetectionTimer !== null) {
                                window.clearTimeout(installDetectionTimer);
                            }
                            if (installDetectionPollTimer !== null) {
                                window.clearInterval(installDetectionPollTimer);
                            }
                            if (installDetectionObserver) {
                                installDetectionObserver.disconnect();
                            }
                            window.removeEventListener(bridgeSignalEventName, checkBridgeExtensionSignal);
                        }

                        function showPortWarning(title, descTemplate) {
                            stopInstallDetection();
                            document.getElementById('main-card').style.display = 'none';
                            document.getElementById('install-guide').style.display = 'none';
                            document.getElementById('port-warning-title').textContent = title;
                            document.getElementById('port-warning-desc').textContent = descTemplate.replace('{port}', window.location.port);
                            document.getElementById('port-warning').style.display = 'block';
                        }
    `;
}

function escapeHtmlAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function toSafeScriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/**
 * headless 装载期 Markdown 加载钩子（过渡手段）。
 *
 * defaults.ts 以 `import promptEn from '../prompts/prompt_en.md'` 内联提示词，
 * 这依赖 webpack 的 loader；tsc 产物在纯 Node 下 require('.md') 会按 JS 解析
 * 并抛 SyntaxError。本模块必须在任何 gateway 代码之前 import，
 * 注册 require.extensions['.md'] 按 UTF-8 文本读出——与 webpack raw-loader 等价
 * （非 __esModule 导出会被 __importDefault 包成 { default: text }，
 * 与 defaults.ts 的默认导入形状一致）。
 *
 * 删除条件：若未来改为构建期把提示词生成 .ts 常量，本文件可删。
 */
import { readFileSync } from 'fs';

type ExtensionHandler = (module: { exports: unknown }, filename: string) => void;
const extensions = (require as unknown as { extensions: Record<string, ExtensionHandler> }).extensions;

for (const ext of ['.md', '.txt']) {
    extensions[ext] = (module, filename) => {
        module.exports = readFileSync(filename, 'utf8');
    };
}

/**
 * UI preview harness.
 *
 * Imports the real style modules instead of copying CSS, so this page cannot
 * drift from the extension. Run with `pnpm --filter bridge-browser run preview:ui`.
 *
 * Each surface renders inside its own shadow root because that is how the
 * extension actually mounts it. `body { width: 290px }` in the popup stylesheet
 * does not apply inside a shadow root, so the frame sets the width instead.
 */

import { SHARED_STYLES } from "../src/styles/shared";
import { POPUP_STYLES } from "../src/popup/popup_styles";
import { APPROVAL_MODAL_STYLE } from "../src/modules/approval_modal_markup";
import { TOOL_ACTIVITY_STYLE_TEXT } from "../src/content/tool_activity_overlay_styles";
import { FOLLOW_UP_COMPOSER_STYLE_TEXT } from "../src/content/follow_up_overlay_styles";
import { LOGGER_STYLE_TEXT } from "../src/modules/logger_styles";

function cloneTemplate(id: string): DocumentFragment {
  const template = document.getElementById(id);
  if (!(template instanceof HTMLTemplateElement)) {
    throw new Error(`Missing template: ${id}`);
  }
  return template.content.cloneNode(true) as DocumentFragment;
}

function mountSurface(options: {
  title: string;
  hint: string;
  templateId: string;
  css: string;
  className: string;
}): HTMLElement {
  const section = document.createElement("section");
  section.className = "stage";

  const heading = document.createElement("h2");
  heading.textContent = options.title;

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = options.hint;

  const frame = document.createElement("div");
  frame.className = options.className;
  const shadow = frame.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = options.css;
  shadow.appendChild(style);
  shadow.appendChild(cloneTemplate(options.templateId));

  section.append(heading, hint, frame);
  return section;
}

const surfaces: HTMLElement[] = [
  mountSurface({
    title: "Popup",
    hint: "真实 POPUP_STYLES + SHARED_STYLES",
    templateId: "popup-template",
    css: `${SHARED_STYLES}\n${POPUP_STYLES}`,
    className: "popup-frame",
  }),
  mountSurface({
    title: "审批弹窗",
    hint: "真实 APPROVAL_MODAL_STYLE，含 ::backdrop",
    templateId: "approval-template",
    css: APPROVAL_MODAL_STYLE,
    className: "dialog-frame",
  }),
  mountSurface({
    title: "注入浮层",
    hint: "真实 TOOL_ACTIVITY_STYLE_TEXT + FOLLOW_UP_COMPOSER_STYLE_TEXT",
    templateId: "overlay-template",
    css: `${TOOL_ACTIVITY_STYLE_TEXT}\n${FOLLOW_UP_COMPOSER_STYLE_TEXT}`,
    className: "overlay-frame",
  }),
  mountSurface({
    title: "浮动日志",
    hint: "真实 LOGGER_STYLE_TEXT",
    templateId: "logger-template",
    css: LOGGER_STYLE_TEXT,
    className: "logger-frame",
  }),
];

const grid = document.getElementById("grid");
if (grid) {
  grid.append(...surfaces);
}

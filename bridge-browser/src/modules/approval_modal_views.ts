import { t } from "./i18n";

export type ModalElements = {
  dialog: HTMLDialogElement;
  viewMain: HTMLElement;
  viewAlways: HTMLElement;
  btnAlways: HTMLButtonElement;
  btnBack: HTMLButtonElement;
  btnReject: HTMLButtonElement;
  btnConfirm: HTMLButtonElement;
  btnConfirmAlways: HTMLButtonElement;
  inputReason: HTMLInputElement;
  btnAllowExact: HTMLButtonElement | null;
  btnAllowExecutable: HTMLButtonElement | null;
  btnAllowPrefix: HTMLButtonElement | null;
};

export type ModalState = {
  rejectStep: number;
};

export function getModalElements(dialog: HTMLDialogElement): ModalElements {
  return {
    dialog,
    viewMain: dialog.querySelector("#view-main") as HTMLElement,
    viewAlways: dialog.querySelector("#view-always-confirm") as HTMLElement,
    btnAlways: dialog.querySelector(".btn-always") as HTMLButtonElement,
    btnBack: dialog.querySelector(".btn-back") as HTMLButtonElement,
    btnReject: dialog.querySelector(".btn-reject") as HTMLButtonElement,
    btnConfirm: dialog.querySelector(".btn-confirm") as HTMLButtonElement,
    btnConfirmAlways: dialog.querySelector(".btn-confirm-always") as HTMLButtonElement,
    inputReason: dialog.querySelector(".reason") as HTMLInputElement,
    btnAllowExact: dialog.querySelector<HTMLButtonElement>(".btn-allow-exact"),
    btnAllowExecutable: dialog.querySelector<HTMLButtonElement>(".btn-allow-executable"),
    btnAllowPrefix: dialog.querySelector<HTMLButtonElement>(".btn-allow-prefix"),
  };
}

export function showAlwaysApprovalView(
  elements: ModalElements,
  isCommandScopedApproval: boolean,
  mandatory: boolean
): void {
  elements.viewMain.style.display = "none";
  elements.viewAlways.hidden = false;
  elements.btnAlways.style.display = "none";
  elements.btnReject.style.display = "none";
  elements.btnConfirm.style.display = "none";
  elements.btnBack.style.display = "inline-block";
  elements.btnConfirmAlways.style.display = isCommandScopedApproval ? "none" : "inline-block";
  elements.btnAlways.hidden = mandatory;
  focusFirstScopeAction(elements);
}

function focusFirstScopeAction(elements: ModalElements): void {
  const target = elements.btnAllowExact
    ?? elements.btnAllowExecutable
    ?? elements.btnAllowPrefix
    ?? elements.btnConfirmAlways
    ?? elements.btnBack;
  if (target && !target.disabled) {
    target.focus({ preventScroll: true });
    return;
  }
  elements.btnBack.focus({ preventScroll: true });
}

export function showRejectReasonView(elements: ModalElements, state: ModalState): void {
  state.rejectStep = 1;
  elements.inputReason.style.display = "block";
  elements.inputReason.focus();
  elements.btnReject.textContent = t("btn_reject_confirm");
  elements.btnConfirm.style.display = "none";
  elements.btnAlways.style.display = "none";
  elements.btnConfirmAlways.style.display = "none";
  elements.btnBack.style.display = "inline-block";
}

export function resetModalView(elements: ModalElements, state: ModalState, mandatory: boolean): void {
  state.rejectStep = 0;
  elements.inputReason.style.display = "none";
  elements.inputReason.value = "";
  elements.btnReject.textContent = t("btn_reject");
  elements.viewMain.style.display = "block";
  elements.viewAlways.hidden = true;
  elements.btnConfirm.style.display = "inline-block";
  elements.btnReject.style.display = "inline-block";
  elements.btnAlways.style.display = mandatory ? "none" : "inline-block";
  elements.btnAlways.hidden = mandatory;
  elements.btnBack.style.display = "none";
  elements.btnConfirmAlways.style.display = "none";
  elements.btnConfirm.focus({ preventScroll: true });
}

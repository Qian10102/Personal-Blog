import { validSessionSize } from "./study-session";

export function sessionSizeControl(root: HTMLElement, mode: () => string) {
  const preset = root.querySelector<HTMLSelectElement>("[data-size-preset]")!;
  const custom = root.querySelector<HTMLInputElement>("[data-size-custom]")!;
  const key = () => `vocabulary-round-size:${mode()}`;
  function render() {
    custom.disabled = preset.value !== "custom";
    root.querySelector<HTMLElement>("[data-custom-size]")!.hidden =
      custom.disabled;
    custom.setCustomValidity("");
  }
  function remember() {
    const value = validSessionSize(
      custom.disabled ? preset.value : custom.value,
    );
    if (value) {
      try {
        localStorage.setItem(key(), String(value));
      } catch {
        /* Optional preference. */
      }
    }
  }
  function restore() {
    let count = 10;
    try {
      count = validSessionSize(localStorage.getItem(key())) ?? 10;
    } catch {
      /* Default. */
    }
    preset.value = [10, 20, 30, 50].includes(count) ? String(count) : "custom";
    custom.value = String(count);
    render();
  }
  preset.addEventListener("change", () => {
    render();
    remember();
  });
  custom.addEventListener("input", () => {
    custom.setCustomValidity("");
    remember();
  });
  restore();
  return {
    restore,
    read() {
      const count = validSessionSize(
        custom.disabled ? preset.value : custom.value,
      );
      if (!count) {
        custom.setCustomValidity(
          document.documentElement.lang.startsWith("zh")
            ? "请输入正整数。"
            : "Enter a positive whole number.",
        );
        custom.reportValidity();
      } else remember();
      return count;
    },
  };
}

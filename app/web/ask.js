export function ask(message) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog"),
      text = document.createElement("p"),
      yes = document.createElement("button"),
      no = document.createElement("button");
    dialog.setAttribute("aria-label", "Подтверждение");
    text.textContent = message;
    yes.textContent = "Продолжить";
    yes.className = "primary";
    no.textContent = "Отмена";
    const done = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    dialog.oncancel = (e) => {
      e.preventDefault();
      done(false);
    };
    dialog.append(text, yes, no);
    document.body.append(dialog);
    dialog.showModal();
    no.focus();
  });
}

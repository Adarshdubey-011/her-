// A PIN pad: dots + 12 buttons + physical keyboard. Calls onDone(pin) when `len` digits are entered.
import { esc } from "../util.js";

export function pinpad(root, { len = 4, onDone, labels = {} }) {
  let pin = "", locked = false;
  root.innerHTML = `<div class="dots" role="status" aria-label="${esc(labels.aria || "PIN")}">${"<i></i>".repeat(len)}</div>
    <div class="pinmsg" aria-live="polite"></div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join("")}<button type="button" data-k="back" aria-label="${esc(labels.back || "Delete")}">⌫</button><button type="button" data-k="0">0</button><span></span></div>`;
  const dots = [...root.querySelectorAll(".dots i")], msg = root.querySelector(".pinmsg");
  const paint = () => dots.forEach((d, i) => d.classList.toggle("on", i < pin.length));
  const press = (k) => {
    if (locked) return;
    if (k === "back") pin = pin.slice(0, -1);
    else if (/^\d$/.test(k) && pin.length < len) pin += k;
    paint(); msg.textContent = k === "back" ? "" : msg.textContent;
    if (pin.length === len) { locked = true; const p = pin; setTimeout(() => onDone(p), 120); }
  };
  const onClick = (e) => { const b = e.target.closest("button[data-k]"); if (b) press(b.dataset.k); };
  const onKey = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") press("back"); };
  root.addEventListener("click", onClick); document.addEventListener("keydown", onKey);
  return {
    message(text) { msg.textContent = text || ""; },
    reset(text) { pin = ""; locked = false; paint(); msg.textContent = text || ""; },
    disable(on) { locked = !!on; root.querySelectorAll("button").forEach((b) => (b.disabled = !!on)); },
    destroy() { document.removeEventListener("keydown", onKey); root.removeEventListener("click", onClick); },
  };
}

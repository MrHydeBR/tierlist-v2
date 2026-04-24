/**
 * Helpers para manipulação do DOM e UI
 */

export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => document.querySelectorAll(selector);

export function showToast(message, type = 'info') {
  const toast = $('#toast');
  if (!toast) return;
  
  toast.textContent = message;
  toast.dataset.type = type;
  toast.hidden = false;
  
  setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}

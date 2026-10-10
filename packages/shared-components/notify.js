// Thin wrapper over the toast library so app code and tests depend on a tiny
// API (`notify.success(...)`, `notify.action(...)`) instead of the library
// directly. Swapping the implementation later touches only this file.
import { toast } from 'vue-sonner'

export const notify = {
  /** @param {string} message */
  success: (message) => toast.success(message),
  /** @param {string} message */
  error: (message) => toast.error(message),
  // A persistent, actionable toast — e.g. "A newer version is available" with a
  // Refresh button. `duration: Infinity` keeps it up until the user acts (the
  // default would auto-dismiss and the user could miss it).
  /**
   * @param {string} message
   * @param {{ label?: string, onClick?: () => void, duration?: number }} [options]
   */
  action: (message, { label, onClick, duration = Infinity } = {}) =>
    toast(message, { duration, action: { label, onClick } }),
}

// Thin wrapper over the toast library so app code and tests depend on a tiny
// API (`notify.success(...)`) instead of the library directly. Swapping the
// implementation later touches only this file.
import { toast } from 'vue-sonner'

export const notify = {
  success: (message) => toast.success(message),
  error: (message) => toast.error(message),
}

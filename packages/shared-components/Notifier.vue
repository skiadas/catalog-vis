<template>
  <Toaster position="top-right" :close-button="true" />
</template>

<script>
// The single sonner host each app mounts once at its root, so a toast survives
// the route/overlay change that triggered it (see notify.js). App code calls
// `notify.*`; only this component knows the toast library.
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'

export default {
  name: 'AppNotifier',
  components: { Toaster },
}
</script>

import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'

import { startInfoFlowSupervisor } from './server/channels/infoflow/infoflow-supervisor.server'

const fetch = createStartHandler(defaultStreamHandler)

void startInfoFlowSupervisor().catch(() => {
  console.error('[infoflow] supervisor failed to start')
})

export default createServerEntry({ fetch })

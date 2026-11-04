import { createFileRoute } from '@tanstack/react-router'

import { AgentHomeDashboard } from '#/components/home/agent-home-dashboard'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return <AgentHomeDashboard />
}

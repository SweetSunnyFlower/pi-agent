export function AgentPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <header className="flex flex-col gap-5 border-(--line) pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="mb-2 font-mono text-[10px] font-bold tracking-[0.18em] text-(--kicker) uppercase">
          {eyebrow}
        </p>
        <h1 className="display-title text-3xl leading-[1.05] font-semibold tracking-[-0.03em] text-(--sea-ink) sm:text-[2.15rem]">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-(--sea-ink-soft)">
          {description}
        </p>
      </div>
      {action}
    </header>
  )
}

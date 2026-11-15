// Review probe, using the production forms inside the same native dialog boundary.
import { createRoot, type Root } from 'react-dom/client'
import { VerifiedIdentityContext } from '../../src/auth/identity'
import { RecurringTaskForm } from '../../src/adventure/RecurringTaskForm'
import { TaskForm } from '../../src/adventure/PlanningTasks'
import type { PlanningCommand } from '../../src/shared/adventure-planning'
import { future, workspace } from './adventure-recurring-fixture'

type Mode = 'once' | 'recurring' | 'unstarted' | 'legacy'
let root: Root | undefined
let mode: Mode
let blocked = false
let editAllowed = true
export const commands: PlanningCommand[] = []
const identity = { ownerId: '00000000-0000-4000-8000-000000000001', email: 'date-probe@example.invalid', signal: new AbortController().signal }
const action = async (command: PlanningCommand) => { commands.push(command); return false }
const close = () => {}

function render() {
  root!.render(<VerifiedIdentityContext value={identity}>
    <dialog className="recurring-dialog adventure-dialog" ref={element => { if (element && !element.open) element.showModal() }}>
      {mode === 'legacy' ? <TaskForm task={workspace.tasks[0]} data={workspace} busy={blocked} action={action} close={close} changeGoalPage={() => {}}/>
        : <RecurringTaskForm parent={mode === 'unstarted' ? { ...future, capabilities: { ...future.capabilities, editRecurringTask: { allowed: editAllowed } } } : undefined}
            workspace={workspace} blocked={blocked} action={action} close={close}/>}
    </dialog>
  </VerifiedIdentityContext>)
}

export function mount(next: Mode) {
  root?.unmount()
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mode = next; blocked = false; editAllowed = true; commands.length = 0
  render()
}
export function disable(next: boolean, denyEdit = false) {
  blocked = denyEdit ? false : next
  editAllowed = denyEdit ? !next : true
  render()
}

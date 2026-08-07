import Shepherd, { type Tour } from 'shepherd.js'
import type { UserRole } from '@/types/enums'
import { ROLE_HOME } from '@/config/routes'
import { TOUR_STEPS, type TourStepDef } from '@/hooks/tourSteps'

const TOUR_PENDING_KEY = 'loadlink_tour_pending'

export function setTourPending() {
  localStorage.setItem(TOUR_PENDING_KEY, 'true')
}

export function consumeTourPending(): boolean {
  const pending = localStorage.getItem(TOUR_PENDING_KEY) === 'true'
  if (pending) localStorage.removeItem(TOUR_PENDING_KEY)
  return pending
}

export function isTourPending(): boolean {
  return localStorage.getItem(TOUR_PENDING_KEY) === 'true'
}

function makeButton(text: string, action: () => void, secondary = false) {
  return {
    text,
    action,
    classes: secondary ? 'shepherd-button-secondary' : 'shepherd-button-primary',
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Strip a trailing slash so '/driver/' and '/driver' compare equal. */
const normalizePath = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

/**
 * Resolve once the selector exists in the DOM (or the timeout elapses).
 * Keeps steps attached correctly after a route change, and lets a step whose
 * target genuinely isn't rendered fall back to a centred card instead of
 * pointing at nothing.
 */
function waitForElement(selector: string, timeout = 2500): Promise<void> {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      resolve()
      return
    }
    const start = Date.now()
    const tick = () => {
      if (document.querySelector(selector) || Date.now() - start > timeout) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/** Click a tab by its visible label inside the step's target element. */
function clickTabInTarget(selector: string, label: string) {
  const target = document.querySelector<HTMLElement>(selector)
  if (!target) return
  // Find a focusable tab whose text matches the label (button, link, or role=tab).
  const match = Array.from(
    target.querySelectorAll<HTMLElement>('button, a, [role="tab"]')
  ).find((el) => el.textContent?.trim() === label)
  match?.click()
}

/** Navigate (if needed), wait for the step's anchor, and (optionally) pre-activate a tab. */
function prepareStep(
  navigate: (path: string) => void,
  step: TourStepDef,
  selector: string | null
): () => Promise<void> {
  return async () => {
    if (step.path && normalizePath(window.location.pathname) !== normalizePath(step.path)) {
      navigate(step.path)
      // Let React Router swap the route and the page mount its first frame.
      await delay(250)
    }
    if (selector) {
      await waitForElement(selector)
      if (step.clickLinkLabel) {
        // Click a link (e.g. "View Live") that navigates to another page, then
        // let React Router swap the route and the destination page mount.
        clickTabInTarget(selector, step.clickLinkLabel)
        await delay(500)
      } else if (step.clickLabel) {
        // Pre-activate a tab (e.g. Spending Analytics) so the step's copy matches
        // what the user is actually seeing. The click is a no-op if already active.
        clickTabInTarget(selector, step.clickLabel)
        // Give React a frame to re-render the tab's content before anchoring.
        await delay(120)
      }
    }
    await delay(60)
  }
}

/**
 * Build the walkthrough for a role.
 *
 * Steps are declared in `tourSteps.ts` — one tailored script per role
 * (driver, company, admin) — and turned into Shepherd steps here, with
 * navigation, anchor-waiting, progress counters and consistent buttons.
 */
export function createTour(role: UserRole, navigate: (path: string) => void): Tour {
  const tour = new Shepherd.Tour({
    useModalOverlay: true,
    exitOnEsc: true,
    keyboardNavigation: true,
    defaultStepOptions: {
      cancelIcon: { enabled: true },
      classes: 'loadlink-tour-step',
      scrollTo: { behavior: 'smooth', block: 'center' },
      modalOverlayOpeningPadding: 6,
      modalOverlayOpeningRadius: 6,
    },
  })

  const nextBtn = makeButton('Next', () => tour.next())
  const doneBtn = makeButton('Done', () => tour.complete())
  const skipBtn = makeButton('Skip tour', () => tour.complete(), true)

  const steps = TOUR_STEPS[role] ?? []
  const total = steps.length

  steps.forEach((step, index) => {
    const selector = step.target ? `[data-tour="${step.target}"]` : null
    const isFirst = index === 0
    const isLast = index === total - 1

    let buttons = [nextBtn]
    if (isFirst) buttons = [skipBtn, nextBtn]
    else if (isLast) buttons = [doneBtn]

    tour.addStep({
      id: step.id,
      title: step.title,
      text: `${step.text}<p class="shepherd-progress">Step ${index + 1} of ${total}</p>`,
      ...(selector ? { attachTo: { element: selector, on: step.on ?? 'bottom' } } : {}),
      beforeShowPromise: prepareStep(navigate, step, selector),
      buttons,
    })
  })

  // Return the user to their home screen when the tour ends mid-flow, so they
  // never finish stranded on a page they were only shown as an example.
  const goHome = () => {
    const home = ROLE_HOME[role]
    if (home && normalizePath(window.location.pathname) !== normalizePath(home)) navigate(home)
  }
  tour.on('cancel', goHome)

  return tour
}

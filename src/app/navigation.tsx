import { useSyncExternalStore, type AnchorHTMLAttributes } from 'react'

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  return () => window.removeEventListener('popstate', listener)
}

export function usePagePath() {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

export function PageLink({ href, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: '/' | '/news' }) {
  return <a {...props} href={href} onClick={event => {
    onClick?.(event)
    if (event.defaultPrevented || props.target === '_blank' || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (window.location.pathname === href) return
    window.history.pushState(null, '', href)
    window.dispatchEvent(new PopStateEvent('popstate'))
    window.scrollTo(0, 0)
  }}>{children}</a>
}

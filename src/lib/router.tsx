import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react'

type Loc = { path: string; search: URLSearchParams; hash: string }

function read(): Loc {
  return { path: location.pathname, search: new URLSearchParams(location.search), hash: location.hash.slice(1) }
}

const Ctx = createContext<Loc>(read())

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  window.dispatchEvent(new Event('visites:navigate'))
  if (!opts.replace) window.scrollTo({ top: 0 })
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(read)
  useEffect(() => {
    const update = () => setLoc(read())
    window.addEventListener('popstate', update)
    window.addEventListener('visites:navigate', update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener('visites:navigate', update)
    }
  }, [])
  return <Ctx.Provider value={loc}>{children}</Ctx.Provider>
}

export function useLocation() {
  return useContext(Ctx)
}

export function Link({ to, replace, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to, { replace })
      }}
      {...rest}
    />
  )
}

import type { auth } from './auth.js'

type Session = typeof auth.$Infer.Session

export interface AppContext {
  Variables: {
    user: Session['user'] | null
    session: Session['session'] | null
  }
}

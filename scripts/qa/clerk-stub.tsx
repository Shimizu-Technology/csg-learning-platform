import type { ReactNode } from '../../web/node_modules/@types/react/index'
const requested = new URLSearchParams(location.search).get('qa_user')
if (requested && /^[1-8]$/.test(requested)) sessionStorage.setItem('qa_user', requested)
const id = sessionStorage.getItem('qa_user')
const getToken = async () => id ? `test_token_${id}` : null
const user = id ? { id: `qa_${id}`, hasImage: false, imageUrl: '', firstName: 'QA' } : null
export const useAuth = () => ({ isLoaded: true, isSignedIn: !!id, getToken })
export const useUser = () => ({ isLoaded: true, isSignedIn: !!id, user })
export const useClerk = () => ({ openUserProfile() {}, async signOut() { sessionStorage.removeItem('qa_user'); location.href = '/' } })
export const ClerkProvider = ({ children }: { children: ReactNode }) => children
export const ClerkFailed = () => null
export const ClerkLoading = () => null
export const SignIn = () => <p>Local QA: add ?qa_user=1 through ?qa_user=8 to the URL.</p>
export const SignUp = SignIn

import { redirect } from 'next/navigation'

/** Money moves live on `/` now (the slider sits above the position), and a standalone screen had
 * no header and no way back. Kept as a route only so old links and Lemon deep links still land. */
export default function Page() {
  redirect('/')
}

import { redirect } from 'next/navigation'

/** Legacy Spanish alias. Money moves live on `/` now (the slider sits above the position), and a
 * standalone screen had no header and no way back. Kept only so old links and Lemon deep links
 * still land somewhere sensible. */
export default function Page() {
  redirect('/')
}

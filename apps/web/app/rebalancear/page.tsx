import { redirect } from 'next/navigation'

/** Legacy Spanish alias of `/rebalance`, kept so old QA links and Lemon deep links still land. */
export default function Page() {
  redirect('/rebalance')
}

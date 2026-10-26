import { createHmac } from 'node:crypto'
import type { PublishRequest } from '@shared/types'
import { decryptSecret, getSettings } from './settings'

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

/** Ghost Admin API keys are "id:hexsecret"; requests carry a short-lived HS256 JWT. */
function ghostToken(key: string) {
  const [id, secret] = key.split(':')
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id }))
  const iat = Math.floor(Date.now() / 1000)
  const payload = b64url(JSON.stringify({ iat, exp: iat + 300, aud: '/admin/' }))
  const sig = createHmac('sha256', Buffer.from(secret, 'hex')).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

async function check(res: Response) {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`)
  return res
}

export async function publish(req: PublishRequest): Promise<{ url: string }> {
  const account = getSettings().publishAccounts.find((a) => a.id === req.accountId)
  if (!account) throw new Error('Unknown account')
  const secret = decryptSecret(account)
  const base = account.url.replace(/\/+$/, '')

  switch (account.kind) {
    case 'wordpress': {
      const res = await check(
        await fetch(`${base}/wp-json/wp/v2/posts`, {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${account.username}:${secret}`).toString('base64'),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ title: req.title, content: req.html, status: req.status })
        })
      )
      const post = await res.json()
      return { url: post.link ?? `${base}/wp-admin/post.php?post=${post.id}&action=edit` }
    }
    case 'ghost': {
      const res = await check(
        await fetch(`${base}/ghost/api/admin/posts/?source=html`, {
          method: 'POST',
          headers: { Authorization: 'Ghost ' + ghostToken(secret), 'Content-Type': 'application/json', 'Accept-Version': 'v5.0' },
          body: JSON.stringify({
            posts: [{ title: req.title, html: req.html, status: req.status === 'publish' ? 'published' : 'draft', tags: req.tags }]
          })
        })
      )
      const post = (await res.json()).posts[0]
      return { url: post.url }
    }
    case 'medium': {
      const auth = { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json', Accept: 'application/json' }
      const me = await (await check(await fetch('https://api.medium.com/v1/me', { headers: auth }))).json()
      const res = await check(
        await fetch(`https://api.medium.com/v1/users/${me.data.id}/posts`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({
            title: req.title,
            contentFormat: 'markdown',
            content: `# ${req.title}\n\n${req.markdown}`,
            tags: req.tags.slice(0, 5),
            publishStatus: req.status === 'publish' ? 'public' : 'draft'
          })
        })
      )
      return { url: (await res.json()).data.url }
    }
    case 'microblog': {
      const body = new URLSearchParams({ h: 'entry', name: req.title, content: req.markdown })
      if (req.status === 'draft') body.set('post-status', 'draft')
      for (const t of req.tags) body.append('category[]', t)
      const res = await check(
        await fetch(base ? `${base}/micropub` : 'https://micro.blog/micropub', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + secret },
          body
        })
      )
      return { url: res.headers.get('Location') ?? base }
    }
  }
}

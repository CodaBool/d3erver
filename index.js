import { Router } from 'itty-router'
const router = Router()

// from client
router.get('/', async (request, env) => {
	const url = new URL(request.url)
	const token = url.searchParams.get("token")
	const module = url.searchParams.get("module")
	const secret = url.searchParams.get("secret")

	if (!token || !module) {
		return new Response('missing token or module query', { status: 400 })
	}

	// for testing
	if (secret === env.FOUNDRY_SECRET) {
		console.log("bypassing with dev key")
		const zip = await env.R2.get(module)
		if (zip === null) {
			return new Response(`module ${module} does not exist`, { status: 404 })
		}
		console.log("downloaded zip with filename", module.slice(0, -7))
		return new Response(zip.body, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${module.slice(0, -7)}.zip"`,
			},
		})
	}

	const tokenExists = await env.KV.get(token)

	if (!tokenExists) {
		return new Response('Expired token', { status: 403 })
	}

	const zip = await env.R2.get(module)

	if (zip === null) {
		return new Response(`module ${module} does not exist`, { status: 404 })
	}

	if (zip.status >= 400) {
		return new Response('Error fetching the zip file', { status: 500 })
	}

	// Return the zip file
	return new Response(zip.body, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${module.slice(0, -7)}.zip"`,
		},
	})
})

// from foundryvtt.com server
router.post('/', async (request, env)=> {
	const body = await request.json()
	const url = new URL(request.url)
	const allowedDomains = ["https://foundryvtt.com/", "https://api.foundryvtt.com/"]

	// TODO: use a WAF as well
	if (!allowedDomains.some(allowed => url === allowed)) {
		console.log("blocked", url, body, "if this was a mistake allow additional domains")
		if (body.api_key === env.FOUNDRY_SECRET) {
			console.log("aborting block, match on API secret token from", url)
		} else {
			return new Response(`${url} is unauthorized`, { status: 403 })
		}
	}

	let uuid = await crypto.randomUUID()

	// for development purpose
	if (env.ENVIRONMENT === "dev") {
		console.log("generated token", uuid)
		uuid = "dev"
	}

	// timed token
	await env.KV.put(uuid, body.user_id, { expirationTTL: 14400 })

	const data = JSON.stringify({
		package_name: body.package_name,
		version: body.version,
		download: `https://${env.DOMAIN}/?token=${uuid}&module=${body.package_name}-v${body.version}`,
	}, null, 2)

	return new Response(data, {
		headers: {
			'Content-Type': 'application/json',
		},
	})
})

// 404 for everything else
router.all('*', () => new Response('Not Found.', { status: 404 }));

export default {
	async fetch(request, env, ctx) {
		return router.handle(request, env)
	}
}
